import { readFileSync } from "node:fs"
import { expect, test, type Frame, type Page } from "@playwright/test"
import type { ContextMenuItem, Image, Metadata, Modal } from "@owlbear-rodeo/sdk"
import type { SheetEvent } from "@longstoryshort/vtt-sdk"
import type { Snapshot } from "../../src/types"
import { SharedScene, type MockWindow } from "./room"

const PREFIX = "com.toaldo27.recombat"
const PROFILE_KEY = `${PREFIX}/token`
const MENU = {
  add: `${PREFIX}/add-token`,
  data: `${PREFIX}/token-data`,
  lss: `${PREFIX}/token-lss`,
}
const MODAL_ID = `${PREFIX}/token-window`
const TOKEN_ID = "страж & лучник / 42"
const LSS_ORIGIN = "https://longstoryshort.app"
const SHEET_URL = `${LSS_ORIGIN}/iframe/characters/digital/menu-hero/`
const CHARACTER_URL = `${LSS_ORIGIN}/characters/digital/menu-hero/`
const sheetSdk = readFileSync(
  new URL("../../node_modules/@longstoryshort/vtt-sdk/dist/index.js", import.meta.url),
  "utf8",
)

type MenuWindow = MockWindow & {
  __obrMock: {
    contextMenus: ContextMenuItem[]
    modalOpens: Modal[]
    modalCloses: string[]
    roomMetadata: Metadata
    roomWrites: Metadata[]
    receiveRoomMetadata(metadata: Metadata): void
    clickContextMenu(id: string, itemIds: string[]): Promise<void>
  }
}
type MockSheetWindow = Window & { sendSheetEvent(event: SheetEvent): void }

const token: Image = {
  id: TOKEN_ID,
  type: "IMAGE",
  name: "Страж",
  layer: "CHARACTER",
  position: { x: 300, y: 300 },
  rotation: 0,
  scale: { x: 1, y: 1 },
  zIndex: 1,
  visible: true,
  locked: false,
  metadata: {
    [PROFILE_KEY]: {
      schema: 1,
      name: "Страж",
      hp: 18,
      maxHp: 25,
      ac: 14,
      bonus: 3,
      initiative: 17,
      faction: "pc",
      lss: { characterId: "menu-hero", url: CHARACTER_URL, sync: true },
    },
  },
  createdUserId: "Мастер",
  lastModifiedUserId: "Мастер",
  lastModified: "2026-11-16T00:00:00.000Z",
  image: {
    width: 150,
    height: 150,
    mime: "image/png",
    url: "https://example.test/guard.png",
  },
  grid: { dpi: 150, offset: { x: 0, y: 0 } },
}

const snapshot = (page: Page): Promise<Snapshot> =>
  page.evaluate(async () => {
    const source = "/src/store.ts"
    const { store } = await import(source)
    return store.getSnapshot()
  })

const clickMenu = (page: Page, id: string, itemIds = [TOKEN_ID]) =>
  page.evaluate(
    ({ id, itemIds }) =>
      (window as MenuWindow).__obrMock.clickContextMenu(id, itemIds),
    { id, itemIds },
  )

async function background(scene: SharedScene, page: Page) {
  // This is a host-adapter contract harness. Owlbear's native right-click UI is
  // outside the extension iframe and is deliberately not imitated here.
  await expect
    .poll(async () =>
      page.evaluate(() =>
        (window as MenuWindow).__obrMock.contextMenus.map(menu => menu.id),
      ),
    )
    .toEqual(Object.values(MENU))
  await expect.poll(async () => (await snapshot(page)).ready).toBe(true)
  await expect(page.locator("#root")).toHaveCount(0)
  await expect(page.getByRole("textbox", { name: "Имя участника" })).toHaveCount(0)
  expect(scene.errors).toEqual([])
}

