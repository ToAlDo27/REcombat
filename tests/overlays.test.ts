import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Item, Label, Path } from "@owlbear-rodeo/sdk"
import { createOverlayRenderer } from "../src/overlays"
import { PREFIX, type Snapshot } from "../src/types"
import { tokenProfileFromCombatant } from "../src/tokenData"

vi.mock("@owlbear-rodeo/sdk", () => ({ default: {} }))

function fixture(): Snapshot {
  return {
    ready: true,
    loading: false,
    pending: 0,
    sceneKey: "scene-a",
    opCount: 2,
    tokenProfiles: {},
    actor: {
      id: "player",
      connectionId: "connection",
      name: "Player",
      role: "PLAYER",
      color: "#fff",
    },
    party: [],
    settings: {
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
    },
    combatants: [
      {
        id: "token:one",
        tokenId: "one",
        name: "Hero",
        ownerId: "player",
        initiative: 15,
        hp: 12,
        maxHp: 20,
        ac: 16,
        bonus: 2,
        faction: "pc",
      },
    ],
    turn: { active: true, combatantId: "token:one", round: 1, eventId: "turn-1" },
    items: [
      {
        id: "one",
        type: "IMAGE",
        name: "Hero",
        visible: true,
        locked: false,
        createdUserId: "player",
        lastModified: "now",
        lastModifiedUserId: "player",
        metadata: {},
        zIndex: 1,
        layer: "CHARACTER",
        position: { x: 200, y: 300 },
        rotation: 0,
        scale: { x: 1, y: 1 },
      },
    ],
  }
}

function host(initial: Item[] = []) {
  let items = structuredClone(initial)
  const local = {
    getItems: vi.fn(async () => structuredClone(items)),
    addItems: vi.fn(async (added: Item[]) => {
      items.push(...structuredClone(added))
    }),
    deleteItems: vi.fn(async (ids: string[]) => {
      items = items.filter(item => !ids.includes(item.id))
    }),
    updateItems: vi.fn(async (selected: Item[], update: (draft: Item[]) => void) => {
      // Like the SDK, array input itself is the Immer base for generated host patches.
      const before = structuredClone(selected)
      const draft = structuredClone(selected)
      update(draft)
      for (let index = 0; index < draft.length; index++) {
        const existing = items.find(item => item.id === draft[index].id)
        if (!existing) continue
        for (const key of Object.keys(draft[index])) {
          if (
            JSON.stringify((before[index] as unknown as Record<string, unknown>)[key]) !==
            JSON.stringify((draft[index] as unknown as Record<string, unknown>)[key])
          ) {
            Object.assign(existing, {
              [key]: (draft[index] as unknown as Record<string, unknown>)[key],
            })
          }
        }
      }
    }),
  }
  const shared = {
    getItemBounds: vi.fn(async () => ({
      min: { x: 150, y: 250 },
      max: { x: 250, y: 350 },
      center: { x: 200, y: 300 },
      width: 100,
      height: 100,
    })),
    addItems: vi.fn(),
    updateItems: vi.fn(),
    deleteItems: vi.fn(),
  }
  return { sdk: { scene: { local, items: shared } }, local, shared, items: () => items }
}

