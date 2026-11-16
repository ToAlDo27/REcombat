import type {
  Actor,
  Combatant,
  CombatState,
  Operation,
  RollResult,
  Settings,
} from "./types"
import {
  normalizeTokenPatch,
  normalizeTokenProfile,
  tokenProfileFromCombatant,
} from "./tokenData"

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  diceSides: 20,
  reverse: false,
  showHp: true,
  showAc: true,
  highlight: true,
  sound: true,
  playerEdit: "all",
  playersCanAdvance: false,
  hideNpcStats: false,
  rollMode: "normal",
  tokenInitiative: "manual",
})

export function emptyState(): CombatState {
  return {
    combatants: [],
    tokenProfiles: {},
    settings: { ...DEFAULT_SETTINGS },
    turn: { active: false, combatantId: null, round: 1, eventId: null },
    opCount: 0,
  }
}

export function canEdit(
  combatant: Combatant,
  actor: Actor | null,
  settings: Settings,
): boolean {
  return (
    !!actor &&
    (actor.role === "GM" ||
      settings.playerEdit === "all" ||
      combatant.ownerId === actor.id)
  )
}

export function canControl(actor: Actor | null, settings: Settings): boolean {
  return !!actor && (actor.role === "GM" || settings.playersCanAdvance)
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

export function orderedCombatants(state: CombatState): Combatant[] {
  return [...state.combatants].sort((a, b) => {
    // Unrolled participants stay at the end in either initiative direction.
    if (a.initiative === null && b.initiative !== null) return 1
    if (b.initiative === null && a.initiative !== null) return -1
    const initiative = (a.initiative ?? 0) - (b.initiative ?? 0)
    return (
      (state.settings.reverse ? initiative : -initiative) ||
      b.bonus - a.bonus ||
      compareText(a.name, b.name) ||
      compareText(a.id, b.id)
    )
  })
}

const own = (object: object, key: PropertyKey) =>
  Object.prototype.hasOwnProperty.call(object, key)
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value)
const text = (value: unknown, max = 200): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= max
const number = (value: unknown, min = -1_000_000, max = 1_000_000): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= min && value <= max
const integer = (value: unknown, min: number, max: number): value is number =>
  number(value, min, max) && Number.isInteger(value)
const mode = (value: unknown): value is RollResult["mode"] =>
  value === "normal" || value === "advantage" || value === "disadvantage"

function roll(value: unknown): RollResult | null {
  if (
    !record(value) ||
    !integer(value.sides, 2, 1000) ||
    !integer(value.natural, 1, value.sides) ||
    !number(value.total) ||
    !mode(value.mode)
  )
    return null
  return {
    sides: value.sides,
    natural: value.natural,
    total: value.total,
    mode: value.mode,
  }
}

function combatantPatch(
  value: unknown,
): Partial<Omit<Combatant, "id" | "tokenId">> | null {
  if (!record(value)) return null
  const tokenPatch = normalizeTokenPatch(value)
  if (!tokenPatch) return null
  const result: Partial<Omit<Combatant, "id" | "tokenId">> = { ...tokenPatch }
  if (own(value, "name")) {
    if (!text(value.name)) return null
    result.name = value.name
  }
  if (own(value, "ownerId")) {
    if (!text(value.ownerId, 250)) return null
    result.ownerId = value.ownerId
  }
  if (own(value, "initiative")) {
    if (value.initiative !== null && !number(value.initiative)) return null
    result.initiative = value.initiative
  }
  if (own(value, "bonus")) {
    if (!number(value.bonus, -10000, 10000)) return null
    result.bonus = value.bonus
  }
  if (own(value, "hp")) {
    if (!number(value.hp, 0)) return null
    result.hp = value.hp
  }
  if (own(value, "maxHp")) {
    if (!number(value.maxHp, 1)) return null
    result.maxHp = value.maxHp
  }
  if (own(value, "ac")) {
    if (!number(value.ac, 0, 10000)) return null
    result.ac = value.ac
  }
  if (own(value, "faction")) {
    if (value.faction !== "pc" && value.faction !== "npc") return null
    result.faction = value.faction
  }
  if (own(value, "lastRoll")) {
    const resultRoll = roll(value.lastRoll)
    if (!resultRoll) return null
    result.lastRoll = resultRoll
  }
  return result
}

