import { expect, test } from "@playwright/test"
import { SharedScene, add, edit, rows } from "./room"

test("three players retain simultaneous registrations, additive damage and independent edits after reload", async ({
  context,
}) => {
  const scene = new SharedScene()
  const gm = await scene.page(context, "Мастер", "GM")
  const p1 = await scene.page(context, "Игрок 1")
  const p2 = await scene.page(context, "Игрок 2")
  const clients = [gm, p1, p2]
  expect(scene.writes).toHaveLength(0)

  await Promise.all(clients.map((page, i) => add(page, ["Эльф", "Воин", "Гоблин"][i])))
  for (const page of clients) await expect(rows(page)).toHaveCount(3)
  await edit(gm, "Максимум ХП Воин", "40")
  await edit(gm, "ХП Воин", "40")
  for (const page of clients)
    await expect(page.getByLabel("ХП Воин", { exact: true })).toHaveValue("40")

  await Promise.all(clients.map(page => edit(page, "ХП Воин", "-3")))
  for (const page of clients)
    await expect(page.getByLabel("ХП Воин", { exact: true })).toHaveValue("31")
  await Promise.all([
    edit(gm, "КЗ Воин", "18"),
    edit(p1, "Инициатива Воин", "15"),
    edit(p2, "Максимум ХП Воин", "45"),
  ])
  for (const page of clients) {
    await expect(page.getByLabel("КЗ Воин", { exact: true })).toHaveValue("18")
    await expect(page.getByLabel("Инициатива Воин", { exact: true })).toHaveValue("15")
    await expect(page.getByLabel("Максимум ХП Воин", { exact: true })).toHaveValue("45")
  }

  await gm.getByRole("button", { name: "Бросить инициативу Эльф", exact: true }).click()
  const rolled = Number(
    await gm.getByLabel("Инициатива Эльф", { exact: true }).inputValue(),
  )
  await expect
    .poll(async () =>
      Number(await p1.getByLabel("Инициатива Эльф", { exact: true }).inputValue()),
    )
    .toBeGreaterThanOrEqual(1)
  expect(rolled).toBeGreaterThanOrEqual(1)
  expect(rolled).toBeLessThanOrEqual(20)
  await gm.getByRole("button", { name: /^Начать бой/ }).click()
  await expect(gm.getByRole("button", { name: /^Следующий ход/ })).toBeEnabled()
  await gm.getByRole("button", { name: /^Следующий ход/ }).click()
  await expect(gm.locator(".sync")).toHaveText("● Сохранено")

  const writesBeforeReload = scene.writes.length
  const journalBeforeReload = structuredClone(scene.metadata)
  await Promise.all(clients.map(page => page.reload()))
  for (const page of clients) {
    await expect(rows(page)).toHaveCount(3)
    await expect(page.getByLabel("ХП Воин", { exact: true })).toHaveValue("31")
    await expect(page.getByLabel("КЗ Воин", { exact: true })).toHaveValue("18")
    await expect(page.getByLabel("Максимум ХП Воин", { exact: true })).toHaveValue("45")
  }
  await expect(gm.getByRole("button", { name: /^Следующий ход/ })).toBeEnabled()
  expect(scene.metadata).toEqual(journalBeforeReload)
  expect(scene.writes).toHaveLength(writesBeforeReload)
  scene.assertAtomicWrites()
  expect(scene.errors).toEqual([])
})

test("standalone landing exposes install URL and repository source without an archive link", async ({
  page,
}) => {
  await page.goto("/?embedded=0")
  await expect(page.getByRole("link", { name: /Исходный код/ })).toHaveAttribute(
    "href",
    "https://github.com/ToAlDo27/REcombat",
  )
  await expect(page.locator('a[href$="manifest.json"]')).toHaveCount(1)
  expect(await page.locator('a[href*=".zip"],a[download]').count()).toBe(0)
  await page.screenshot({ path: "test-results/recombat-landing.png", fullPage: true })
})

test("combat register fits a 400px viewport and retains keyboard editing", async ({
  context,
}) => {
  const scene = new SharedScene()
  const page = await scene.page(context, "Мастер", "GM")
  await page.setViewportSize({ width: 400, height: 900 })
  await add(page, "Длинное имя героя из северных земель")
  await expect(rows(page)).toHaveCount(1)
  await edit(page, "КЗ Длинное имя героя из северных земель", "17")
  await expect(
    page.getByLabel("КЗ Длинное имя героя из северных земель", { exact: true }),
  ).toHaveValue("17")
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true)
  await page.screenshot({ path: "test-results/recombat-400px.png", fullPage: true })
  expect(scene.errors).toEqual([])
})
