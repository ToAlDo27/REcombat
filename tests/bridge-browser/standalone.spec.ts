import { test, expect, chromium, type BrowserContext } from "@playwright/test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve, join } from "node:path"
import type { Image, Metadata } from "@owlbear-rodeo/sdk"
import type { MockWindow } from "../browser/room"

const characterId = "6af99ae6b404ec0e45164c77"
const namesakeId = "6af99ae6b404ec0e45164c78"
const site = "https://toaldo27.github.io/REcombat/"
const prefix = "com.toaldo27.recombat/op/"
const profile = (characterId: string, initiative = 14) => ({
  name: "Одинаковое имя",
  hp: 44,
  maxHp: 44,
  ac: 15,
  bonus: 2,
  initiative,
  faction: "npc",
  lss: {
    characterId,
    url: "https://longstoryshort.app/characters/digital/" + characterId + "/",
    sync: true,
  },
})
const item = (id: string, characterId: string): Image => ({
  id,
  type: "IMAGE",
  layer: "CHARACTER",
  name: "Одинаковое имя",
  position: { x: 200, y: 200 },
  rotation: 0,
  scale: { x: 1, y: 1 },
  zIndex: 1,
  visible: true,
  locked: false,
  createdUserId: "Owner",
  lastModifiedUserId: "Owner",
  lastModified: "2026-11-16T00:00:00.000Z",
  image: {
    url: "https://example.test/token.png",
    width: 150,
    height: 150,
    mime: "image/png",
  },
  grid: { dpi: 150, offset: { x: 0, y: 0 } },
  metadata: { "com.toaldo27.recombat/token": { schema: 1, ...profile(characterId) } },
})
const sheet =
  '<!doctype html><html lang="ru"><title>LSS · контрольный лист</title><label>Итог<input id="total" value="19"></label><button id="roll">Бросить инициативу</button><button id="repeat">Повторить событие</button><button id="attack">Атака с названием Инициатива</button><output></output><script>let last;function emit(kind){last={record:{version:1,total:Number(document.querySelector("#total").value),formula:"1d20+2",meta:{kind,statKey:"initiative",title:"Инициатива"},timestamp:Date.now()}};window.dispatchEvent(new CustomEvent("lss:roll",{detail:last}));document.querySelector("output").textContent=String(last.record.total)}document.querySelector("#roll").onclick=()=>emit("initiative");document.querySelector("#attack").onclick=()=>emit("attack");document.querySelector("#repeat").onclick=()=>window.dispatchEvent(new CustomEvent("lss:roll",{detail:last}));</script></html>'

async function launch() {
  const extension = resolve("browser-bridge/build")
  const context = await chromium.launchPersistentContext(
    mkdtempSync(join(tmpdir(), "recombat-bridge-test-")),
    {
      channel: "chromium",
      headless: true,
      viewport: { width: 1100, height: 850 },
      args: ["--disable-extensions-except=" + extension, "--load-extension=" + extension],
    },
  )
  await context.route("https://toaldo27.github.io/**", async route => {
    const url = new URL(route.request().url())
    const path = url.pathname.replace(/^\/REcombat(?=\/)/, "")
    const response = await route.fetch({
      url: "http://127.0.0.1:4176" + path + url.search,
    })
    await route.fulfill({
      response,
      headers: { ...response.headers(), "access-control-allow-origin": "*" },
    })
  })
  await context.route("https://www.owlbear.rodeo/room/**", route =>
    route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: '<!doctype html><html lang="ru"><title>Owlbear · проверка моста</title><h1>Контрольная сцена Owlbear</h1><iframe title="REcombat background" style="display:none"></iframe><div id="panel"></div></html>',
    }),
  )
  await context.route("https://longstoryshort.app/characters/**", route =>
    route.fulfill({ contentType: "text/html; charset=utf-8", body: sheet }),
  )
  const worker =
    context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"))
  const extensionId = new URL(worker.url()).host
  return { context, extensionId }
}