async function installModalHost(page: Page) {
  await page.exposeFunction("__obrOpenModal", async (modal: Modal) => {
    await page.evaluate(modal => {
      document.querySelector("iframe[data-obr-modal]")?.remove()
      const frame = document.createElement("iframe")
      frame.dataset.obrModal = modal.id
      frame.title = "Owlbear extension modal"
      const url = new URL(modal.url, location.href)
      const query = new URLSearchParams(location.search)
      for (const key of ["client", "role"])
        if (query.has(key)) url.searchParams.set(key, query.get(key)!)
      frame.src = url.href
      frame.width = String(modal.width ?? 560)
      frame.height = String(modal.height ?? 820)
      frame.style.maxWidth = "100vw"
      frame.style.border = "0"
      document.body.style.margin = "0"
      document.body.append(frame)
    }, modal)
  })
  await page.exposeFunction("__obrCloseModal", async (id: string) => {
    await page.evaluate(id => {
      const frame = document.querySelector<HTMLIFrameElement>("iframe[data-obr-modal]")
      if (frame?.dataset.obrModal === id) frame.remove()
    }, id)
  })
}

async function modalFrame(page: Page, tab: "data" | "lss"): Promise<Frame> {
  await expect
    .poll(() =>
      page.frames().some(frame => {
        const url = new URL(frame.url(), "http://127.0.0.1:4175")
        return url.pathname === "/token.html" && url.searchParams.get("tab") === tab
      }),
    )
    .toBe(true)
  return page.frames().find(frame => {
    const url = new URL(frame.url(), "http://127.0.0.1:4175")
    return url.pathname === "/token.html" && url.searchParams.get("tab") === tab
  })!
}

test("background token menus add once across clients and edit a real token modal with the tracker closed", async ({
  context,
}) => {
  const scene = new SharedScene()
  scene.items = [structuredClone(token)]
  const master = await scene.page(context, "Мастер", "GM", "/background.html")
  const player = await scene.page(context, "Игрок", "PLAYER", "/background.html")
  await background(scene, master)
  await background(scene, player)
  await installModalHost(master)
  await master.setViewportSize({ width: 640, height: 1050 })

  await Promise.all([clickMenu(master, MENU.add), clickMenu(player, MENU.add)])
  await expect.poll(async () => (await snapshot(master)).combatants.length).toBe(1)
  await expect.poll(async () => (await snapshot(player)).combatants.length).toBe(1)
  expect((await snapshot(master)).combatants[0]).toMatchObject({
    tokenId: TOKEN_ID,
    hp: 18,
    maxHp: 25,
    ac: 14,
    bonus: 3,
    initiative: 17,
    lss: { characterId: "menu-hero" },
  })

  await clickMenu(master, MENU.data)
  const opens = await master.evaluate(() => (window as MenuWindow).__obrMock.modalOpens)
  expect(opens).toHaveLength(1)
  expect(opens[0].id).toBe(MODAL_ID)
  const openedUrl = new URL(opens[0].url)
  expect(openedUrl.pathname).toBe("/token.html")
  expect(openedUrl.searchParams.get("token")).toBe(TOKEN_ID)
  expect(openedUrl.searchParams.get("tab")).toBe("data")
  const modal = await modalFrame(master, "data")
  const form = modal.getByRole("form", { name: "Карточка токена Страж", exact: true })
  await expect(form.getByLabel("Текущие ХП", { exact: true })).toHaveValue("18")
  await expect(form.getByLabel("Максимальные ХП", { exact: true })).toHaveValue("25")
  await expect(form.getByLabel("Класс защиты", { exact: true })).toHaveValue("14")
  await expect(form.getByLabel("Бонус инициативы", { exact: true })).toHaveValue("3")
  await expect(form.getByLabel("Инициатива", { exact: true })).toHaveValue("17")
  await form.getByLabel("Текущие ХП", { exact: true }).fill("12")
  await form.getByLabel("Класс защиты", { exact: true }).fill("16")
  await form.getByLabel("Бонус инициативы", { exact: true }).fill("5")
  await form.getByLabel("Инициатива", { exact: true }).fill("22")
  await master.screenshot({ path: "test-results-menu/token-modal-560px.png", fullPage: true })
  await master.setViewportSize({ width: 400, height: 1050 })
  expect(await modal.evaluate(() => innerWidth)).toBe(400)
  expect(
    await modal.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true)
  await master.screenshot({ path: "test-results-menu/token-modal-400px.png", fullPage: true })
  await form.getByRole("button", { name: "Сохранить карточку", exact: true }).click()
  await expect
    .poll(() => scene.items[0].metadata[PROFILE_KEY])
    .toMatchObject({ hp: 12, maxHp: 25, ac: 16, bonus: 5, initiative: 22 })
  await expect
    .poll(async () => (await snapshot(player)).combatants[0])
    .toMatchObject({ hp: 12, ac: 16, bonus: 5, initiative: 22 })
  const saved = structuredClone(scene.items[0].metadata[PROFILE_KEY])
  const writes = scene.writes.length
  await Promise.all([clickMenu(master, MENU.add), clickMenu(player, MENU.add)])
  expect((await snapshot(master)).combatants).toHaveLength(1)
  expect((await snapshot(player)).combatants).toHaveLength(1)
  expect(scene.items[0].metadata[PROFILE_KEY]).toEqual(saved)
  expect(scene.writes).toHaveLength(writes)
  scene.assertAtomicWrites()
  expect(scene.errors).toEqual([])
})

