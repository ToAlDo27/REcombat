import { expect, test } from "@playwright/test"
import type { Image } from "@owlbear-rodeo/sdk"
import { SharedScene, edit, rows, type MockWindow } from "./room"

const PROFILE_KEY = "com.toaldo27.recombat/token"
const token: Image = {
  id: "prepared-wolf",
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
  lastModified: "2026-11-16T00:00:00.000Z",
  image: {
    width: 150,
    height: 150,
    mime: "image/png",
    url: "https://example.test/wolf.png",
  },
  grid: { dpi: 150, offset: { x: 0, y: 0 } },
}

test("a prepared token retains its LSS link, stats and initiative through adding, editing, removing and reload", async ({
  context,
}) => {
  await context.addInitScript(() => {
    // Verify that the token's advantage takes two dice even while the room uses normal.
    const values = [2, 15, 0, 18]
    const original = crypto.getRandomValues.bind(crypto)
    crypto.getRandomValues = <T extends ArrayBufferView | null>(array: T): T => {
      if (array instanceof Uint32Array && array.length === 1 && values.length) {
        array[0] = values.shift()!
        return array
      }
      return original(array)
    }
  })
  const scene = new SharedScene()
  scene.items = [structuredClone(token)]
  const page = await scene.page(context, "Мастер", "GM")
  await page.setViewportSize({ width: 400, height: 1100 })
  await page.evaluate(async () => {
    await import("/src/background.ts")
  })
  await page.getByRole("button", { name: /Выбрать из сцены/ }).click()
  await page.getByRole("button", { name: "Настроить токен Волк", exact: true }).click()
  let form = page.getByRole("form", { name: "Карточка токена Волк", exact: true })
  await form.getByLabel("Имя токена", { exact: true }).fill("Северный волк")
  await form.getByLabel("Максимальные ХП", { exact: true }).fill("30")
  await form.getByLabel("Текущие ХП", { exact: true }).fill("23")
  await form.getByLabel("Класс защиты", { exact: true }).fill("15")
  await form.getByLabel("Бонус инициативы", { exact: true }).fill("4")
  await form.getByLabel("Инициатива", { exact: true }).fill("17")
  await form.getByLabel("Бросок этого токена", { exact: true }).selectOption("advantage")
  await form
    .getByLabel("Персонаж LSS", { exact: true })
    .fill("https://longstoryshort.app/characters/digital/wolf-lss/")
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true)
  await page.screenshot({
    path: "test-results-token/token-card-400px.png",
    fullPage: true,
  })
  await form.getByRole("button", { name: "Сохранить карточку", exact: true }).click()
  await expect(form).toHaveCount(0)
  await expect(rows(page)).toHaveCount(0)
  await expect
    .poll(() => scene.items[0].metadata[PROFILE_KEY])
    .toMatchObject({
      schema: 1,
      name: "Северный волк",
      hp: 23,
      maxHp: 30,
      ac: 15,
      bonus: 4,
      initiative: 17,
      rollMode: "advantage",
      lss: { characterId: "wolf-lss", sync: true },
    })
  await expect
    .poll(() =>
      page.evaluate(() => JSON.stringify((window as MockWindow).__obrMock.local)),
    )
    .toContain("ХП 23/30")

  await page.reload()
  await expect(rows(page)).toHaveCount(0)
  await page.evaluate(async () => {
    await import("/src/background.ts")
  })
  await page.getByRole("button", { name: /Выбрать из сцены/ }).click()
  await page.getByRole("button", { name: "Настроить токен Волк", exact: true }).click()
  form = page.getByRole("form", { name: "Карточка токена Волк", exact: true })
  await expect(form.getByLabel("Имя токена", { exact: true })).toHaveValue(
    "Северный волк",
  )
  await expect(form.getByLabel("Текущие ХП", { exact: true })).toHaveValue("23")
  await expect(form.getByLabel("Персонаж LSS", { exact: true })).toHaveValue(
    "https://longstoryshort.app/characters/digital/wolf-lss/",
  )
  await form
    .getByRole("button", { name: "Сохранить и добавить в бой", exact: true })
    .click()
  await expect(rows(page)).toHaveCount(1)
  await expect(page.getByLabel("Инициатива Северный волк", { exact: true })).toHaveValue(
    "17",
  )
  await expect(
    rows(page).getByRole("link", { name: "Лист LSS ↗", exact: true }),
  ).toHaveAttribute("href", "https://longstoryshort.app/characters/digital/wolf-lss/")

  await rows(page).getByRole("button", { name: "Данные токена", exact: true }).click()
  await form.getByLabel("Бонус инициативы", { exact: true }).fill("5")
  await form.getByRole("button", { name: "Сохранить карточку", exact: true }).click()
  await page
    .getByRole("button", { name: "Бросить инициативу Северный волк", exact: true })
    .click()
  await expect(page.getByLabel("Инициатива Северный волк", { exact: true })).toHaveValue(
    "21",
  )
  await edit(page, "ХП Северный волк", "-3")
  await expect(page.getByLabel("ХП Северный волк", { exact: true })).toHaveValue("20")
  await rows(page)
    .getByRole("button", { name: "Удалить Северный волк", exact: true })
    .click()
  await rows(page).getByRole("button", { name: "Убрать", exact: true }).click()
  await expect(rows(page)).toHaveCount(0)
  await expect
    .poll(() => scene.items[0].metadata[PROFILE_KEY])
    .toMatchObject({ hp: 20, initiative: 21, bonus: 5 })
  await expect
    .poll(() =>
      page.evaluate(() => JSON.stringify((window as MockWindow).__obrMock.local)),
    )
    .toContain("ХП 20/30")
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as MockWindow).__obrMock.local.filter(item => item.type === "LABEL")
            .length,
      ),
    )
    .toBe(1)

  await page.getByRole("button", { name: "Настроить токен Волк", exact: true }).click()
  await expect(form.getByLabel("Текущие ХП", { exact: true })).toHaveValue("20")
  await form.getByLabel("При добавлении в бой", { exact: true }).selectOption("roll")
  await form
    .getByRole("button", { name: "Сохранить и добавить в бой", exact: true })
    .click()
  await expect(rows(page)).toHaveCount(1)
  await expect(page.getByLabel("Инициатива Северный волк", { exact: true })).toHaveValue(
    "24",
  )
  await expect(page.getByLabel("ХП Северный волк", { exact: true })).toHaveValue("20")
  await expect(page.locator(".sync")).toHaveText("● Сохранено")
  await expect
    .poll(() => scene.items[0].metadata[PROFILE_KEY])
    .toMatchObject({ hp: 20, initiative: 24 })
  scene.assertAtomicWrites()
  expect(scene.errors).toEqual([])
})
