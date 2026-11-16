import { readFileSync } from "node:fs"
import { expect, test, type Frame } from "@playwright/test"
import type { Image } from "@owlbear-rodeo/sdk"
import type { SheetEvent } from "@longstoryshort/vtt-sdk"
import { SharedScene, rows, type MockWindow } from "./room"

const LSS_ORIGIN = "https://longstoryshort.app"
const CHARACTER_ID = "sdk-hero"
const SHEET_URL = `${LSS_ORIGIN}/iframe/characters/digital/${CHARACTER_ID}/`
const PROFILE_KEY = "com.toaldo27.recombat/token"
// Run the installed SDK's actual sheet-side transport in the intercepted page.
// Its wrapEnvelope uses { __lssSheetSdk: 2, event }; this keeps the test coupled
// to the public package protocol rather than a hand-written imitation.
const sheetSdk = readFileSync(
  new URL("../../node_modules/@longstoryshort/vtt-sdk/dist/index.js", import.meta.url),
  "utf8",
)
type MockSheetWindow = Window & { sendSheetEvent(event: SheetEvent): void }
const health = (current: number, max = 25, characterId = CHARACTER_ID): SheetEvent => ({
  type: "dnd:health",
  payload: { characterId, current, max, temp: 0 },
})
const initiative = (total: string, timestamp = 1_793_779_200_000): SheetEvent => ({
  type: "lss:roll",
  payload: {
    characterId: CHARACTER_ID,
    characterName: "Рыцарь SDK",
    title: "Инициатива",
    formula: "1d20 + 3",
    breakdown: "16 + 3",
    total,
    isCrit: false,
    timestamp,
  },
})
const send = (frame: Frame, event: SheetEvent) =>
  frame.evaluate(event => {
    const sheet = window as MockSheetWindow
    sheet.sendSheetEvent(event)
  }, event)

const token: Image = {
  id: "sdk-linked-token",
  type: "IMAGE",
  name: "Рыцарь SDK",
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
      name: "Рыцарь SDK",
      hp: 18,
      maxHp: 25,
      ac: 14,
      bonus: 3,
      initiative: 8,
      faction: "pc",
      lss: {
        characterId: CHARACTER_ID,
        url: `${LSS_ORIGIN}/characters/digital/${CHARACTER_ID}/`,
        sync: true,
      },
    },
  },
  createdUserId: "Мастер",
  lastModifiedUserId: "Мастер",
  lastModified: "2026-11-16T00:00:00.000Z",
  image: {
    width: 150,
    height: 150,
    mime: "image/png",
    url: "https://example.test/knight.png",
  },
  grid: { dpi: 150, offset: { x: 0, y: 0 } },
}