test("LSS token menu opens the bound sheet and receives SDK HP and initiative with the tracker closed", async ({
  context,
}) => {
  const scene = new SharedScene()
  scene.items = [structuredClone(token)]
  await context.route(`${LSS_ORIGIN}/iframe/characters/**`, route =>
    route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: `<!doctype html><html><head><meta charset="UTF-8"></head><body><h1>LSS public SDK fixture</h1><script type="module">${sheetSdk}
        const client = createSheetClient({ targetOrigin: "http://127.0.0.1:4175" });
        window.sendSheetEvent = event => client.send(event);
      </script></body></html>`,
    }),
  )
  const page = await scene.page(context, "Мастер", "GM", "/background.html")
  await background(scene, page)
  await installModalHost(page)
  await clickMenu(page, MENU.lss)
  const modal = await modalFrame(page, "lss")
  const iframe = modal.getByTitle("Лист персонажа Long Story Short")
  await expect(iframe).toHaveAttribute("src", SHEET_URL)
  const external = modal.getByRole("link", { name: /LSS.*↗/ })
  await expect(external).toHaveAttribute("href", CHARACTER_URL)
  await expect(external).toHaveAttribute("target", "_blank")
  await expect(external).toHaveAttribute("rel", /noreferrer|noopener/)
  await expect.poll(() => page.frame({ url: SHEET_URL }) !== null).toBe(true)
  const sheet = page.frame({ url: SHEET_URL })!
  await sheet.waitForFunction(
    () => typeof (window as MockSheetWindow).sendSheetEvent === "function",
  )
  await sheet.evaluate(() => {
    const sender = window as MockSheetWindow
    sender.sendSheetEvent({
      type: "dnd:health",
      payload: { characterId: "menu-hero", current: 10, max: 28, temp: 0 },
    })
    sender.sendSheetEvent({
      type: "lss:roll",
      payload: {
        characterId: "menu-hero",
        characterName: "Страж",
        title: "Инициатива",
        formula: "1d20 + 3",
        breakdown: "16 + 3",
        total: "19",
        isCrit: false,
        timestamp: 1_793_779_200_000,
      },
    })
  })
  await expect
    .poll(() => scene.items[0].metadata[PROFILE_KEY])
    .toMatchObject({ hp: 10, maxHp: 28, ac: 14, initiative: 19 })
  expect((await snapshot(page)).combatants).toHaveLength(0)
  await clickMenu(page, MENU.add)
  await expect
    .poll(async () => (await snapshot(page)).combatants[0])
    .toMatchObject({ tokenId: TOKEN_ID, hp: 10, maxHp: 28, initiative: 19 })
  scene.assertAtomicWrites()
  expect(scene.errors).toEqual([])
})

