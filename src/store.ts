import OBR, { type Item, type Metadata, type Player } from "@owlbear-rodeo/sdk"
import {
  canControl,
  canEdit,
  emptyState,
  normalizeOperation,
  orderedCombatants,
  reduceOperations,
} from "./model"
import { rollInitiative } from "./random"
import {
  normalizeTokenPatch,
  normalizeTokenProfile,
  readTokenProfile,
  TOKEN_DATA_KEY,
  tokenMetadata,
} from "./tokenData"
import {
  PREFIX,
  type Actor,
  type Combatant,
  type Command,
  type Operation,
  type RollResult,
  type Settings,
  type Snapshot,
  type TokenInitiative,
  type TokenProfilePatch,
} from "./types"

/** Deliberately small surface: tests can run several real stores over one scene. */
export interface CombatSDK {
  isAvailable: boolean
  isReady: boolean
  onReady(callback: () => void): void
  room: { id: string }
  player: {
    getId(): Promise<string>
    getConnectionId(): Promise<string>
    getName(): Promise<string>
    getRole(): Promise<"GM" | "PLAYER">
    getColor(): Promise<string>
    onChange(callback: (player: Player) => void): () => void
  }
  party: {
    getPlayers(): Promise<Player[]>
    onChange(callback: (players: Player[]) => void): () => void
  }
  scene: {
    isReady(): Promise<boolean>
    onReadyChange(callback: (ready: boolean) => void): () => void
    getMetadata(): Promise<Metadata>
    setMetadata(update: Metadata): Promise<void>
    onMetadataChange(callback: (metadata: Metadata) => void): () => void
    items: {
      getItems(): Promise<Item[]>
      updateItems?(ids: string[], update: (draft: Item[]) => void): Promise<void>
      onChange(callback: (items: Item[]) => void): () => void
    }
  }
}

interface StoreOptions {
  uuid?: () => string
  roll?: (bonus: number, settings: Settings) => RollResult
}

const operationPrefix = `${PREFIX}/op/`
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : "Не удалось сохранить изменения в сцене."
const asActor = ({ id, connectionId, name, role, color }: Player): Actor => ({
  id,
  connectionId,
  name,
  role,
  color,
})

export class CombatStore {
  private snapshot: Snapshot = {
    ...emptyState(),
    ready: false,
    loading: false,
    pending: 0,
    actor: null,
    items: [],
    party: [],
    sceneKey: "",
  }
  private listeners = new Set<() => void>()
  private operations = new Map<string, Operation>()
  private pending = new Map<string, Operation>()
  private clock = 0
  private references = 0
  private session = 0
  private sceneEpoch = 0
  private sceneReady = false
  private sceneUnsubscribers: (() => void)[] = []
  private unsubscribers: (() => void)[] = []
  private uuid: () => string
  private makeRoll: (bonus: number, settings: Settings) => RollResult
  private tokenSyncing = false
  private tokenSyncRequested = false

  constructor(
    private sdk: CombatSDK = OBR,
    options: StoreOptions = {},
  ) {
    this.uuid = options.uuid ?? (() => crypto.randomUUID())
    this.makeRoll = options.roll ?? rollInitiative
  }

  getSnapshot = (): Snapshot => this.snapshot