function settingsPatch(value: unknown): Partial<Settings> | null {
  if (!record(value)) return null
  const result: Partial<Settings> = {}
  if (own(value, "diceSides")) {
    if (!integer(value.diceSides, 2, 1000)) return null
    result.diceSides = value.diceSides
  }
  if (own(value, "playerEdit")) {
    if (value.playerEdit !== "all" && value.playerEdit !== "own") return null
    result.playerEdit = value.playerEdit
  }
  if (own(value, "rollMode")) {
    if (!mode(value.rollMode)) return null
    result.rollMode = value.rollMode
  }
  if (own(value, "tokenInitiative")) {
    if (
      value.tokenInitiative !== "manual" &&
      value.tokenInitiative !== "roll" &&
      value.tokenInitiative !== "empty"
    )
      return null
    result.tokenInitiative = value.tokenInitiative
  }
  for (const key of [
    "reverse",
    "showHp",
    "showAc",
    "highlight",
    "sound",
    "playersCanAdvance",
    "hideNpcStats",
  ] as const) {
    if (own(value, key)) {
      const field = value[key]
      if (typeof field !== "boolean") return null
      result[key] = field
    }
  }
  return result
}

/** Keep the journal safe to replay: validate and copy only known, bounded fields. */
export function normalizeOperation(value: unknown): Operation | null {
  if (
    !record(value) ||
    value.schema !== 1 ||
    !text(value.idempotencyId, 250) ||
    !text(value.actorId, 250) ||
    !integer(value.clock, 1, Number.MAX_SAFE_INTEGER - 1)
  )
    return null
  const base = {
    schema: 1 as const,
    idempotencyId: value.idempotencyId,
    actorId: value.actorId,
    clock: value.clock,
  }
  switch (value.kind) {
    case "add": {
      if (!record(value.combatant) || !text(value.combatant.id, 250)) return null
      const c = value.combatant
      const patch = combatantPatch(c)
      if (
        !patch ||
        !text(patch.name) ||
        !text(patch.ownerId, 250) ||
        !(patch.initiative === null || number(patch.initiative)) ||
        !number(patch.bonus) ||
        !number(patch.hp, 0) ||
        !number(patch.maxHp, 1) ||
        !number(patch.ac, 0) ||
        !patch.faction
      )
        return null
      if (c.tokenId !== undefined && !text(c.tokenId, 200)) return null
      if (
        value.initiative !== undefined &&
        value.initiative !== "manual" &&
        value.initiative !== "roll" &&
        value.initiative !== "empty"
      )
        return null
      return {
        ...base,
        kind: "add",
        ...(value.initiative ? { initiative: value.initiative } : {}),
        combatant: {
          ...patch,
          id: c.id,
          ...(c.tokenId ? { tokenId: c.tokenId } : {}),
        } as Combatant,
      }
    }
    case "token": {
      const baseProfile = normalizeTokenProfile(value.base)
      const patch = normalizeTokenPatch(value.patch)
      return text(value.tokenId, 200) && baseProfile && patch
        ? { ...base, kind: "token", tokenId: value.tokenId, base: baseProfile, patch }
        : null
    }
    case "patch": {
      const patch = combatantPatch(value.patch)
      return text(value.id, 250) && patch
        ? { ...base, kind: "patch", id: value.id, patch }
        : null
    }
    case "hp":
      return text(value.id, 250) && number(value.delta)
        ? { ...base, kind: "hp", id: value.id, delta: value.delta }
        : null
    case "remove":
      return text(value.id, 250) ? { ...base, kind: "remove", id: value.id } : null
    case "roll": {
      const result = roll(value.result)
      return text(value.id, 250) && result
        ? { ...base, kind: "roll", id: value.id, result }
        : null
    }
    case "settings": {
      const patch = settingsPatch(value.patch)
      return patch ? { ...base, kind: "settings", patch } : null
    }
    case "resetInitiative":
      return { ...base, kind: "resetInitiative" }
    case "turn":
      if (
        (value.combatantId !== null && !text(value.combatantId, 250)) ||
        (value.expectedEventId !== null && !text(value.expectedEventId, 250)) ||
        !integer(value.round, 1, 1_000_000) ||
        typeof value.active !== "boolean"
      )
        return null
      return {
        ...base,
        kind: "turn",
        combatantId: value.combatantId,
        round: value.round,
        active: value.active,
        expectedEventId: value.expectedEventId,
      }
    default:
      return null
  }
}

