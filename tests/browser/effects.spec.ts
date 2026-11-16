import { expect, test, type Page } from "@playwright/test"
import type { Image, Item } from "@owlbear-rodeo/sdk"
import { SharedScene, add, edit, rows, type MockWindow } from "./room"
import { readTokenProfile } from "../../src/tokenData"

const token: Image = {
  id: "wolf-token",
  type: "IMAGE",
  name: "Волк",
  layer: "CHARACTER",
  position: { x: 300, y: 300 },
  rotation: 0,
  scale: { x: 1, y: 1 },
  zIndex: 1,
  visible: true,
  locked: false,
  metadata: {},
  createdUserId: "Мастер",
  lastModifiedUserId: "Мастер",
  lastModified: "2026-11-15T00:00:00.000Z",
  image: {
    width: 150,
    height: 150,
    mime: "image/png",
    url: "https://example.test/wolf.png",
  },
  grid: { dpi: 150, offset: { x: 0, y: 0 } },
}

const localItems = (page: Page) =>
  page.evaluate(() => (window as MockWindow).__obrMock.local)
const rings = async (page: Page) =>
  (await localItems(page)).filter(item => item.type === "PATH")
const labels = async (page: Page) =>
  (await localItems(page)).filter(item => item.type === "LABEL")

async function mountBackground(page: Page) {
  // Exercise the actual overlay lifecycle. Separate audio iframe activation and
  // actual output samples are checked by audio.spec.ts.
  await page.evaluate(async () => {
    const source = "/src/background.ts"
    await import(source)
  })
}

test("token stats and turn halo survive a reload without shared drawings", async ({
  context,
}) => {
  const scene = new SharedScene()
  scene.items = [structuredClone(token)]
  const page = await scene.page(context, "Мастер", "GM")
  await mountBackground(page)
  await page.evaluate(() => {
    const mock = (window as MockWindow).__obrMock
    mock.selection = ["wolf-token"]
  })
  await page.getByRole("button", { name: "＋ Выделенные токены", exact: true }).click()
  await expect(rows(page)).toHaveCount(1)
  await expect.poll(async () => (await labels(page)).length).toBe(1)
  await add(page, "Лучник")
  await edit(page, "Максимум ХП Волк", "30")
  await edit(page, "ХП Волк", "27")
  await edit(page, "КЗ Волк", "15")
  await edit(page, "Инициатива Волк", "20")
  await edit(page, "Инициатива Лучник", "10")
  await expect.poll(async () => JSON.stringify(await labels(page))).toContain("ХП 27/30")
  await expect.poll(async () => JSON.stringify(await labels(page))).toContain("КЗ 15")
  await page.getByRole("button", { name: /^Начать бой/ }).click()
  await expect
    .poll(async () => (await rings(page)).map(item => item.attachedTo))
    .toEqual([token.id])

  await page.getByRole("button", { name: /^Следующий ход/ }).click()
  await expect.poll(async () => (await rings(page)).length).toBe(0)
  await edit(page, "ХП Волк", "26")
  await expect(page.locator(".sync")).toHaveText("● Сохранено")
  await page.getByRole("button", { name: /^Следующий ход/ }).click()
  await expect
    .poll(async () => (await rings(page)).map(item => item.attachedTo))
    .toEqual([token.id])
  await page.evaluate(() => {
    const mock = (window as MockWindow).__obrMock
    mock.receiveMetadata(mock.metadata)
    mock.receiveMetadata(mock.metadata)
  })
  await expect(page.locator(".sync")).toHaveText("● Сохранено")

  const persisted = structuredClone(scene.metadata)
  await page.reload()
  await expect(rows(page)).toHaveCount(2)
  await mountBackground(page)
  // Trigger an unchanged snapshot as a background page would receive on loading.
  await page.evaluate(() => {
    const mock = (window as MockWindow).__obrMock
    mock.receiveMetadata(mock.metadata)
  })
  await expect
    .poll(async () => (await rings(page)).map(item => item.attachedTo))
    .toEqual([token.id])
  await expect.poll(async () => JSON.stringify(await labels(page))).toContain("ХП 26/30")
  expect(scene.metadata).toEqual(persisted)
  expect(scene.items).toHaveLength(1)
  expect(scene.items[0]).toEqual({ ...token, metadata: expect.any(Object) })
  expect(readTokenProfile(scene.items[0])).toMatchObject({
    hp: 26,
    maxHp: 30,
    ac: 15,
    initiative: 20,
  })
  expect(
    (await localItems(page)).every((item: Item) => item.attachedTo === token.id),
  ).toBe(true)
  scene.assertAtomicWrites()
  expect(scene.errors).toEqual([])
})
