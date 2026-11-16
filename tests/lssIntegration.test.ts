// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Item, Metadata, Player } from "@owlbear-rodeo/sdk"
import { CombatStore, type CombatSDK } from "../src/store"
import {
  applyLssRoll,
  LSS_RELAY_CHANNEL,
  startLssIntegration,
} from "../src/lssIntegration"
import { LSS_SHEET_CHANNEL, type DiceRollPayload } from "../src/lssEvents"
import { TOKEN_DATA_KEY, tokenMetadata } from "../src/tokenData"
import type { Actor, TokenProfile } from "../src/types"

const broadcast = vi.hoisted(() => ({
  handlers: new Map<string, (event: { data: unknown }) => void>(),
  stops: [] as ReturnType<typeof vi.fn>[],
  send: vi.fn(),
  show: vi.fn(async () => "notification"),
}))
vi.mock("@owlbear-rodeo/sdk", () => ({
  default: {
    broadcast: {
      sendMessage: broadcast.send,
      onMessage: (channel: string, handler: (event: { data: unknown }) => void) => {
        broadcast.handlers.set(channel, handler)
        const stop = vi.fn(() => broadcast.handlers.delete(channel))
        broadcast.stops.push(stop)
        return stop
      },
    },
    notification: { show: broadcast.show },
  },
}))

const characterId = "687540d9b19b77c88dc839a3"
const otherCharacterId = "687540d9b19b77c88dc839a4"
const profile = (id = characterId, sync = true): TokenProfile => ({
  name: "Одинаковое имя",
  initiative: null,
  bonus: 4,
  hp: 21,
  maxHp: 30,
  ac: 17,
  faction: "pc",
  lss: {
    characterId: id,
    url: `https://longstoryshort.app/characters/digital/${id}/`,
    sync,
  },
})
const token = (id: string, data = profile(), owner = "player", visible = true): Item =>
  ({
    id,
    name: data.name,
    type: "IMAGE",
    layer: "CHARACTER",
    visible,
    createdUserId: owner,
    metadata: { [TOKEN_DATA_KEY]: tokenMetadata(data) },
  }) as Item
const roll: DiceRollPayload = {
  characterId,
  characterName: "Имя в листе отличается",
  title: "Инициатива",
  formula: "(1к20) + 4",
  breakdown: "(15) + 4",
  total: "19",
  isCrit: false,
  timestamp: 1794787200000,
}
const event = (patch: Partial<DiceRollPayload> = {}) => ({
  type: "lss:roll",
  payload: { ...roll, ...patch },
})
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const disposers: (() => void)[] = []

/** Real stores share a mocked OBR scene; assertions exercise replay and persistence. */
class Scene {
  metadata: Metadata = {}
  metadataListeners = new Set<(metadata: Metadata) => void>()
  itemListeners = new Set<(items: Item[]) => void>()
  readyListeners = new Set<(ready: boolean) => void>()
  partyListeners = new Set<(players: Player[]) => void>()
  actors = new Map<string, Player>()
  writes = vi.fn(async (update: Metadata) => {
    Object.assign(this.metadata, clone(update))
    for (const listener of this.metadataListeners) listener(clone(this.metadata))
  })
  constructor(public items: Item[]) {}
  sdk(id = "gm", role: Actor["role"] = "GM"): CombatSDK {
    const listen = <T>(set: Set<(value: T) => void>, listener: (value: T) => void) => {
      set.add(listener)
      return () => {
        set.delete(listener)
      }
    }
    this.actors.set(id, {
      id,
      role,
      name: id,
      connectionId: `connection-${id}`,
      color: "#ffffff",
      metadata: {},
      syncView: false,
    })
    for (const listener of this.partyListeners) listener([...this.actors.values()])
    return {
      isAvailable: true,
      isReady: true,
      onReady: callback => callback(),
      room: { id: "room" },
      player: {
        getId: async () => id,
        getConnectionId: async () => `connection-${id}`,
        getName: async () => id,
        getRole: async () => role,
        getColor: async () => "#ffffff",
        onChange: () => () => {},
      },
      party: {
        getPlayers: async () => [...this.actors.values()],
        onChange: callback => listen(this.partyListeners, callback),
      },
      scene: {
        isReady: async () => true,
        onReadyChange: callback => listen(this.readyListeners, callback),
        getMetadata: async () => clone(this.metadata),
        setMetadata: this.writes,
        onMetadataChange: callback => listen(this.metadataListeners, callback),
        items: {
          getItems: async () => clone(this.items),
          onChange: callback => listen(this.itemListeners, callback),
          updateItems: async (ids, update) => {
            const drafts = clone(this.items.filter(item => ids.includes(item.id)))
            update(drafts)
            this.items = this.items.map(
              item => drafts.find(draft => draft.id === item.id) ?? item,
            )
            for (const listener of this.itemListeners) listener(clone(this.items))
          },
        },
      },
    }
  }
  async store(id = "gm", role: Actor["role"] = "GM") {
    let serial = 0
    const store = new CombatStore(this.sdk(id, role), { uuid: () => `${id}-${++serial}` })
    disposers.push(store.start())
    await vi.waitFor(() => expect(store.getSnapshot().ready).toBe(true))
    return store
  }
}

