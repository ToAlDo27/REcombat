// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ContextMenuContext, ContextMenuItem, Item, Modal } from "@owlbear-rodeo/sdk"
import { startTokenContextMenus, TOKEN_MENU_IDS } from "../src/contextMenu"
import { openTokenWindow, TOKEN_WINDOW_ID } from "../src/tokenWindowApi"
import { emptyState } from "../src/model"
import type { Snapshot } from "../src/types"

const { openModal } = vi.hoisted(() => ({
  openModal: vi.fn<[Modal], Promise<void>>(async () => undefined),
}))
vi.mock("@owlbear-rodeo/sdk", () => ({
  default: { modal: { open: openModal } },
}))

function token(id: string, patch: Partial<Item> = {}): Item {
  return {
    id,
    type: "IMAGE",
    name: `Token ${id}`,
    visible: true,
    locked: false,
    createdUserId: "gm",
    lastModified: "now",
    lastModifiedUserId: "gm",
    metadata: {},
    zIndex: 1,
    layer: "CHARACTER",
    position: { x: 0, y: 0 },
    rotation: 0,
    scale: { x: 1, y: 1 },
    ...patch,
  }
}

function fixture() {
  const snapshot: Snapshot = {
    ...emptyState(),
    ready: true,
    loading: false,
    pending: 0,
    sceneKey: "room/scene",
    actor: {
      id: "gm",
      connectionId: "gm",
      name: "GM",
      role: "GM",
      color: "#fff",
    },
    items: [token("hero"), token("mount", { layer: "MOUNT" })],
    party: [],
  }
  const menus = new Map<string, ContextMenuItem>()
  const sdk = {
    contextMenu: {
      create: vi.fn(async (menu: ContextMenuItem) => {
        menus.set(menu.id, menu)
      }),
      remove: vi.fn<[string], Promise<void>>(async () => undefined),
    },
    notification: { show: vi.fn(async () => "notice") },
  }
  const store = {
    getSnapshot: () => snapshot,
    addTokens: vi.fn<[Item[]], Promise<void>>(async () => undefined),
  }
  const open = vi.fn<[string, ("data" | "lss")?], Promise<void>>(async () => undefined)
  const start = () => startTokenContextMenus(store, sdk as never, open)
  const click = async (id: string, items: Item[] = snapshot.items) => {
    const context: ContextMenuContext = {
      items,
      selectionBounds: {
        min: { x: 0, y: 0 },
        max: { x: 100, y: 100 },
        center: { x: 50, y: 50 },
        width: 100,
        height: 100,
      },
    }
    await menus.get(id)!.onClick!(context, id)
  }
  return { snapshot, menus, sdk, store, open, start, click }
}

