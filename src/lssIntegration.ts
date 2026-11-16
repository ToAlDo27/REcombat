import OBR from "@owlbear-rodeo/sdk"
import { canEdit } from "./model"
import { readTokenProfile } from "./tokenData"
import type { CombatStore } from "./store"
import { PREFIX, type Actor, type Snapshot } from "./types"
import {
  initiativeFromRoll,
  LSS_SHEET_CHANNEL,
  parseLssRoll,
  rollIdentity,
} from "./lssEvents"

export const LSS_RELAY_CHANNEL = `${PREFIX}/lss-events`
const MAX_FORWARDED_ROLLS = 256

/** One connected client writes each target, preventing competing journal clocks. */
function isWriter(state: Snapshot, eligible: (actor: Actor) => boolean): boolean {
  const actor = state.actor
  if (!actor) return false
  const connections = new Map<string, Actor>()
  for (const candidate of [actor, ...state.party]) {
    if (!connections.has(candidate.connectionId) && eligible(candidate))
      connections.set(candidate.connectionId, candidate)
  }
  const candidates = [...connections.values()].sort((a, b) => {
    if (a.role !== b.role) return a.role === "GM" ? -1 : 1
    return a.connectionId < b.connectionId ? -1 : a.connectionId > b.connectionId ? 1 : 0
  })
  return candidates[0]?.connectionId === actor.connectionId
}

/** IDs, rather than names, determine which token receives a sheet roll. */
export async function applyLssRoll(
  store: CombatStore,
  event: unknown,
  elect = false,
): Promise<number> {
  const roll = parseLssRoll(event)
  if (!roll) return 0
  const initiative = initiativeFromRoll(roll)
  if (initiative === null) return 0
  return applyLinkedInitiative(
    store,
    roll.characterId,
    initiative,
    rollIdentity(roll),
    elect,
  )
}

/** A selected local browser receiver can write directly, without peer election. */
export async function applyLinkedInitiative(
  store: CombatStore,
  characterId: string,
  initiative: number,
  identity: string,
  elect = false,
): Promise<number> {
  const state = store.getSnapshot()
  if (!state.ready || state.loading || !state.actor) return 0
  let applied = 0
  for (const initial of state.combatants) {
    const current = store.getSnapshot()
    if (
      current.sceneKey !== state.sceneKey ||
      !current.ready ||
      current.loading ||
      !current.actor
    )
      break
    const c = current.combatants.find(candidate => candidate.id === initial.id)
    if (
      !c ||
      !c.lss?.sync ||
      c.lss.characterId !== characterId ||
      !canEdit(c, current.actor, current.settings) ||
      (elect && !isWriter(current, actor => canEdit(c, actor, current.settings)))
    )
      continue
    await store.dispatch(
      { kind: "patch", id: c.id, patch: { initiative } },
      `${identity}:${c.id}`,
    )
    applied++
  }
  // A character can be configured on a token before entering the initiative list.
  for (const initial of state.items) {
    const current = store.getSnapshot()
    if (
      current.sceneKey !== state.sceneKey ||
      !current.ready ||
      current.loading ||
      !current.actor
    )
      break
    const item = current.items.find(candidate => candidate.id === initial.id)
    if (!item) continue
    if (item.type !== "IMAGE" || !["CHARACTER", "MOUNT"].includes(item.layer)) continue
    if (current.combatants.some(c => c.tokenId === item.id)) continue
    const profile = current.tokenProfiles[item.id] ?? readTokenProfile(item)
    if (!profile.lss?.sync || profile.lss.characterId !== characterId) continue
    const eligible = (actor: Actor) =>
      actor.role === "GM" ||
      (item.visible &&
        (current.settings.playerEdit !== "own" || item.createdUserId === actor.id))
    if (!eligible(current.actor) || (elect && !isWriter(current, eligible))) continue
    await store.dispatch(
      { kind: "token", tokenId: item.id, base: profile, patch: { initiative } },
      `${identity}:token:${item.id}`,
    )
    applied++
  }
  return applied
}

/** Keep the official bridge integration alive even when the tracker panel is closed. */
export function startLssIntegration(store: CombatStore): () => void {
  let disposed = false
  const forwarded = new Set<string>()
  const report = (error: unknown) => {
    if (!disposed)
      void OBR.notification
        .show(
          error instanceof Error ? error.message : "Не удалось принять инициативу LSS",
          "ERROR",
        )
        .catch(() => undefined)
  }
  const receiveOfficial = (event: { data: unknown }) => {
    const roll = parseLssRoll(event.data)
    if (!roll || initiativeFromRoll(roll) === null) return
    const identity = rollIdentity(roll)
    if (forwarded.has(identity)) return
    forwarded.add(identity)
    if (forwarded.size > MAX_FORWARDED_ROLLS)
      forwarded.delete(forwarded.values().next().value!)
    // The official bridge sends REMOTE. ALL lets its original roller also
    // receive this relay, so that client can be elected even when it is the GM.
    void OBR.broadcast
      .sendMessage(
        LSS_RELAY_CHANNEL,
        { type: "lss:roll", payload: roll },
        { destination: "ALL" },
      )
      .catch(error => {
        forwarded.delete(identity)
        report(error)
      })
  }
  const receiveRelay = (event: { data: unknown }) => {
    void applyLssRoll(store, event.data, true).catch(report)
  }
  const stops = [
    OBR.broadcast.onMessage(LSS_SHEET_CHANNEL, receiveOfficial),
    OBR.broadcast.onMessage(LSS_RELAY_CHANNEL, receiveRelay),
  ]
  return () => {
    disposed = true
    forwarded.clear()
    stops.forEach(stop => stop())
  }
}