beforeEach(() => {
  broadcast.send
    .mockReset()
    .mockImplementation(async (channel: string, data: unknown) => {
      broadcast.handlers.get(channel)?.({ data })
    })
})

afterEach(() => {
  disposers.splice(0).forEach(stop => stop())
  broadcast.handlers.clear()
  broadcast.stops.splice(0)
  broadcast.show.mockClear()
})

describe("LSS rolls applied to real scene-backed stores", () => {
  it("binds by character ID and leaves matching names and disabled links untouched", async () => {
    const scene = new Scene([
      token("bound"),
      token("namesake", profile(otherCharacterId)),
      token("disabled", profile(characterId, false)),
    ])
    const gm = await scene.store()
    await gm.addTokens(gm.getSnapshot().items)
    scene.writes.mockClear()
    expect(await applyLssRoll(gm, event())).toBe(1)
    expect(gm.getSnapshot().combatants.map(c => [c.tokenId, c.initiative])).toEqual([
      ["bound", 19],
      ["namesake", null],
      ["disabled", null],
    ])
    expect(scene.writes).toHaveBeenCalledTimes(1)
  })

  it("persists initiative on a configured token before adding it and deduplicates after registration", async () => {
    const scene = new Scene([token("bound")])
    const gm = await scene.store()
    expect(await applyLssRoll(gm, event())).toBe(1)
    expect(gm.getSnapshot().combatants).toEqual([])
    expect(gm.getSnapshot().tokenProfiles.bound).toMatchObject({
      initiative: 19,
      hp: 21,
      ac: 17,
    })
    await vi.waitFor(() =>
      expect(scene.items[0].metadata[TOKEN_DATA_KEY]).toMatchObject({ initiative: 19 }),
    )
    const firstKey = Object.keys(scene.metadata)[0]
    expect(firstKey).toContain(":token:bound")
    await gm.addTokens(gm.getSnapshot().items)
    expect(gm.getSnapshot().combatants[0]).toMatchObject({
      tokenId: "bound",
      initiative: 19,
      hp: 21,
      ac: 17,
    })
    const writes = scene.writes.mock.calls.length
    await applyLssRoll(gm, event())
    expect(scene.writes).toHaveBeenCalledTimes(writes)
    expect(Object.keys(scene.metadata)).toContain(firstKey)
  })

  it("shares the same event once across two clients and survives reloading a client", async () => {
    const scene = new Scene([token("bound")])
    const [gm, player] = await Promise.all([
      scene.store(),
      scene.store("player", "PLAYER"),
    ])
    await gm.addTokens(gm.getSnapshot().items)
    await Promise.all([applyLssRoll(gm, event()), applyLssRoll(player, event())])
    for (const store of [gm, player])
      expect(store.getSnapshot().combatants[0].initiative).toBe(19)
    // One registration plus one immutable event key, even when both clients receive it.
    expect(Object.keys(scene.metadata)).toHaveLength(2)
    const reloaded = await scene.store("reload")
    const writes = scene.writes.mock.calls.length
    await applyLssRoll(reloaded, event())
    expect(reloaded.getSnapshot().combatants[0].initiative).toBe(19)
    expect(scene.writes).toHaveBeenCalledTimes(writes)
  })

  it("elects the same GM by connection ID and only that client writes a received roll", async () => {
    const scene = new Scene([token("bound")])
    const [player, gmZ, gmY] = await Promise.all([
      scene.store("aaa", "PLAYER"),
      scene.store("zzz", "GM"),
      scene.store("yyy", "GM"),
    ])
    await gmZ.addTokens(gmZ.getSnapshot().items)
    scene.writes.mockClear()
    expect(
      await Promise.all(
        [player, gmZ, gmY].map(store => applyLssRoll(store, event(), true)),
      ),
    ).toEqual([0, 0, 1])
    expect(scene.writes).toHaveBeenCalledTimes(1)
    expect(Object.values(scene.writes.mock.calls[0][0])[0]).toMatchObject({
      actorId: "yyy",
      patch: { initiative: 19 },
    })
    for (const store of [player, gmZ, gmY])
      expect(store.getSnapshot().combatants[0].initiative).toBe(19)
  })

  it("without a GM elects each eligible owner, including a configured token outside combat", async () => {
    const scene = new Scene([
      token("own-a", profile(), "aaa"),
      token("own-b", profile(), "bbb"),
    ])
    scene.metadata = {
      "com.toaldo27.recombat/op/settings": {
        schema: 1,
        idempotencyId: "settings",
        clock: 1,
        actorId: "gm",
        kind: "settings",
        patch: { playerEdit: "own" },
      },
    }
    const [a, b] = await Promise.all([
      scene.store("aaa", "PLAYER"),
      scene.store("bbb", "PLAYER"),
    ])
    await a.addTokens([a.getSnapshot().items[0]])
    scene.writes.mockClear()
    expect(
      await Promise.all([a, b].map(store => applyLssRoll(store, event(), true))),
    ).toEqual([1, 1])
    expect(scene.writes).toHaveBeenCalledTimes(2)
    for (const store of [a, b]) {
      expect(store.getSnapshot().combatants[0].initiative).toBe(19)
      expect(store.getSnapshot().tokenProfiles["own-b"].initiative).toBe(19)
    }
  })

  it("ignores unrelated IDs, attacks, ambiguous totals, malformed events and disabled synchronization", async () => {
    const scene = new Scene([
      token("bound"),
      token("disabled", profile(characterId, false)),
    ])
    const gm = await scene.store()
    for (const input of [
      event({ characterId: otherCharacterId }),
      event({ title: "Атака Длинный меч" }),
      event({ total: "19 | 7" }),
      event({ total: "19 damage" }),
      { type: "lss:roll", payload: { ...roll, timestamp: NaN } },
      { type: "dnd:health", payload: { characterId, current: 3, max: 30, temp: 0 } },
    ])
      expect(await applyLssRoll(gm, input)).toBe(0)
    expect(scene.writes).not.toHaveBeenCalled()
    const disabled = new Scene([token("disabled", profile(characterId, false))])
    expect(await applyLssRoll(await disabled.store(), event())).toBe(0)
    expect(disabled.writes).not.toHaveBeenCalled()
  })

  it("respects ownership for combatants and tokens and skips invisible tokens for players", async () => {
    const scene = new Scene([
      token("own"),
      token("foreign", profile(), "gm"),
      token("hidden", profile(), "player", false),
    ])
    const gm = await scene.store()
    const player = await scene.store("player", "PLAYER")
    await player.addTokens([scene.items[0]])
    await gm.addTokens([scene.items[1]])
    await gm.dispatch({ kind: "settings", patch: { playerEdit: "own" } })
    scene.writes.mockClear()
    expect(await applyLssRoll(player, event())).toBe(1)
    expect(player.getSnapshot().combatants.map(c => [c.tokenId, c.initiative])).toEqual([
      ["own", 19],
      ["foreign", null],
    ])
    expect(player.getSnapshot().tokenProfiles.hidden).toBeUndefined()
    expect(scene.writes).toHaveBeenCalledTimes(1)
    // Before joining combat, createdUserId governs ownership.
    const unregistered = new Scene([
      token("foreign", profile(), "gm"),
      token("hidden", profile(), "player", false),
    ])
    const unregisteredGm = await unregistered.store()
    const unregisteredPlayer = await unregistered.store("player", "PLAYER")
    await unregisteredGm.dispatch({ kind: "settings", patch: { playerEdit: "own" } })
    unregistered.writes.mockClear()
    expect(await applyLssRoll(unregisteredPlayer, event())).toBe(0)
    expect(unregistered.writes).not.toHaveBeenCalled()
  })

  it("does not write before initialization or after the scene becomes unavailable", async () => {
    const scene = new Scene([token("bound")])
    const notStarted = new CombatStore(scene.sdk())
    expect(await applyLssRoll(notStarted, event())).toBe(0)
    const gm = await scene.store()
    for (const callback of scene.readyListeners) callback(false)
    expect(gm.getSnapshot().ready).toBe(false)
    expect(await applyLssRoll(gm, event())).toBe(0)
    expect(scene.writes).not.toHaveBeenCalled()
  })

  it("ignores copied sheet metadata on maps and still updates the next character token", async () => {
    const scene = new Scene([{ ...token("map"), layer: "MAP" } as Item, token("bound")])
    const gm = await scene.store()
    expect(await applyLssRoll(gm, event())).toBe(1)
    expect(gm.getSnapshot().tokenProfiles.map).toBeUndefined()
    expect(gm.getSnapshot().tokenProfiles.bound.initiative).toBe(19)
  })

  it("stops applying an in-flight event when the scene changes between token writes", async () => {
    const scene = new Scene([token("first"), token("second")])
    const gm = await scene.store()
    const originalWrite = scene.writes.getMockImplementation()!
    const previousScene = scene.metadata
    scene.writes.mockImplementationOnce(async update => {
      await originalWrite(update)
      for (const callback of scene.readyListeners) callback(false)
      scene.metadata = {}
      for (const callback of scene.readyListeners) callback(true)
      await vi.waitFor(() => expect(gm.getSnapshot().ready).toBe(true))
    })
    expect(await applyLssRoll(gm, event())).toBe(1)
    expect(Object.keys(previousScene)).toHaveLength(1)
    expect(scene.metadata).toEqual({})
    expect(scene.writes).toHaveBeenCalledTimes(1)
  })

  it("reports a rejected save and rolls back the optimistic initiative", async () => {
    const scene = new Scene([token("bound")])
    const gm = await scene.store()
    await gm.addTokens(gm.getSnapshot().items)
    scene.writes.mockRejectedValueOnce(new Error("Доступ отклонён сервером"))
    await expect(applyLssRoll(gm, event())).rejects.toThrow("Доступ отклонён")
    expect(gm.getSnapshot().combatants[0].initiative).toBeNull()
    expect(gm.getSnapshot().error).toContain("Доступ отклонён")
  })

  it("subscribes both official and direct-sheet relay channels and releases both listeners", async () => {
    const scene = new Scene([token("bound")])
    const gm = await scene.store()
    const stop = startLssIntegration(gm)
    expect([...broadcast.handlers.keys()]).toEqual([LSS_SHEET_CHANNEL, LSS_RELAY_CHANNEL])
    broadcast.handlers.get(LSS_SHEET_CHANNEL)!({ data: event() })
    await vi.waitFor(() =>
      expect(gm.getSnapshot().tokenProfiles.bound?.initiative).toBe(19),
    )
    expect(broadcast.send).toHaveBeenCalledWith(LSS_RELAY_CHANNEL, event(), {
      destination: "ALL",
    })
    const writes = scene.writes.mock.calls.length
    broadcast.handlers.get(LSS_RELAY_CHANNEL)!({ data: event() })
    await vi.waitFor(() => expect(gm.getSnapshot().pending).toBe(0))
    expect(scene.writes).toHaveBeenCalledTimes(writes)
    scene.writes.mockRejectedValueOnce(new Error("Нет доступа"))
    broadcast.handlers.get(LSS_RELAY_CHANNEL)!({
      data: event({ timestamp: roll.timestamp + 1 }),
    })
    await vi.waitFor(() =>
      expect(broadcast.show).toHaveBeenCalledWith("Нет доступа", "ERROR"),
    )
    stop()
    expect(broadcast.handlers.size).toBe(0)
    for (const dispose of broadcast.stops) expect(dispose).toHaveBeenCalledOnce()
  })

  it("forwards each official initiative once and bounds its replay cache", async () => {
    const scene = new Scene([token("bound")])
    const store = new CombatStore(scene.sdk())
    const stop = startLssIntegration(store)
    const receive = broadcast.handlers.get(LSS_SHEET_CHANNEL)!
    receive({ data: event() })
    receive({ data: event() })
    receive({ data: event({ title: "Атака" }) })
    receive({ data: event({ total: "19 | 7" }) })
    expect(broadcast.send).toHaveBeenCalledTimes(1)
    for (let i = 1; i <= 256; i++)
      receive({ data: event({ timestamp: roll.timestamp + i }) })
    expect(broadcast.send).toHaveBeenCalledTimes(257)
    receive({ data: event() })
    expect(broadcast.send).toHaveBeenCalledTimes(258)
    stop()
  })

  it("allows retrying an official event if its ALL relay failed", async () => {
    const scene = new Scene([token("bound")])
    const gm = await scene.store()
    const stop = startLssIntegration(gm)
    broadcast.send.mockRejectedValueOnce(new Error("Не удалось отправить бросок"))
    broadcast.handlers.get(LSS_SHEET_CHANNEL)!({ data: event() })
    await vi.waitFor(() =>
      expect(broadcast.show).toHaveBeenCalledWith("Не удалось отправить бросок", "ERROR"),
    )
    expect(scene.writes).not.toHaveBeenCalled()
    broadcast.handlers.get(LSS_SHEET_CHANNEL)!({ data: event() })
    await vi.waitFor(() =>
      expect(gm.getSnapshot().tokenProfiles.bound?.initiative).toBe(19),
    )
    expect(broadcast.send).toHaveBeenCalledTimes(2)
    stop()
  })
})