test("LSS menu explains an unbound token and its data tab can bind the exact character", async ({
  context,
}) => {
  const scene = new SharedScene()
  const unbound = structuredClone(token)
  unbound.metadata[PROFILE_KEY] = {
    ...(unbound.metadata[PROFILE_KEY] as Record<string, unknown>),
    lss: null,
  }
  scene.items = [unbound]
  await context.route(`${LSS_ORIGIN}/iframe/characters/**`, route =>
    route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: "<!doctype html><title>LSS account fixture</title><p>Choose a test character</p>",
    }),
  )
  const page = await scene.page(context, "Мастер", "GM", "/background.html")
  await background(scene, page)
  await installModalHost(page)
  await clickMenu(page, MENU.lss)
  let modal = await modalFrame(page, "lss")
  await expect(modal.getByText(/Персонаж LSS пока не привязан к токену/)).toBeVisible()
  await expect(modal.getByTitle("Лист персонажа Long Story Short")).toHaveAttribute(
    "src",
    `${LSS_ORIGIN}/iframe/characters/list/`,
  )
  await expect(
    modal.getByRole("link", { name: "Открыть этого персонажа на LSS ↗", exact: true }),
  ).toHaveCount(0)
  await modal.getByRole("button", { name: "Настроить привязку", exact: true }).click()
  const form = modal.getByRole("form", { name: "Карточка токена Страж", exact: true })
  await form.getByLabel("Персонаж LSS", { exact: true }).fill("menu-hero")
  await form.getByRole("button", { name: "Сохранить карточку", exact: true }).click()
  await expect
    .poll(() => scene.items[0].metadata[PROFILE_KEY])
    .toMatchObject({
      hp: 18,
      initiative: 17,
      lss: { characterId: "menu-hero", url: CHARACTER_URL, sync: true },
    })
  await expect(page.locator("iframe[data-obr-modal]")).toHaveCount(0)
  await clickMenu(page, MENU.lss)
  modal = await modalFrame(page, "lss")
  await expect(modal.getByTitle("Лист персонажа Long Story Short")).toHaveAttribute(
    "src",
    SHEET_URL,
  )
  await expect(
    modal.getByRole("link", { name: "Открыть этого персонажа на LSS ↗", exact: true }),
  ).toHaveAttribute("href", CHARACTER_URL)
  await modal.getByRole("button", { name: "Закрыть окно токена", exact: true }).click()
  await expect(page.locator("iframe[data-obr-modal]")).toHaveCount(0)
  expect((await snapshot(page)).combatants).toHaveLength(0)
  scene.assertAtomicWrites()
  expect(scene.errors).toEqual([])
})