async function room(context: BrowserContext, roomId = "mock-room", role = "GM") {
  const page = await context.newPage()
  let metadata: Metadata = {}
  const items = [item("bound", characterId), item("namesake", namesakeId)]
  const writes: Metadata[] = []
  const errors: string[] = []
  page.on("pageerror", error => errors.push(error.message))
  for (const [index, token] of items.entries()) {
    const id = "seed-" + token.id
    metadata[prefix + id] = {
      schema: 1,
      idempotencyId: id,
      clock: index + 1,
      actorId: "Owner",
      kind: "add",
      combatant: {
        ...profile(index ? namesakeId : characterId, index ? 8 : 14),
        id: "token:" + token.id,
        tokenId: token.id,
        ownerId: "Owner",
      },
    }
  }
  if (role === "PLAYER")
    metadata[prefix + "settings"] = {
      schema: 1,
      idempotencyId: "settings",
      clock: 3,
      actorId: "Owner",
      kind: "settings",
      patch: { playerEdit: "own" },
    }
  const deliver = async (method: "receiveMetadata" | "receiveItems", value: unknown) => {
    await Promise.all(
      page
        .frames()
        .filter(frame => frame.url().startsWith(site))
        .map(frame =>
          frame.evaluate(
            ({ method, value }) => {
              const mock = (window as MockWindow).__obrMock
              if (mock) (mock[method] as (data: unknown) => void)(value)
            },
            { method, value },
          ),
        ),
    )
  }
  await page.exposeFunction("__obrGetMetadata", () => metadata)
  await page.exposeFunction("__obrGetItems", () => items)
  await page.exposeFunction("__obrGetPlayers", () => [])
  await page.exposeFunction("__obrSetMetadata", async (patch: Metadata) => {
    writes.push(structuredClone(patch))
    metadata = { ...metadata, ...patch }
    await deliver("receiveMetadata", metadata)
  })
  await page.exposeFunction("__obrUpdateItems", async (updates: Image[]) => {
    for (const update of updates) {
      const index = items.findIndex(item => item.id === update.id)
      if (index >= 0) items[index] = update
    }
    await deliver("receiveItems", items)
  })
  await page.goto("https://www.owlbear.rodeo/room/" + roomId + "/Bridge-" + roomId)
  const params = "?client=" + role + "&role=" + role + "&room=" + roomId
  const mount = () =>
    page.evaluate(
      ({ site, params }) => {
        document.querySelector<HTMLIFrameElement>(
          'iframe[title="REcombat background"]',
        )!.src = site + "background.html" + params
      },
      { site, params },
    )
  await mount()
  const show = async () => {
    await page.evaluate(
      ({ site, params }) => {
        const frame = document.createElement("iframe")
        frame.title = "REcombat"
        frame.src = site + params
        frame.style.cssText = "width:530px;height:720px;border:0"
        document.querySelector("#panel")!.replaceChildren(frame)
      },
      { site, params },
    )
    return page.frameLocator('iframe[title="REcombat"]')
  }
  return { page, writes, errors, show, mount }
}

async function choose(
  context: BrowserContext,
  extensionId: string,
  label = "Bridge-mock-room",
) {
  const popup = await context.newPage()
  await popup.goto("chrome-extension://" + extensionId + "/popup.html")
  await expect(popup.getByRole("combobox")).toContainText(label)
  await popup.getByRole("combobox").selectOption({ label })
  await popup.getByRole("button", { name: "Подключить", exact: true }).click()
  await expect(popup.getByRole("status")).toContainText("Подключено")
  return popup
}