export function compareOperations(a: Operation, b: Operation): number {
  return (
    a.clock - b.clock ||
    compareText(a.actorId, b.actorId) ||
    compareText(a.idempotencyId, b.idempotencyId)
  )
}

/** A unique metadata key per operation avoids read/modify/write roster races. */
export function reduceOperations(values: Iterable<unknown>): CombatState {
  const byId = new Map<string, Operation>()
  for (const value of values) {
    const op = normalizeOperation(value)
    if (op && !byId.has(op.idempotencyId)) byId.set(op.idempotencyId, op)
  }
  const state = emptyState()
  const roster = new Map<string, Combatant>()
  const profiles = new Map<string, CombatState["tokenProfiles"][string]>()
  const remember = (combatant: Combatant) => {
    if (combatant.tokenId)
      profiles.set(combatant.tokenId, tokenProfileFromCombatant(combatant))
  }
  for (const op of [...byId.values()].sort(compareOperations)) {
    state.opCount++
    switch (op.kind) {
      case "add": {
        // Registration is idempotent, including two users selecting the same token.
        if (
          !roster.has(op.combatant.id) &&
          !(
            op.combatant.tokenId &&
            [...roster.values()].some(c => c.tokenId === op.combatant.tokenId)
          )
        ) {
          const profile = op.combatant.tokenId
            ? profiles.get(op.combatant.tokenId)
            : undefined
          const combatant: Combatant = {
            ...op.combatant,
            ...profile,
            ...(op.initiative === "roll"
              ? { initiative: op.combatant.initiative, lastRoll: op.combatant.lastRoll }
              : {}),
            ...(op.initiative === "empty" ? { initiative: null } : {}),
          }
          combatant.hp = Math.min(combatant.hp, combatant.maxHp)
          roster.set(combatant.id, combatant)
          remember(combatant)
        }
        break
      }
      case "patch": {
        const c = roster.get(op.id)
        if (c) {
          Object.assign(c, op.patch)
          c.hp = Math.min(c.hp, c.maxHp)
          if (own(op.patch, "initiative") && !own(op.patch, "lastRoll")) delete c.lastRoll
          remember(c)
        }
        break
      }
      case "hp": {
        const c = roster.get(op.id)
        if (c) {
          c.hp = Math.max(0, Math.min(c.maxHp, c.hp + op.delta))
          remember(c)
        }
        break
      }
      case "roll": {
        const c = roster.get(op.id)
        if (c) {
          c.initiative = op.result.total
          c.lastRoll = { ...op.result }
          remember(c)
        }
        break
      }
      case "token": {
        const profile = { ...(profiles.get(op.tokenId) ?? op.base), ...op.patch }
        profile.hp = Math.min(profile.hp, profile.maxHp)
        profiles.set(op.tokenId, profile)
        for (const c of roster.values()) {
          if (c.tokenId !== op.tokenId) continue
          Object.assign(c, profile)
          if (own(op.patch, "initiative")) delete c.lastRoll
        }
        break
      }
      case "remove": {
        roster.delete(op.id)
        if (state.turn.combatantId === op.id) state.turn.combatantId = null
        break
      }
      case "settings":
        Object.assign(state.settings, op.patch)
        break
      case "resetInitiative":
        for (const c of roster.values()) {
          c.initiative = null
          delete c.lastRoll
          remember(c)
        }
        break
      case "turn":
        // Two Next clicks based on the same turn become a single transition.
        if (
          state.turn.eventId === op.expectedEventId &&
          (!op.active || (!!op.combatantId && roster.has(op.combatantId)))
        ) {
          state.turn = {
            active: op.active,
            combatantId: op.active ? op.combatantId : null,
            round: op.round,
            eventId: op.idempotencyId,
          }
        }
        break
    }
  }
  state.combatants = [...roster.values()]
  state.tokenProfiles = Object.fromEntries(profiles)
  if (!state.combatants.length) {
    state.turn.active = false
    state.turn.combatantId = null
  }
  return state
}
