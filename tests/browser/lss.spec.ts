import { expect, test, type Page } from "@playwright/test"
import type { Image } from "@owlbear-rodeo/sdk"
import { SharedScene, rows, type MockWindow } from "./room"

const characterId = "687540d9b19b77c88dc839a3"
const tokenKey = "com.toaldo27.recombat/token"
const token = (id: string): Image => ({
  id,
  name: "Рыцарь",
  type: "IMAGE",
  layer: "CHARACTER",
  position: { x: 300, y: 300 },
  rotation: 0,
  scale: { x: 1, y: 1 },
  zIndex: 1,
  visible: true,
  locked: false,
  metadata: {},
  createdUserId: "Игрок",
  lastModifiedUserId: "Игрок",
  lastModified: "2026-11-16T00:00:00.000Z",
  image: {
    width: 150,
    height: 150,
    mime: "image/png",
    url: "https://example.test/knight.png",
  },
  grid: { dpi: 150, offset: { x: 0, y: 0 } },
})
const roll = {
  characterId,
  characterName: "Имя в листе",
  title: "Инициатива",
  formula: "(1к20) + 4",
  breakdown: "(15) + 4",
  total: "19",
  isCrit: false,
  timestamp: 1794787200000,
}
async function receive(page: Page, patch: Partial<typeof roll> = {}) {
  await page.evaluate(
    payload => {
      const mock = (window as MockWindow).__obrMock
      mock.receiveBroadcast("rodeo.lss/sheet-events", {
        data: { type: "lss:roll", payload },
        connectionId: "lss-player",
      })
    },
    { ...roll, ...patch },
  )
}
async function background(page: Page) {
  await page.evaluate(async () => {
    const entry = "/src/background.ts"
    await import(entry)
  })
}
async function select(page: Page, ids: string[]) {
  await page.evaluate(ids => {
    const mock = (window as MockWindow).__obrMock
    mock.selection = ids
  }, ids)
}

test("a sheet linked through the token card receives official initiative before combat and syncs two real UIs", async ({
  context,
}) => {
  const scene = new SharedScene()
  scene.items = [token("bound"), token("namesake")]
  const gm = await scene.page(context, "Мастер", "GM")
  const player = await scene.page(context, "Игрок")
  await background(gm)
  await select(gm, ["bound"])
  await gm.getByRole("button", { name: "Данные токена", exact: true }).click()
  const form = gm.getByRole("form", { name: "Карточка токена Рыцарь", exact: true })
  await form
    .getByLabel("Персонаж LSS", { exact: true })
    .fill(`https://longstoryshort.app/characters/digital/${characterId}/`)
  await form.getByLabel("Максимальные ХП", { exact: true }).fill("40")
  await form.getByLabel("Текущие ХП", { exact: true }).fill("32")
  await form.getByLabel("Класс защиты", { exact: true }).fill("18")
  await form.getByRole("button", { name: "Сохранить карточку", exact: true }).click()
  await expect(form).toHaveCount(0)
  await expect(rows(gm)).toHaveCount(0)
  await receive(gm)
  await expect
    .poll(
      () => (scene.items[0].metadata[tokenKey] as { initiative?: number })?.initiative,
    )
    .toBe(19)
  await expect(rows(player)).toHaveCount(0)
  await select(gm, ["bound", "namesake"])
  await gm.getByRole("button", { name: "＋ Выделенные токены", exact: true }).click()
  for (const page of [gm, player]) {
    await expect(rows(page)).toHaveCount(2)
    const bound = page.getByTestId("combatant-token:bound")
    await expect(bound.getByLabel("Инициатива Рыцарь", { exact: true })).toHaveValue("19")
    await expect(bound.getByLabel("ХП Рыцарь", { exact: true })).toHaveValue("32")
    await expect(bound.getByLabel("КЗ Рыцарь", { exact: true })).toHaveValue("18")
    await expect(
      page
        .getByTestId("combatant-token:namesake")
        .getByLabel("Инициатива Рыцарь", { exact: true }),
    ).toHaveValue("")
    await expect(
      bound.getByRole("link", { name: "Лист LSS ↗", exact: true }),
    ).toHaveAttribute(
      "href",
      `https://longstoryshort.app/characters/digital/${characterId}/`,
    )
  }
  const writes = scene.writes.length
  await receive(gm)
  await receive(gm, {
    title: "Атака Длинный меч",
    total: "25",
    timestamp: roll.timestamp + 1,
  })
  await receive(gm, { total: "20 | 7", timestamp: roll.timestamp + 2 })
  await expect(gm.locator(".sync")).toHaveText("● Сохранено")
  expect(scene.writes).toHaveLength(writes)
  const persisted = structuredClone(scene.metadata)
  await Promise.all([gm.reload(), player.reload()])
  for (const page of [gm, player])
    await expect(
      page
        .getByTestId("combatant-token:bound")
        .getByLabel("Инициатива Рыцарь", { exact: true }),
    ).toHaveValue("19")
  expect(scene.metadata).toEqual(persisted)
  expect(scene.errors).toEqual([])
})