test("a real MV3 bridge carries ordinary-sheet initiative into one selected room with the action closed", async () => {
  const { context, extensionId } = await launch()
  try {
    const target = await room(context)
    const other = await room(context, "other-room")
    const popup = await choose(context, extensionId)
    const lss = await context.newPage()
    await lss.goto("https://longstoryshort.app/characters/list/")
    // Gatsby changes the character address without creating a new document.
    await lss.evaluate(
      id => history.pushState({}, "", "/characters/digital/" + id + "/"),
      characterId,
    )
    await lss.getByRole("button", { name: "Бросить инициативу", exact: true }).click()
    await expect.poll(() => target.writes.length).toBe(1)
    expect(other.writes).toHaveLength(0)
    const view = await target.show()
    await expect(
      view
        .getByTestId("combatant-token:bound")
        .getByLabel("Инициатива Одинаковое имя", { exact: true }),
    ).toHaveValue("19")
    await expect(
      view
        .getByTestId("combatant-token:namesake")
        .getByLabel("Инициатива Одинаковое имя", { exact: true }),
    ).toHaveValue("8")
    await expect(popup.locator("#last")).toContainText("Инициатива 19 сохранена")
    await target.page.screenshot({ path: "test-results-bridge/initiative-19.png" })
    await lss.getByRole("button", { name: "Повторить событие", exact: true }).click()
    await lss
      .getByRole("button", { name: "Атака с названием Инициатива", exact: true })
      .click()
    await expect(
      view
        .getByTestId("combatant-token:bound")
        .getByLabel("Инициатива Одинаковое имя", { exact: true }),
    ).toHaveValue("19")
    expect(target.writes).toHaveLength(1)
    // A frame reload renews its nonce/documentId, keeping only the explicit room selection.
    const registeredDocument = () =>
      context.serviceWorkers()[0].evaluate(async () => {
        const stored = (await chrome.storage.session.get("bridgeState")).bridgeState as {
          receivers: { roomId: string; documentId: string; ready: boolean }[]
        }
        return stored.receivers.find(
          receiver => receiver.roomId === "mock-room" && receiver.ready,
        )?.documentId
      })
    const previousDocument = await registeredDocument()
    await target.page.reload()
    await target.mount()
    await expect
      .poll(async () => {
        const documentId = await registeredDocument()
        return !!documentId && documentId !== previousDocument
      })
      .toBe(true)
    await expect(popup.getByRole("status")).toContainText("Подключено")
    await lss.getByLabel("Итог").fill("0")
    await lss.getByRole("button", { name: "Бросить инициативу", exact: true }).click()
    await expect.poll(() => target.writes.length).toBe(2)
    const afterReload = await target.show()
    await expect(
      afterReload
        .getByTestId("combatant-token:bound")
        .getByLabel("Инициатива Одинаковое имя", { exact: true }),
    ).toHaveValue("0")
    await lss.evaluate(
      id => history.pushState({}, "", "/characters/digital/" + id + "/"),
      namesakeId,
    )
    await lss.getByLabel("Итог").fill("22")
    await lss.getByRole("button", { name: "Бросить инициативу", exact: true }).click()
    await expect(
      afterReload
        .getByTestId("combatant-token:namesake")
        .getByLabel("Инициатива Одинаковое имя", { exact: true }),
    ).toHaveValue("22")
    await expect(
      afterReload
        .getByTestId("combatant-token:bound")
        .getByLabel("Инициатива Одинаковое имя", { exact: true }),
    ).toHaveValue("0")
    await target.page.screenshot({ path: "test-results-bridge/initiative-zero.png" })
    await popup.screenshot({ path: "test-results-bridge/bridge-confirmation.png" })
    expect(target.errors).toEqual([])
    expect(other.errors).toEqual([])
  } finally {
    await context.unrouteAll({ behavior: "ignoreErrors" })
    await context.close()
  }
})

test("no implicit target, no queue of old rolls, and no bypass of token ownership", async () => {
  const { context, extensionId } = await launch()
  try {
    const target = await room(context, "mock-room", "PLAYER")
    const lss = await context.newPage()
    await lss.goto("https://longstoryshort.app/characters/digital/" + characterId + "/")
    await lss.getByRole("button", { name: "Бросить инициативу", exact: true }).click()
    const popup = await choose(context, extensionId)
    expect(target.writes).toHaveLength(0)
    await lss.getByLabel("Итог").fill("22")
    await lss.getByRole("button", { name: "Бросить инициативу", exact: true }).click()
    await expect(popup.locator("#last")).toContainText("Нет доступного токена")
    expect(target.writes).toHaveLength(0)
    const view = await target.show()
    await expect(
      view
        .getByTestId("combatant-token:bound")
        .getByLabel("Инициатива Одинаковое имя", { exact: true }),
    ).toHaveValue("14")
    expect(target.errors).toEqual([])
  } finally {
    await context.unrouteAll({ behavior: "ignoreErrors" })
    await context.close()
  }
})