describe("local token overlays", () => {
  beforeEach(() => vi.restoreAllMocks())

  it("shows a configured token's HP/AC before combat and keeps it after roster removal", async () => {
    const state = fixture()
    state.tokenProfiles.one = tokenProfileFromCombatant(state.combatants[0])
    state.combatants = []
    state.turn.active = false
    const mock = host()
    const renderer = createOverlayRenderer(mock.sdk as never)
    renderer.render(state)
    await vi.waitFor(() => expect(mock.items()).toHaveLength(1))
    expect((mock.items()[0] as Label).text.plainText).toBe("ХП 12/20  ·  КЗ 16")
    expect(mock.items()[0].attachedTo).toBe("one")
    await renderer.destroy()
  })

  it("renders host-sized HP/AC and an attached halo without changing any shared token", async () => {
    const state = fixture()
    const mock = host()
    const renderer = createOverlayRenderer(mock.sdk as never)
    renderer.render(state)
    await vi.waitFor(() => expect(mock.items()).toHaveLength(2))
    const label = mock.items().find(item => item.type === "LABEL") as Label
    const halo = mock.items().find(item => item.type === "PATH") as Path
    expect(label.text.plainText).toBe("ХП 12/20  ·  КЗ 16")
    expect(label.attachedTo).toBe("one")
    expect(label.position).toEqual({ x: 200, y: 358 })
    expect(halo.position).toEqual({ x: 200, y: 300 })
    expect(halo.commands[0]).toEqual([0, 59, 0])
    expect(mock.shared.getItemBounds).toHaveBeenCalledWith(["one"])
    expect(mock.shared.addItems).not.toHaveBeenCalled()
    expect(mock.shared.updateItems).not.toHaveBeenCalled()
    expect(mock.shared.deleteItems).not.toHaveBeenCalled()
    await renderer.destroy()
    expect(mock.items()).toHaveLength(0)
  })

  it("updates stats in place, caches unchanged geometry, and follows new host bounds", async () => {
    const state = fixture()
    const mock = host()
    const renderer = createOverlayRenderer(mock.sdk as never)
    renderer.render(state)
    await vi.waitFor(() => expect(mock.items()).toHaveLength(2))
    const labelId = mock.items().find(item => item.type === "LABEL")!.id
    const changed = structuredClone(state)
    changed.combatants[0].hp = 4
    renderer.render(changed)
    await vi.waitFor(() =>
      expect(
        (mock.items().find(item => item.id === labelId) as Label).text.plainText,
      ).toContain("ХП 4/20"),
    )
    expect(mock.shared.getItemBounds).toHaveBeenCalledTimes(1)
    expect(mock.local.addItems).toHaveBeenCalledTimes(1)
    const moved = structuredClone(changed)
    moved.items[0].position.x = 800
    mock.shared.getItemBounds.mockResolvedValueOnce({
      min: { x: 750, y: 250 },
      max: { x: 850, y: 350 },
      center: { x: 800, y: 300 },
      width: 100,
      height: 100,
    })
    renderer.render(moved)
    await vi.waitFor(() =>
      expect(mock.items().find(item => item.id === labelId)!.position.x).toBe(800),
    )
    await renderer.destroy()
  })

  it("omits invisible tokens and hidden NPC stats for players", async () => {
    const state = fixture()
    const mock = host()
    const renderer = createOverlayRenderer(mock.sdk as never)
    state.items[0].visible = false
    renderer.render(state)
    await new Promise(resolve => setTimeout(resolve, 5))
    expect(mock.items()).toEqual([])
    expect(mock.shared.getItemBounds).not.toHaveBeenCalled()
    const npc = fixture()
    npc.combatants[0].faction = "npc"
    npc.settings.hideNpcStats = true
    renderer.render(npc)
    await vi.waitFor(() => expect(mock.items()).toHaveLength(1))
    expect(mock.items()[0].type).toBe("PATH")
    const gm = structuredClone(npc)
    gm.actor!.role = "GM"
    renderer.render(gm)
    await vi.waitFor(() => expect(mock.items()).toHaveLength(2))
    await renderer.destroy()
  })

  it("discards stale bounds results and removes only REcombat overlays on startup", async () => {
    const token = fixture().items[0]
    const stale = {
      ...token,
      id: "stale-local",
      metadata: { [`${PREFIX}/overlay`]: { owner: "old" } },
    }
    const foreign = { ...token, id: "other-extension" }
    const mock = host([stale, foreign])
    const renderer = createOverlayRenderer(mock.sdk as never)
    let release:
      | ((value: {
          min: { x: number; y: number }
          max: { x: number; y: number }
          center: { x: number; y: number }
          width: number
          height: number
        }) => void)
      | undefined
    mock.shared.getItemBounds.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          release = resolve
        }),
    )
    renderer.render(fixture())
    await vi.waitFor(() => expect(release).toBeDefined())
    const changed = fixture()
    changed.settings.showHp = false
    changed.settings.showAc = false
    changed.settings.highlight = false
    renderer.render(changed)
    release!({
      min: { x: 150, y: 250 },
      max: { x: 250, y: 350 },
      center: { x: 200, y: 300 },
      width: 100,
      height: 100,
    })
    await vi.waitFor(() =>
      expect(mock.local.getItems.mock.calls.length).toBeGreaterThan(1),
    )
    expect(mock.items().map(item => item.id)).toEqual(["other-extension"])
    expect(mock.local.addItems).not.toHaveBeenCalled()
    await renderer.destroy()
    expect(mock.items()).toHaveLength(1)
  })

  it("reconciles a reopened scene and removes the previous turn halo", async () => {
    const state = fixture()
    const mock = host()
    const renderer = createOverlayRenderer(mock.sdk as never)
    renderer.render(state)
    await vi.waitFor(() => expect(mock.items()).toHaveLength(2))
    renderer.render({ ...state, ready: false })
    await new Promise(resolve => setTimeout(resolve, 5))
    const reopened = structuredClone(state)
    reopened.sceneKey = "scene-b"
    reopened.turn.active = false
    renderer.render(reopened)
    await vi.waitFor(() => expect(mock.items()).toHaveLength(1))
    expect(mock.items()[0].type).toBe("LABEL")
    await renderer.destroy()
  })
})