  clearError = (): void => {
    this.publish({ error: undefined })
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private publish(patch: Partial<Snapshot> = {}): void {
    this.snapshot = { ...this.snapshot, ...patch }
    for (const listener of this.listeners) listener()
  }

  private replay(patch: Partial<Snapshot> = {}): void {
    const all = new Map(this.operations)
    for (const [id, op] of this.pending) all.set(id, op)
    this.publish({
      ...reduceOperations(all.values()),
      pending: this.pending.size,
      ...patch,
    })
  }

  /** No data is written on startup, so opening/reopening cannot reset a scene. */
  start = (): (() => void) => {
    this.references++
    let released = false
    if (this.references === 1) {
      const session = ++this.session
      if (this.sdk.isAvailable) {
        this.publish({ loading: true, error: undefined })
        const ready = () => {
          if (this.session === session && this.references) this.connect(session)
        }
        if (this.sdk.isReady) ready()
        else this.sdk.onReady(ready)
      }
    }
    return () => {
      if (released) return
      released = true
      if (--this.references) return
      this.session++
      this.clearScene()
      this.unsubscribers.splice(0).forEach(unsubscribe => unsubscribe())
      this.publish({ loading: false, actor: null, party: [] })
    }
  }

  private connect(session: number): void {
    let actorRevision = 0
    let partyRevision = 0
    let readyRevision = 0
    const current = () => this.session === session && this.references > 0
    this.unsubscribers.push(
      this.sdk.player.onChange(player => {
        actorRevision++
        if (current()) this.publish({ actor: asActor(player) })
      }),
      this.sdk.party.onChange(players => {
        partyRevision++
        if (current()) this.publish({ party: players.map(asActor) })
      }),
      this.sdk.scene.onReadyChange(ready => {
        readyRevision++
        if (current()) this.setSceneReady(ready, session)
      }),
    )
    const actorRead = actorRevision
    void Promise.all([
      this.sdk.player.getId(),
      this.sdk.player.getConnectionId(),
      this.sdk.player.getName(),
      this.sdk.player.getRole(),
      this.sdk.player.getColor(),
    ])
      .then(([id, connectionId, name, role, color]) => {
        if (current() && actorRevision === actorRead)
          this.publish({ actor: { id, connectionId, name, role, color } })
      })
      .catch(error => {
        if (current()) this.publish({ error: errorText(error) })
      })
    const partyRead = partyRevision
    void this.sdk.party
      .getPlayers()
      .then(players => {
        if (current() && partyRevision === partyRead)
          this.publish({ party: players.map(asActor) })
      })
      .catch(error => {
        if (current()) this.publish({ error: errorText(error) })
      })
    const readyRead = readyRevision
    void this.sdk.scene
      .isReady()
      .then(ready => {
        if (current() && readyRevision === readyRead) this.setSceneReady(ready, session)
      })
      .catch(error => {
        if (current()) this.publish({ loading: false, error: errorText(error) })
      })
  }

  private clearScene(): void {
    this.sceneEpoch++
    this.sceneReady = false
    this.sceneUnsubscribers.splice(0).forEach(unsubscribe => unsubscribe())
    this.operations.clear()
    this.pending.clear()
    this.clock = 0
    this.publish({ ...emptyState(), ready: false, pending: 0, items: [], sceneKey: "" })
  }

  private setSceneReady(ready: boolean, session: number): void {
    if (!ready) {
      this.clearScene()
      this.publish({ loading: false })
      return
    }
    if (this.sceneReady) return
    this.clearScene()
    this.sceneReady = true
    const epoch = this.sceneEpoch
    const current = () =>
      this.session === session && this.sceneEpoch === epoch && this.sceneReady
    let itemRevision = 0
    this.publish({
      loading: true,
      error: undefined,
      sceneKey: `${this.sdk.room.id}/${session}/${epoch}`,
    })
    const ingest = (metadata: Metadata) => {
      if (!current()) return
      // Scene events and the initial read can arrive in either order. Journal entries
      // are immutable, so taking their union never reverts a newer registration.
      for (const [key, value] of Object.entries(metadata)) {
        if (!key.startsWith(operationPrefix)) continue
        const op = normalizeOperation(value)
        if (!op || key !== operationPrefix + op.idempotencyId) continue
        this.operations.set(op.idempotencyId, op)
        this.clock = Math.max(this.clock, op.clock)
      }
      this.replay()
      this.queueTokenSync()
    }
    this.sceneUnsubscribers.push(
      this.sdk.scene.onMetadataChange(ingest),
      this.sdk.scene.items.onChange(items => {
        itemRevision++
        if (current()) {
          this.publish({ items })
          this.queueTokenSync()
        }
      }),
    )
    const itemRead = itemRevision
    const metadata = this.sdk.scene.getMetadata().then(value => {
      if (current()) ingest(value)
    })
    const items = this.sdk.scene.items.getItems().then(value => {
      if (current() && itemRevision === itemRead) this.publish({ items: value })
    })
    void Promise.all([metadata, items])
      .then(() => {
        if (current()) {
          this.publish({ ready: true, loading: false })
          this.queueTokenSync()
        }
      })
      .catch(error => {
        if (current())
          this.publish({ ready: false, loading: false, error: errorText(error) })
      })
  }

  private requireActor(): Actor {
    if (!this.snapshot.ready || !this.sceneReady)
      throw new Error("Сначала откройте сцену и дождитесь синхронизации.")
    if (!this.snapshot.actor)
      throw new Error(
        "Не удалось определить игрока. Попробуйте открыть расширение заново.",
      )
    return this.snapshot.actor
  }

  private authorizeTokenRegistration(tokenId: string, actor: Actor): void {
    const state = this.snapshot
    const item = state.items.find(item => item.id === tokenId)
    if (item && (item.type !== "IMAGE" || !["CHARACTER", "MOUNT"].includes(item.layer)))
      throw new Error("Выберите токен персонажа в текущей сцене.")
    if (actor.role !== "GM" && item && !item.visible) throw new Error("Токен недоступен.")
    if (actor.role !== "GM" && state.settings.playerEdit === "own") {
      if (!item) throw new Error("Выберите токен персонажа в текущей сцене.")
      if (item.createdUserId !== actor.id)
        throw new Error("Добавлять можно только свои токены.")
    }
  }

  private authorize(command: Command, actor: Actor): void {
    const state = this.snapshot
    if (command.kind === "settings" || command.kind === "resetInitiative") {
      if (actor.role !== "GM") throw new Error("Это действие доступно ведущему.")
    } else if (command.kind === "turn") {
      if (!canControl(actor, state.settings))
        throw new Error("Переключать ход может ведущий.")
    } else if (command.kind === "token") {
      const item = state.items.find(item => item.id === command.tokenId)
      if (!item || item.type !== "IMAGE" || !["CHARACTER", "MOUNT"].includes(item.layer))
        throw new Error("Выберите токен персонажа в текущей сцене.")
      if (actor.role !== "GM" && !item.visible) throw new Error("Токен недоступен.")
      const combatant = state.combatants.find(c => c.tokenId === command.tokenId)
      if (combatant && !canEdit(combatant, actor, state.settings))
        throw new Error("Редактировать можно только своих участников.")
      if (
        !combatant &&
        actor.role !== "GM" &&
        state.settings.playerEdit === "own" &&
        item.createdUserId !== actor.id
      )
        throw new Error("Редактировать можно только свои токены.")
    } else if (command.kind !== "add") {
      const combatant = state.combatants.find(c => c.id === command.id)
      if (!combatant) throw new Error("Участник уже удалён из боя.")
      if (!canEdit(combatant, actor, state.settings))
        throw new Error("Редактировать можно только своих участников.")
    } else {
      if (actor.role !== "GM" && command.combatant.ownerId !== actor.id)
        throw new Error("Нового участника нужно зарегистрировать на себя.")
      if (command.combatant.tokenId)
        this.authorizeTokenRegistration(command.combatant.tokenId, actor)
    }
  }

  dispatch = async (command: Command, idempotencyId?: string): Promise<void> => {
    const epoch = this.sceneEpoch
    try {
      const actor = this.requireActor()
      if (
        idempotencyId &&
        (this.operations.has(idempotencyId) || this.pending.has(idempotencyId))
      )
        return
      this.authorize(command, actor)
      const op = normalizeOperation({
        ...command,
        schema: 1,
        idempotencyId: idempotencyId ?? this.uuid(),
        clock: ++this.clock,
        actorId: actor.id,
      })
      if (!op)
        throw new Error(
          "Проверьте значения: имя, ХП, КЗ и инициатива должны быть корректными.",
        )
      this.pending.set(op.idempotencyId, op)
      this.replay({ error: undefined })
      try {
        // Only our new, unique top-level key is sent. Never replace the roster or
        // read/write a shared object: other clients may be saving simultaneously.
        if (this.sceneEpoch !== epoch)
          throw new Error("Сцена изменилась; повторите действие в новой сцене.")
        await this.sdk.scene.setMetadata({ [operationPrefix + op.idempotencyId]: op })
        if (this.sceneEpoch !== epoch) return
        this.operations.set(op.idempotencyId, op)
        this.pending.delete(op.idempotencyId)
        this.replay()
        this.queueTokenSync()
      } catch (error) {
        if (this.sceneEpoch === epoch) {
          this.pending.delete(op.idempotencyId)
          this.replay({ error: errorText(error) })
        }
        throw error
      }
    } catch (error) {
      if (this.sceneEpoch === epoch) this.publish({ error: errorText(error) })
      throw error
    }
  }

  /** The journal is authoritative. Item metadata is a portable, repairable mirror. */
  private queueTokenSync(): void {
    if (!this.snapshot.ready || !this.sdk.scene.items.updateItems) return
    this.tokenSyncRequested = true
    if (this.tokenSyncing) return
    this.tokenSyncing = true
    const epoch = this.sceneEpoch
    const synchronize = async () => {
      while (this.tokenSyncRequested && epoch === this.sceneEpoch && this.sceneReady) {
        this.tokenSyncRequested = false
        // Never put an optimistic/failed operation onto a token.
        const profiles = reduceOperations(this.operations.values()).tokenProfiles
        const ids = this.snapshot.items
          .filter(
            item =>
              profiles[item.id] &&
              JSON.stringify(item.metadata?.[TOKEN_DATA_KEY]) !==
                JSON.stringify(tokenMetadata(profiles[item.id])),
          )
          .map(item => item.id)
        if (!ids.length) continue
        await this.sdk.scene.items.updateItems!(ids, drafts => {
          for (const item of drafts) {
            const profile = profiles[item.id]
            if (profile)
              item.metadata = {
                ...item.metadata,
                [TOKEN_DATA_KEY]: tokenMetadata(profile),
              }
          }
        })
      }
    }
    void synchronize()
      .catch(error => {
        if (epoch === this.sceneEpoch) {
          this.tokenSyncRequested = false
          this.publish({
            error: `Данные сохранены в сцене, но карточку токена обновить не удалось: ${errorText(
              error,
            )}`,
          })
        }
      })
      .finally(() => {
        this.tokenSyncing = false
        if (this.tokenSyncRequested) this.queueTokenSync()
      })
  }

  saveTokenProfile = async (tokenId: string, value: TokenProfilePatch): Promise<void> => {
    const actor = this.requireActor()
    const item = this.snapshot.items.find(item => item.id === tokenId)
    if (!item) throw new Error("Токен уже удалён из сцены.")
    const patch = normalizeTokenPatch(value)
    if (!patch) throw new Error("Проверьте значения карточки и ссылку на персонажа LSS.")
    const stored = item.metadata?.[TOKEN_DATA_KEY]
    const savedProfile =
      stored && typeof stored === "object" && "schema" in stored && stored.schema === 1
        ? normalizeTokenProfile(stored)
        : null
    if (
      !Object.keys(patch).length &&
      (this.snapshot.tokenProfiles[tokenId] || savedProfile)
    )
      return
    await this.dispatch({
      kind: "token",
      tokenId,
      patch,
      base:
        this.snapshot.tokenProfiles[tokenId] ??
        readTokenProfile(item, actor.role === "GM" ? "npc" : "pc"),
    })
  }

  addTokens = async (
    items: Item[],
    options: { initiative?: TokenInitiative } = {},
  ): Promise<void> => {
    const actor = this.requireActor()
    const unique = [...new Map(items.map(item => [item.id, item])).values()]
    const candidates = unique
      .filter(item => !this.snapshot.combatants.some(c => c.tokenId === item.id))
      .map(item => {
        const latest = this.snapshot.items.find(current => current.id === item.id)
        if (!latest && actor.role !== "GM" && this.snapshot.settings.playerEdit === "own")
          throw new Error("Выберите токен персонажа в текущей сцене.")
        return latest ?? item
      })
      .filter(
        item =>
          item.type === "IMAGE" &&
          ["CHARACTER", "MOUNT"].includes(item.layer) &&
          (actor.role === "GM" || item.visible),
      )
    // Validate the whole selection before dispatching any optimistic add, so a
    // denied token cannot leave an authorized part of the batch registered.
    for (const item of candidates) this.authorizeTokenRegistration(item.id, actor)
    await Promise.all(
      candidates.map(item => {
        const profile =
          this.snapshot.tokenProfiles[item.id] ??
          readTokenProfile(item, actor.role === "GM" ? "npc" : "pc")
        const initiative = options.initiative ?? this.snapshot.settings.tokenInitiative
        const result =
          initiative === "roll"
            ? this.makeRoll(profile.bonus, {
                ...this.snapshot.settings,
                rollMode: profile.rollMode ?? this.snapshot.settings.rollMode,
              })
            : undefined
        return this.dispatch({
          kind: "add",
          initiative,
          combatant: {
            ...this.newCombatant(item.name || "Без имени", actor),
            ...profile,
            id: `token:${item.id}`,
            tokenId: item.id,
            ...(result ? { initiative: result.total, lastRoll: result } : {}),
            ...(initiative === "empty" ? { initiative: null } : {}),
          },
        })
      }),
    )
  }

  private newCombatant(name: string, actor: Actor): Combatant {
    return {
      id: `manual:${this.uuid()}`,
      name: name.trim() || "Участник",
      ownerId: actor.id,
      initiative: null,
      bonus: 0,
      hp: 10,
      maxHp: 10,
      ac: 10,
      faction: actor.role === "GM" ? "npc" : "pc",
    }
  }

  addManual = async (name: string): Promise<void> => {
    const actor = this.requireActor()
    await this.dispatch({ kind: "add", combatant: this.newCombatant(name, actor) })
  }

  roll = async (id: string): Promise<void> => {
    const combatant = this.snapshot.combatants.find(c => c.id === id)
    if (!combatant) throw new Error("Участник уже удалён из боя.")
    await this.dispatch({
      kind: "roll",
      id,
      result: this.makeRoll(combatant.bonus, {
        ...this.snapshot.settings,
        rollMode: combatant.rollMode ?? this.snapshot.settings.rollMode,
      }),
    })
  }

  startCombat = async (): Promise<void> => {
    const ordered = orderedCombatants(this.snapshot)
    if (!ordered.length) throw new Error("Добавьте хотя бы одного участника.")
    await this.dispatch({
      kind: "turn",
      combatantId: ordered[0].id,
      round: 1,
      active: true,
      expectedEventId: this.snapshot.turn.eventId,
    })
  }

  endCombat = async (): Promise<void> => {
    await this.dispatch({
      kind: "turn",
      combatantId: null,
      round: this.snapshot.turn.round,
      active: false,
      expectedEventId: this.snapshot.turn.eventId,
    })
  }

  advance = async (direction: 1 | -1): Promise<void> => {
    const state = this.snapshot
    if (!state.turn.active) {
      await this.startCombat()
      return
    }
    const ordered = orderedCombatants(state)
    if (!ordered.length) throw new Error("Добавьте хотя бы одного участника.")
    const index = ordered.findIndex(c => c.id === state.turn.combatantId)
    const next = index < 0 ? 0 : (index + direction + ordered.length) % ordered.length
    const crossed = index >= 0 && (direction === 1 ? next <= index : next >= index)
    const round = Math.max(1, state.turn.round + (crossed ? direction : 0))
    await this.dispatch({
      kind: "turn",
      combatantId: ordered[next].id,
      round,
      active: true,
      expectedEventId: state.turn.eventId,
    })
  }
}

export const store = new CombatStore()