describe("token context menus", () => {
  beforeEach(() => vi.clearAllMocks())

  it("shows single-token actions and batch addition only for character/mount images", () => {
    const host = fixture()
    host.start()
    expect(host.menus.size).toBe(3)
    for (const menu of host.menus.values()) {
      const filter = menu.icons[0].filter!
      expect(filter.min).toBe(1)
      expect(filter.max).toBe(menu.id === TOKEN_MENU_IDS.add ? undefined : 1)
      const accepts = (item: Item) =>
        filter.every!.every(rule => {
          const actual = item[rule.key as keyof Item]
          return rule.operator === "!=" ? actual !== rule.value : actual === rule.value
        })
      expect(accepts(token("hero"))).toBe(true)
      expect(accepts(token("horse", { layer: "MOUNT" }))).toBe(true)
      for (const layer of ["MAP", "TEXT", "NOTE", "ATTACHMENT", "PROP"] as const)
        expect(accepts(token("other", { layer }))).toBe(false)
      expect(accepts(token("text", { type: "TEXT" }))).toBe(false)
    }
  })

  it("uses current scene tokens and adds a selected batch without resetting existing entries", async () => {
    const host = fixture()
    host.start()
    const stale = structuredClone(host.snapshot.items)
    host.snapshot.items[0].name = "Updated Hero"
    host.snapshot.combatants = [
      {
        id: "token:mount",
        tokenId: "mount",
        name: "Horse",
        ownerId: "gm",
        initiative: 22,
        bonus: 2,
        hp: 17,
        maxHp: 30,
        ac: 15,
        faction: "npc",
      },
    ]
    await host.click(TOKEN_MENU_IDS.add, [...stale, stale[0]])
    expect(host.store.addTokens).toHaveBeenCalledTimes(1)
    expect(host.store.addTokens).toHaveBeenCalledWith([host.snapshot.items[0]])
    expect(host.store.addTokens.mock.calls[0][0][0].name).toBe("Updated Hero")
    expect(host.snapshot.combatants[0]).toMatchObject({ initiative: 22, hp: 17 })
    expect(host.sdk.notification.show).toHaveBeenCalledWith(
      "Добавлено в REcombat: 1.",
      "SUCCESS",
    )
  })

  it("leaves already registered tokens alone and explains why no token was added", async () => {
    const host = fixture()
    host.start()
    host.snapshot.combatants = [
      {
        id: "token:hero",
        tokenId: "hero",
        name: "Hero",
        ownerId: "gm",
        initiative: 15,
        bonus: 1,
        hp: 5,
        maxHp: 10,
        ac: 12,
        faction: "pc",
      },
    ]
    await host.click(TOKEN_MENU_IDS.add, [host.snapshot.items[0]])
    expect(host.store.addTokens).not.toHaveBeenCalled()
    expect(host.sdk.notification.show).toHaveBeenCalledWith(
      "Выбранные токены уже участвуют в REcombat.",
      "INFO",
    )
  })

  it("opens token data and LSS binding/viewing without adding a combatant", async () => {
    const host = fixture()
    host.start()
    await host.click(TOKEN_MENU_IDS.data, [host.snapshot.items[0]])
    await host.click(TOKEN_MENU_IDS.lss, [host.snapshot.items[1]])
    expect(host.open.mock.calls).toEqual([
      ["hero", "data"],
      ["mount", "lss"],
    ])
    expect(host.store.addTokens).not.toHaveBeenCalled()
  })

  it("rejects removed tokens and waits for synchronization instead of using context copies", async () => {
    const host = fixture()
    host.start()
    const stale = structuredClone(host.snapshot.items)
    host.snapshot.items = []
    await host.click(TOKEN_MENU_IDS.data, stale)
    expect(host.open).not.toHaveBeenCalled()
    expect(host.sdk.notification.show).toHaveBeenLastCalledWith(
      "Токен недоступен или уже удалён из текущей сцены.",
      "ERROR",
    )
    host.snapshot.ready = false
    await host.click(TOKEN_MENU_IDS.add, stale)
    expect(host.sdk.notification.show).toHaveBeenLastCalledWith(
      "Дождитесь синхронизации сцены и повторите действие.",
      "ERROR",
    )
  })

  it("revalidates token types and visibility before running an action", async () => {
    const host = fixture()
    host.start()
    host.snapshot.actor!.role = "PLAYER"
    host.snapshot.items[0].visible = false
    host.snapshot.items[1].layer = "MAP"
    await host.click(TOKEN_MENU_IDS.add)
    expect(host.store.addTokens).not.toHaveBeenCalled()
    expect(host.sdk.notification.show).toHaveBeenLastCalledWith(
      "Токен недоступен или уже удалён из текущей сцены.",
      "ERROR",
    )
  })

  it("reports denied saves and failed modal opens through room notifications", async () => {
    const host = fixture()
    host.start()
    host.store.addTokens.mockRejectedValueOnce(new Error("Нет прав"))
    await host.click(TOKEN_MENU_IDS.add)
    expect(host.sdk.notification.show).toHaveBeenLastCalledWith("Нет прав", "ERROR")
    host.open.mockRejectedValueOnce(new Error("Окно недоступно"))
    await host.click(TOKEN_MENU_IDS.lss)
    expect(host.sdk.notification.show).toHaveBeenLastCalledWith(
      "Окно недоступно",
      "ERROR",
    )
  })

  it("removes registered menus once and makes old callbacks inactive on teardown", async () => {
    const host = fixture()
    const stop = host.start()
    await Promise.resolve()
    stop()
    stop()
    await vi.waitFor(() =>
      expect(host.sdk.contextMenu.remove.mock.calls.map(call => call[0]).sort()).toEqual(
        Object.values(TOKEN_MENU_IDS).sort(),
      ),
    )
    await host.click(TOKEN_MENU_IDS.add)
    await host.click(TOKEN_MENU_IDS.data)
    expect(host.store.addTokens).not.toHaveBeenCalled()
    expect(host.open).not.toHaveBeenCalled()
  })

  it("cleans up registrations that resolve after teardown", async () => {
    const host = fixture()
    const release: (() => void)[] = []
    host.sdk.contextMenu.create.mockImplementation(
      () => new Promise<void>(resolve => release.push(resolve)),
    )
    const stop = host.start()
    stop()
    release.forEach(resolve => resolve())
    await vi.waitFor(() => expect(host.sdk.contextMenu.remove).toHaveBeenCalledTimes(3))
  })

  it("reports registration errors without leaving unhandled rejections", async () => {
    const host = fixture()
    host.sdk.contextMenu.create.mockRejectedValueOnce(new Error("Меню недоступно"))
    host.start()
    await vi.waitFor(() =>
      expect(host.sdk.notification.show).toHaveBeenCalledWith("Меню недоступно", "ERROR"),
    )
  })
})

describe("token modal address", () => {
  it("keeps the deployment path and safely encodes the token and requested tab", async () => {
    const base = document.createElement("base")
    base.href = "https://toaldo27.github.io/REcombat/"
    document.head.append(base)
    try {
      await openTokenWindow("hero ?/#", "lss")
      const modal = openModal.mock.calls.at(-1)![0]
      const url = new URL(modal.url)
      expect(url.origin + url.pathname).toBe(
        "https://toaldo27.github.io/REcombat/token.html",
      )
      expect(url.searchParams.get("token")).toBe("hero ?/#")
      expect(url.searchParams.get("tab")).toBe("lss")
      expect(modal).toMatchObject({ id: TOKEN_WINDOW_ID, width: 560, height: 820 })
      await openTokenWindow("hero")
      expect(new URL(openModal.mock.calls.at(-1)![0].url).searchParams.get("tab")).toBe(
        "data",
      )
    } finally {
      base.remove()
    }
  })
})