test("embedded LSS SDK sheet updates linked HP and initiative and rejects wrong source, origin and protocol", async ({
  context,
}) => {
  const scene = new SharedScene()
  scene.items = [structuredClone(token)]
  const mockSheet = `<!doctype html><html><head><meta charset="UTF-8"></head><body><h1>Public LSS SDK protocol fixture</h1><script type="module">${sheetSdk}
    const client = createSheetClient({ targetOrigin: "http://127.0.0.1:4175" });
    window.sendSheetEvent = (event) => client.send(event);
  </script></body></html>`
  await context.route(`${LSS_ORIGIN}/iframe/characters/digital/**`, route =>
    route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: mockSheet,
    }),
  )
  await context.route("https://untrusted.example/foreign-sheet/", route =>
    route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: mockSheet,
    }),
  )
  const page = await scene.page(context, "Мастер", "GM")
  await page.evaluate(async () => {
    const source = "/src/background.ts"
    await import(source)
  })
  await page.evaluate(() => {
    const mock = (window as MockWindow).__obrMock
    mock.selection = ["sdk-linked-token"]
  })
  await page.getByRole("button", { name: "＋ Выделенные токены", exact: true }).click()
  await expect(rows(page)).toHaveCount(1)
  await page.getByRole("button", { name: "Встроенный лист", exact: true }).click()
  const section = page.getByRole("region", { name: "Лист LSS Рыцарь SDK", exact: true })
  const iframe = section.getByTitle("Лист персонажа Long Story Short")
  await expect(iframe).toHaveAttribute("src", SHEET_URL)
  await expect.poll(() => page.frame({ url: SHEET_URL }) !== null).toBe(true)
  let sheet = page.frame({ url: SHEET_URL })!
  await sheet.waitForFunction(
    () => typeof (window as MockSheetWindow).sendSheetEvent === "function",
  )
  expect(await sheet.evaluate(() => location.origin)).toBe(LSS_ORIGIN)

  // Matching origin/source with an old wire marker must not reach LssPanel.
  const writesBeforeInvalid = scene.writes.length
  await sheet.evaluate(
    event => parent.postMessage({ __lssSheetSdk: 1, event }, "http://127.0.0.1:4175"),
    health(1, 99),
  )
  await sheet.evaluate(() => {
    // The SDK accepts v2 envelopes before validating event schemas. The host
    // must reject malformed output before reading payload.characterId.
    for (const event of [
      { type: "dnd:health" },
      { type: "dnd:health", payload: null },
      { type: "lss:roll" },
      { type: "lss:roll", payload: null },
    ]) {
      parent.postMessage({ __lssSheetSdk: 2, event }, "http://127.0.0.1:4175")
    }
  })
  await page.waitForTimeout(100)
  await expect(section.getByRole("status")).toHaveText("Загружаем лист…")
  expect(scene.writes).toHaveLength(writesBeforeInvalid)

  await send(sheet, health(13, 30))
  await expect(section.getByRole("status")).toContainText("Лист подключён")
  await expect(page.getByLabel("ХП Рыцарь SDK", { exact: true })).toHaveValue("13")
  await expect(page.getByLabel("Максимум ХП Рыцарь SDK", { exact: true })).toHaveValue(
    "30",
  )
  await expect
    .poll(() => scene.items[0].metadata[PROFILE_KEY])
    .toMatchObject({ hp: 13, maxHp: 30, ac: 14 })
  const roll = initiative("19")
  await send(sheet, roll)
  await expect(page.getByLabel("Инициатива Рыцарь SDK", { exact: true })).toHaveValue(
    "19",
  )
  await expect
    .poll(() => scene.items[0].metadata[PROFILE_KEY])
    .toMatchObject({ hp: 13, initiative: 19 })

  // A distinct frame at the allowed LSS origin still has the wrong source.
  await page.evaluate(src => {
    const rogue = document.createElement("iframe")
    rogue.id = "rogue-lss-sheet"
    rogue.src = src
    document.body.append(rogue)
  }, `${LSS_ORIGIN}/iframe/characters/digital/rogue-source/`)
  await expect.poll(() => page.frame({ url: /rogue-source/ }) !== null).toBe(true)
  const rogue = page.frame({ url: /rogue-source/ })!
  await rogue.waitForFunction(
    () => typeof (window as MockSheetWindow).sendSheetEvent === "function",
  )
  const persisted = structuredClone(scene.items[0].metadata)
  const writesAfterValid = scene.writes.length
  await send(rogue, health(1, 99))
  await send(rogue, initiative("99", 1_793_779_200_001))
  await page.waitForTimeout(100)
  expect(scene.items[0].metadata).toEqual(persisted)
  expect(scene.writes).toHaveLength(writesAfterValid)
  await page.locator("#rogue-lss-sheet").evaluate(element => element.remove())

  // Navigation preserves the original iframe WindowProxy (matching source),
  // while changing origin. The SDK must reject that document's valid envelope.
  await iframe.evaluate(element => {
    const sheet = element as HTMLIFrameElement
    sheet.src = "https://untrusted.example/foreign-sheet/"
  })
  await expect
    .poll(() => page.frame({ url: "https://untrusted.example/foreign-sheet/" }) !== null)
    .toBe(true)
  sheet = page.frame({ url: "https://untrusted.example/foreign-sheet/" })!
  await sheet.waitForFunction(
    () => typeof (window as MockSheetWindow).sendSheetEvent === "function",
  )
  await send(sheet, health(2, 99))
  await send(sheet, initiative("98", 1_793_779_200_002))
  await page.waitForTimeout(100)
  expect(scene.items[0].metadata).toEqual(persisted)
  expect(scene.writes).toHaveLength(writesAfterValid)

  // Reopening the legitimate document restores sync. Unrelated characters and
  // repeat delivery of the same roll cannot overwrite or duplicate the journal.
  await iframe.evaluate((element, src) => {
    const sheet = element as HTMLIFrameElement
    sheet.src = src
  }, SHEET_URL)
  await expect.poll(() => page.frame({ url: SHEET_URL }) !== null).toBe(true)
  sheet = page.frame({ url: SHEET_URL })!
  await sheet.waitForFunction(
    () => typeof (window as MockSheetWindow).sendSheetEvent === "function",
  )
  await send(sheet, health(1, 99, "unrelated-character"))
  await send(sheet, roll)
  await page.waitForTimeout(100)
  expect(scene.items[0].metadata).toEqual(persisted)
  expect(scene.writes).toHaveLength(writesAfterValid)
  await send(sheet, health(14, 30))
  await expect(page.getByLabel("ХП Рыцарь SDK", { exact: true })).toHaveValue("14")
  await expect
    .poll(() => scene.items[0].metadata[PROFILE_KEY])
    .toMatchObject({ hp: 14, maxHp: 30, initiative: 19 })
  expect(scene.errors).toEqual([])
  scene.assertAtomicWrites()
})