test("a GM's official REMOTE roll returns through another player's ALL relay to the single elected writer", async ({
  context,
}) => {
  const scene = new SharedScene()
  const bound = token("bound")
  bound.metadata[tokenKey] = {
    schema: 1,
    name: "Рыцарь",
    hp: 10,
    maxHp: 10,
    ac: 10,
    bonus: 4,
    initiative: null,
    faction: "pc",
    lss: {
      characterId,
      url: `https://longstoryshort.app/characters/digital/${characterId}/`,
      sync: true,
    },
  }
  scene.items = [bound]
  const gm = await scene.page(context, "Мастер", "GM")
  const player = await scene.page(context, "Игрок")
  await Promise.all([background(gm), background(player)])
  await select(gm, ["bound"])
  await gm.getByRole("button", { name: "＋ Выделенные токены", exact: true }).click()
  await expect(rows(player)).toHaveCount(1)
  const writes = scene.writes.length
  // The source GM does not receive the official REMOTE message. Only the other
  // player receives it, then relays ALL; the GM wins the writer election.
  await receive(player)
  for (const page of [gm, player])
    await expect(page.getByLabel("Инициатива Рыцарь", { exact: true })).toHaveValue("19")
  await expect(gm.locator(".sync")).toHaveText("● Сохранено")
  expect(scene.writes).toHaveLength(writes + 1)
  expect(Object.values(scene.writes.at(-1)!)[0]).toMatchObject({
    actorId: "Мастер",
    patch: { initiative: 19 },
  })
  // Additional relays of that fact cannot replace its original journal clock.
  const saved = structuredClone(scene.metadata)
  await receive(gm)
  await receive(player)
  expect(scene.metadata).toEqual(saved)
  expect(scene.writes).toHaveLength(writes + 1)
  expect(scene.errors).toEqual([])
})

test("turning off the token's LSS synchronization leaves a later official roll unapplied", async ({
  context,
}) => {
  const scene = new SharedScene()
  scene.items = [token("bound")]
  const gm = await scene.page(context, "Мастер", "GM")
  await background(gm)
  await select(gm, ["bound"])
  await gm.getByRole("button", { name: "Данные токена", exact: true }).click()
  const form = gm.getByRole("form", { name: "Карточка токена Рыцарь", exact: true })
  await form.getByLabel("Персонаж LSS", { exact: true }).fill(characterId)
  await form.getByLabel("Инициатива", { exact: true }).fill("12")
  await form.getByLabel("Принимать инициативу из LSS", { exact: true }).uncheck()
  await form
    .getByRole("button", { name: "Сохранить и добавить в бой", exact: true })
    .click()
  await expect(form).toHaveCount(0)
  const initiative = gm.getByLabel("Инициатива Рыцарь", { exact: true })
  await expect(initiative).toHaveValue("12")
  const writes = scene.writes.length
  await receive(gm)
  await expect(initiative).toHaveValue("12")
  expect(scene.writes).toHaveLength(writes)
  expect(scene.errors).toEqual([])
})