test("token Vortex tab uses the official shared room and accepts room selection only from its GM iframe", async ({
  context,
}) => {
  const origin = "https://vortex.longstoryshort.app"
  const roomKey = "rodeo.lss/vortex-room"
  const initialUrl = `${origin}/room/official-room_17?colorScheme=dark`
  const selectedUrl = `${origin}/room/selected-room_22?colorScheme=dark`
  const scene = new SharedScene()
  scene.items = [structuredClone(token)]
  const room = {
    metadata: { [roomKey]: "official-room_17" } as Metadata,
    writes: [] as Metadata[],
  }
  const fixture = "<!doctype html><title>Official Vortex transport fixture</title><p>Account-free Vortex room</p>"
  await context.route(`${origin}/**`, route =>
    route.fulfill({ contentType: "text/html; charset=utf-8", body: fixture }),
  )
  await context.route("https://untrusted.example/vortex/", route =>
    route.fulfill({ contentType: "text/html; charset=utf-8", body: fixture }),
  )
  const master = await scene.page(context, "Мастер", "GM", "/background.html")
  const player = await scene.page(context, "Игрок", "PLAYER", "/background.html")
  await master.setViewportSize({ width: 400, height: 1050 })
  const clients = [master, player]
  for (const page of clients) {
    await background(scene, page)
    await installModalHost(page)
    await page.exposeFunction("__obrGetRoomMetadata", () => room.metadata)
    await page.exposeFunction("__obrSetRoomMetadata", async (patch: Metadata) => {
      room.writes.push(structuredClone(patch))
      room.metadata = { ...room.metadata, ...patch }
      await Promise.all(
        clients.map(client =>
          client.evaluate(
            metadata => (window as MenuWindow).__obrMock.receiveRoomMetadata(metadata),
            room.metadata,
          ),
        ),
      )
    })
  }

  await clickMenu(master, MENU.data)
  const modal = await modalFrame(master, "data")
  await modal.getByRole("button", { name: "Vortex", exact: true }).click()
  const iframe = modal.getByTitle("Официальная комната Vortex Long Story Short")
  await expect(iframe).toHaveAttribute("src", initialUrl)
  await expect(modal.getByRole("status")).toContainText("общая комната Vortex этого стола.")
  expect(
    await modal.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true)
  await master.screenshot({ path: "test-results-menu/token-vortex-400px.png", fullPage: true })
  expect(room.writes).toEqual([])
  expect(scene.writes).toEqual([])

  // A different frame at the allowed origin must not select a room.
  await modal.evaluate(src => {
    const rogue = document.createElement("iframe")
    rogue.id = "rogue-vortex"
    rogue.src = src
    document.body.append(rogue)
  }, `${origin}/rogue/`)
  await expect.poll(() => master.frame({ url: `${origin}/rogue/` }) !== null).toBe(true)
  await master.frame({ url: `${origin}/rogue/` })!.evaluate(() => {
    parent.postMessage(
      { type: "vortex:roomSelected", roomId: "wrong-source" },
      "http://127.0.0.1:4175",
    )
  })
  await modal.locator("#rogue-vortex").evaluate(element => element.remove())

  // Navigation preserves the legitimate WindowProxy, while the origin changes.
  await iframe.evaluate(element => {
    const frame = element as HTMLIFrameElement
    frame.src = "https://untrusted.example/vortex/"
  })
  await expect
    .poll(() => master.frame({ url: "https://untrusted.example/vortex/" }) !== null)
    .toBe(true)
  await master.frame({ url: "https://untrusted.example/vortex/" })!.evaluate(() => {
    parent.postMessage(
      { type: "vortex:roomSelected", roomId: "wrong-origin" },
      "http://127.0.0.1:4175",
    )
  })
  await iframe.evaluate((element, src) => {
    const frame = element as HTMLIFrameElement
    frame.src = src
  }, initialUrl)
  await expect.poll(() => master.frame({ url: initialUrl }) !== null).toBe(true)
  expect(room.writes).toEqual([])
  await master.frame({ url: initialUrl })!.evaluate(() => {
    parent.postMessage(
      { type: "vortex:roomSelected", roomId: "selected-room_22" },
      "http://127.0.0.1:4175",
    )
  })
  await expect.poll(() => room.writes).toEqual([{ [roomKey]: "selected-room_22" }])
  await expect(iframe).toHaveAttribute("src", selectedUrl)

  await clickMenu(player, MENU.data)
  const playerModal = await modalFrame(player, "data")
  await playerModal.getByRole("button", { name: "Vortex", exact: true }).click()
  const playerIframe = playerModal.getByTitle("Официальная комната Vortex Long Story Short")
  await expect(playerIframe).toHaveAttribute("src", selectedUrl)
  await expect.poll(() => player.frame({ url: selectedUrl }) !== null).toBe(true)
  await player.frame({ url: selectedUrl })!.evaluate(() => {
    parent.postMessage(
      { type: "vortex:roomSelected", roomId: "player-forbidden" },
      "http://127.0.0.1:4175",
    )
  })
  // Wait for the postMessage handler and role lookup to finish, then inspect the
  // independent room relay. No scene journal entry may be written by this UI.
  await playerModal.evaluate(() => new Promise(resolve => setTimeout(resolve, 30)))
  expect(room.writes).toEqual([{ [roomKey]: "selected-room_22" }])
  expect(room.metadata).toEqual({ [roomKey]: "selected-room_22" })
  expect(scene.writes).toEqual([])
  expect(scene.errors).toEqual([])
})
