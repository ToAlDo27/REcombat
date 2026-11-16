// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import type { Item, Metadata, Player } from "@owlbear-rodeo/sdk"
import { CombatStore, type CombatSDK } from "../src/store"
import { PREFIX, type Command, type Operation } from "../src/types"
import { TOKEN_DATA_KEY } from "../src/tokenData"

type Callback<T> = (value: T) => void
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const deferred = <T>() => {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
const token = (id: string, visible = true): Item =>
  ({ id, name: id, type: "IMAGE", layer: "CHARACTER", visible }) as Item
const listen = <T>(set: Set<Callback<T>>, callback: Callback<T>) => {
  set.add(callback)
  return () => {
    set.delete(callback)
  }
}

class SceneHub {
  metadata: Metadata = {}
  items: Item[] = [token("a"), token("b"), token("c")]
  clients: Client[] = []
  writes: Metadata[] = []
  heldWrites: (() => void)[] = []
  holdWrites = false
  failNext = false
  failNextItems = false
  itemWrites: Item[][] = []
  client(id: string, role: "GM" | "PLAYER" = "PLAYER") {
    const client = new Client(this, id, role)
    this.clients.push(client)
    return client
  }
  broadcast() {
    for (const client of this.clients)
      for (const callback of client.metadataListeners) callback(clone(this.metadata))
  }
  updateItems(ids: string[], update: (draft: Item[]) => void): Promise<void> {
    if (this.failNextItems) {
      this.failNextItems = false
      return Promise.reject(new Error("Токен временно недоступен"))
    }
    const draft = clone(this.items.filter(item => ids.includes(item.id)))
    update(draft)
    this.itemWrites.push(clone(draft))
    this.items = this.items.map(item => draft.find(next => next.id === item.id) ?? item)
    for (const client of this.clients)
      for (const callback of client.itemListeners) callback(clone(this.items))
    return Promise.resolve()
  }
  write(update: Metadata): Promise<void> {
    this.writes.push(clone(update))
    if (this.failNext) {
      this.failNext = false
      return Promise.reject(new Error("Сохранение отклонено сервером"))
    }
    // A server request belongs to the scene in which it was received.
    const scene = this.metadata
    const completion = deferred<void>()
    const apply = () => {
      Object.assign(scene, clone(update))
      if (this.metadata === scene) this.broadcast()
      completion.resolve()
    }
    if (this.holdWrites) this.heldWrites.push(apply)
    else apply()
    return completion.promise
  }
  flush(reverse = false) {
    const held = this.heldWrites.splice(0)
    for (const write of reverse ? held.reverse() : held) write()
  }
  changeScene(metadata: Metadata = {}) {
    for (const client of this.clients)
      for (const callback of client.readyListeners) callback(false)
    this.metadata = clone(metadata)
    for (const client of this.clients)
      for (const callback of client.readyListeners) callback(true)
  }
}

class Client implements CombatSDK {
  isAvailable = true
  isReady = true
  room = { id: "test-room" }
  metadataListeners = new Set<Callback<Metadata>>()
  readyListeners = new Set<Callback<boolean>>()
  itemListeners = new Set<Callback<Item[]>>()
  playerListeners = new Set<Callback<Player>>()
  partyListeners = new Set<Callback<Player[]>>()
  heldRead: ReturnType<typeof deferred<Metadata>> | null = null
  heldReady: ReturnType<typeof deferred<boolean>> | null = null
  constructor(
    readonly hub: SceneHub,
    readonly id: string,
    readonly role: "GM" | "PLAYER",
  ) {}
  onReady(callback: () => void) {
    callback()
  }
  get actor(): Player {
    return {
      id: this.id,
      connectionId: `connection-${this.id}`,
      name: this.id,
      role: this.role,
      color: "#ddaa33",
      syncView: false,
      metadata: {},
    }
  }
  player = {
    getId: async () => this.id,
    getConnectionId: async () => `connection-${this.id}`,
    getName: async () => this.id,
    getRole: async () => this.role,
    getColor: async () => "#ddaa33",
    onChange: (callback: Callback<Player>) => listen(this.playerListeners, callback),
  }
  party = {
    getPlayers: async () => this.hub.clients.map(client => client.actor),
    onChange: (callback: Callback<Player[]>) => listen(this.partyListeners, callback),
  }
  scene = {
    isReady: () => this.heldReady?.promise ?? Promise.resolve(true),
    onReadyChange: (callback: Callback<boolean>) => listen(this.readyListeners, callback),
    getMetadata: () =>
      this.heldRead?.promise ?? Promise.resolve(clone(this.hub.metadata)),
    setMetadata: (update: Metadata) => this.hub.write(update),
    onMetadataChange: (callback: Callback<Metadata>) =>
      listen(this.metadataListeners, callback),
    items: {
      getItems: async () => clone(this.hub.items),
      updateItems: (ids: string[], update: (draft: Item[]) => void) =>
        this.hub.updateItems(ids, update),
      onChange: (callback: Callback<Item[]>) => listen(this.itemListeners, callback),
    },
  }
}

const disposers: (() => void)[] = []
const makeStore = async (client: Client) => {
  let counter = 0
  const store = new CombatStore(client, {
    uuid: () => `${client.id}-${++counter}`,
    roll: (bonus, settings) => ({
      natural: 12,
      total: 12 + bonus,
      sides: settings.diceSides,
      mode: settings.rollMode,
    }),
  })
  disposers.push(store.start())
  await vi.waitFor(() => expect(store.getSnapshot().ready).toBe(true))
  return store
}
const waitReady = async (stores: CombatStore[]) => {
  await vi.waitFor(() =>
    stores.forEach(store => expect(store.getSnapshot().ready).toBe(true)),
  )
}
const addOp = (id: string, clock = 1): Operation => ({
  kind: "add",
  schema: 1,
  idempotencyId: `seed-${id}`,
  clock,
  actorId: "gm",
  combatant: {
    id,
    name: id,
    ownerId: "gm",
    initiative: 10,
    bonus: 0,
    hp: 20,
    maxHp: 20,
    ac: 10,
    faction: "npc",
  },
})
const journal = (...ops: Operation[]): Metadata =>
  Object.fromEntries(ops.map(op => [`${PREFIX}/op/${op.idempotencyId}`, op]))

afterEach(() => disposers.splice(0).forEach(dispose => dispose()))

describe("concurrent scene-backed CombatStore", () => {
  it("saves token cards before battle, inherits their initiative and keeps combat edits on the token", async () => {
    const hub = new SceneHub()
    const gm = await makeStore(hub.client("gm", "GM"))
    await gm.saveTokenProfile("a", {
      name: "Паладин",
      hp: 23,
      maxHp: 30,
      ac: 18,
      bonus: 4,
      initiative: 19,
      faction: "pc",
      rollMode: "advantage",
      lss: {
        characterId: "hero-1",
        url: "https://longstoryshort.app/characters/digital/hero-1/",
        sync: true,
      },
    })
    expect(gm.getSnapshot().combatants).toEqual([])
    await vi.waitFor(() =>
      expect(hub.items[0].metadata[TOKEN_DATA_KEY]).toMatchObject({
        schema: 1,
        name: "Паладин",
        hp: 23,
        initiative: 19,
      }),
    )
    const reloaded = await makeStore(hub.client("reload", "GM"))
    await reloaded.addTokens([token("a")])
    expect(reloaded.getSnapshot().combatants[0]).toMatchObject({
      name: "Паладин",
      hp: 23,
      maxHp: 30,
      initiative: 19,
      bonus: 4,
      rollMode: "advantage",
      lss: { characterId: "hero-1" },
    })
    await gm.dispatch({ kind: "hp", id: "token:a", delta: -7 })
    await gm.addTokens([token("a")], { initiative: "roll" })
    expect(gm.getSnapshot().combatants[0].hp).toBe(16)
    expect(gm.getSnapshot().combatants[0].initiative).toBe(19)
    await vi.waitFor(() =>
      expect(hub.items[0].metadata[TOKEN_DATA_KEY]).toMatchObject({ hp: 16 }),
    )
  })

  it("merges concurrent card fields, rolls with per-token mode, and restores a removed participant", async () => {
    const hub = new SceneHub()
    const [alice, bob] = await Promise.all([
      makeStore(hub.client("alice", "GM")),
      makeStore(hub.client("bob", "GM")),
    ])
    hub.holdWrites = true
    const edits = [
      alice.saveTokenProfile("a", { name: "Mage", ac: 16 }),
      bob.saveTokenProfile("a", { bonus: 5, rollMode: "disadvantage" }),
    ]
    hub.flush(true)
    await Promise.all(edits)
    expect(alice.getSnapshot().tokenProfiles.a).toMatchObject({
      name: "Mage",
      ac: 16,
      bonus: 5,
      rollMode: "disadvantage",
    })
    expect(bob.getSnapshot().tokenProfiles).toEqual(alice.getSnapshot().tokenProfiles)
    hub.holdWrites = false
    await alice.addTokens([token("a")], { initiative: "roll" })
    expect(alice.getSnapshot().combatants[0]).toMatchObject({
      initiative: 17,
      lastRoll: { mode: "disadvantage" },
    })
    await bob.dispatch({
      kind: "patch",
      id: "token:a",
      patch: { hp: 6, lss: null, rollMode: null },
    })
    await alice.roll("token:a")
    expect(alice.getSnapshot().combatants[0].lastRoll?.mode).toBe("normal")
    await bob.dispatch({ kind: "remove", id: "token:a" })
    await alice.addTokens([token("a")], { initiative: "empty" })
    expect(alice.getSnapshot().combatants[0]).toMatchObject({
      hp: 6,
      name: "Mage",
      ac: 16,
      initiative: null,
    })
  })

  it("repairs token metadata from the journal after a failed token update and reload", async () => {
    const hub = new SceneHub()
    const store = await makeStore(hub.client("gm", "GM"))
    hub.failNextItems = true
    await store.saveTokenProfile("a", { name: "Durable", hp: 8 })
    await vi.waitFor(() =>
      expect(store.getSnapshot().error).toContain("Данные сохранены в сцене"),
    )
    expect(store.getSnapshot().tokenProfiles.a).toMatchObject({ name: "Durable", hp: 8 })
    const reloaded = await makeStore(hub.client("new", "GM"))
    await vi.waitFor(() =>
      expect(hub.items[0].metadata[TOKEN_DATA_KEY]).toMatchObject({
        name: "Durable",
        hp: 8,
      }),
    )
    expect(reloaded.getSnapshot().tokenProfiles).toEqual(
      store.getSnapshot().tokenProfiles,
    )
  })

  it("merges 3 players adding tokens simultaneously and never writes a whole register", async () => {
    const hub = new SceneHub()
    const stores = await Promise.all(
      ["alice", "bob", "carol"].map(id => makeStore(hub.client(id))),
    )
    expect(hub.writes).toHaveLength(0)
    hub.holdWrites = true
    const writes = stores.map((store, index) => store.addTokens([token("abc"[index])]))
    hub.flush(true)
    await Promise.all(writes)
    expect(stores[0].getSnapshot().combatants).toHaveLength(3)
    for (const store of stores)
      expect(store.getSnapshot().combatants).toEqual(stores[0].getSnapshot().combatants)
    expect(hub.writes).toHaveLength(3)
    for (const update of hub.writes) {
      expect(Object.keys(update)).toHaveLength(1)
      expect(Object.keys(update)[0]).toMatch(/^com\.toaldo27\.recombat\/op\//)
    }
    expect(Object.keys(hub.metadata)).toHaveLength(3)
  })

  it("deduplicates the same token and retains independent edits and all HP deltas", async () => {
    const hub = new SceneHub()
    const stores = await Promise.all(
      ["alice", "bob", "carol"].map(id => makeStore(hub.client(id))),
    )
    hub.holdWrites = true
    const adds = stores.map(store => store.addTokens([token("a")]))
    hub.flush(true)
    await Promise.all(adds)
    expect(stores[0].getSnapshot().combatants).toHaveLength(1)
    const id = "token:a"
    const edits = [
      stores[0].dispatch({ kind: "patch", id, patch: { name: "Fighter", ac: 17 } }),
      stores[1].dispatch({ kind: "patch", id, patch: { bonus: 4 } }),
      stores[2].dispatch({ kind: "hp", id, delta: -2 }),
      stores[0].dispatch({ kind: "hp", id, delta: -3 }),
    ]
    hub.flush(true)
    await Promise.all(edits)
    for (const store of stores)
      expect(store.getSnapshot().combatants[0]).toMatchObject({
        id,
        name: "Fighter",
        ac: 17,
        bonus: 4,
        hp: 5,
      })
    const restored = await makeStore(hub.client("reload"))
    expect(restored.getSnapshot().combatants).toEqual(stores[0].getSnapshot().combatants)
    expect(hub.writes).toHaveLength(7)
  })

  it("does not overwrite a metadata event with a delayed initial read", async () => {
    const hub = new SceneHub()
    const client = hub.client("late")
    const read = deferred<Metadata>()
    client.heldRead = read
    const store = new CombatStore(client)
    disposers.push(store.start())
    await vi.waitFor(() => expect(client.metadataListeners.size).toBe(1))
    hub.metadata = journal(addOp("early"), addOp("new", 2))
    hub.broadcast()
    read.resolve(journal(addOp("early")))
    await waitReady([store])
    expect(store.getSnapshot().combatants.map(c => c.id)).toEqual(["early", "new"])
    expect(hub.writes).toHaveLength(0)
  })

  it("ignores a stale ready check and stale metadata from the previous scene", async () => {
    const hub = new SceneHub()
    const client = hub.client("gm", "GM")
    const ready = deferred<boolean>()
    const oldRead = deferred<Metadata>()
    client.heldReady = ready
    client.heldRead = oldRead
    const store = new CombatStore(client)
    disposers.push(store.start())
    for (const callback of client.readyListeners) callback(true)
    await vi.waitFor(() => expect(client.metadataListeners.size).toBe(1))
    client.heldRead = null
    hub.changeScene(journal(addOp("new-scene")))
    ready.resolve(false)
    oldRead.resolve(journal(addOp("old-scene")))
    await waitReady([store])
    expect(store.getSnapshot().combatants.map(c => c.id)).toEqual(["new-scene"])
    expect(hub.writes).toHaveLength(0)
  })

  it("discards old optimistic operations after a scene change", async () => {
    const hub = new SceneHub()
    const store = await makeStore(hub.client("gm", "GM"))
    hub.holdWrites = true
    const oldScene = hub.metadata
    const pending = store.addManual("Old fighter")
    expect(store.getSnapshot().pending).toBe(1)
    hub.changeScene(journal(addOp("new-scene")))
    await waitReady([store])
    hub.flush()
    await pending
    expect(store.getSnapshot().combatants.map(c => c.id)).toEqual(["new-scene"])
    expect(store.getSnapshot().pending).toBe(0)
    expect(Object.keys(oldScene)).toHaveLength(1)
    expect(Object.keys(hub.metadata)).toHaveLength(1)
  })

  it("turns two simultaneous Next clicks into one transition and persists the round", async () => {
    const hub = new SceneHub()
    hub.metadata = journal(addOp("a"), addOp("b", 2))
    const stores = await Promise.all([
      makeStore(hub.client("alice", "GM")),
      makeStore(hub.client("bob", "GM")),
    ])
    await stores[0].startCombat()
    hub.holdWrites = true
    const nexts = stores.map(store => store.advance(1))
    hub.flush(true)
    await Promise.all(nexts)
    for (const store of stores)
      expect(store.getSnapshot().turn).toMatchObject({ combatantId: "b", round: 1 })
    hub.holdWrites = false
    await stores[1].advance(1)
    expect(stores[0].getSnapshot().turn).toMatchObject({ combatantId: "a", round: 2 })
    const reloaded = await makeStore(hub.client("reload", "GM"))
    expect(reloaded.getSnapshot().turn).toEqual(stores[0].getSnapshot().turn)
  })

  it("rolls back a failed save and surfaces a visible error", async () => {
    const hub = new SceneHub()
    const store = await makeStore(hub.client("alice"))
    hub.failNext = true
    await expect(store.addManual("Unsaved")).rejects.toThrow("отклонено")
    expect(store.getSnapshot().combatants).toHaveLength(0)
    expect(store.getSnapshot().pending).toBe(0)
    expect(store.getSnapshot().error).toContain("отклонено")
    expect(hub.metadata).toEqual({})
  })

  it("enforces role/edit settings and ignores hidden tokens for players", async () => {
    const hub = new SceneHub()
    const gm = await makeStore(hub.client("gm", "GM"))
    const player = await makeStore(hub.client("player"))
    await gm.addTokens([token("a")])
    await player.dispatch({ kind: "patch", id: "token:a", patch: { ac: 18 } })
    await gm.dispatch({ kind: "settings", patch: { playerEdit: "own" } })
    const denied: Command[] = [
      { kind: "patch", id: "token:a", patch: { ac: 12 } },
      { kind: "settings", patch: { sound: false } },
      { kind: "resetInitiative" },
    ]
    for (const command of denied) await expect(player.dispatch(command)).rejects.toThrow()
    await expect(player.startCombat()).rejects.toThrow("ведущий")
    await player.addTokens([token("hidden", false)])
    expect(player.getSnapshot().combatants).toHaveLength(1)
    await gm.dispatch({ kind: "settings", patch: { playersCanAdvance: true } })
    await player.startCombat()
    expect(gm.getSnapshot().turn.active).toBe(true)
  })

  it("cleans subscriptions on stop and does not initialize unavailable SDKs", async () => {
    const hub = new SceneHub()
    const client = hub.client("alice")
    const store = new CombatStore(client)
    const first = store.start()
    const second = store.start()
    await waitReady([store])
    first()
    expect(client.metadataListeners.size).toBe(1)
    second()
    second()
    expect(client.metadataListeners.size).toBe(0)
    expect(client.readyListeners.size).toBe(0)
    expect(store.getSnapshot().ready).toBe(false)
    client.isAvailable = false
    const stop = store.start()
    expect(store.getSnapshot().loading).toBe(false)
    expect(client.readyListeners.size).toBe(0)
    expect(hub.writes).toHaveLength(0)
    stop()
  })
})
