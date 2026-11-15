import { expect, type Page, type BrowserContext } from "@playwright/test"
import type { Item, Metadata } from "@owlbear-rodeo/sdk"

export type MockWindow = Window & {
  __obrMock: {
    metadata: Metadata
    writes: Metadata[]
    items: Item[]
    local: Item[]
    selection: string[]
    receiveMetadata(metadata: Metadata): void
    receiveBroadcast(
      channel: string,
      message: { data: unknown; connectionId: string },
    ): void
  }
}

/** Replace Owlbear's scene relay; every page still runs the real React UI/store/reducer. */
export class SharedScene {
  metadata: Metadata = {}
  items: Item[] = []
  writes: Metadata[] = []
  errors: string[] = []
  clients = new Set<Page>()
  clientIds = new Map<Page, string>()

  async page(
    context: BrowserContext,
    client: string,
    role: "GM" | "PLAYER" = "PLAYER",
    path = "/",
  ) {
    const page = await context.newPage()
    this.clientIds.set(page, client)
    page.on("pageerror", error => this.errors.push(error.message))
    await page.exposeFunction("__obrGetMetadata", () => {
      this.clients.add(page)
      return this.metadata
    })
    await page.exposeFunction("__obrGetItems", () => this.items)
    await page.exposeFunction("__obrSetMetadata", async (patch: Metadata) => {
      // Real scene.setMetadata merges top-level keys, so simultaneous distinct
      // journal entries survive. A whole-roster write would lose this test.
      this.writes.push(structuredClone(patch))
      await new Promise(resolve => setTimeout(resolve, 25))
      this.metadata = { ...this.metadata, ...patch }
      const delivered = structuredClone(this.metadata)
      await Promise.all(
        [...this.clients]
          .filter(p => !p.isClosed())
          .map(p =>
            p.evaluate(
              metadata => (window as MockWindow).__obrMock.receiveMetadata(metadata),
              delivered,
            ),
          ),
      )
    })
    await page.exposeFunction(
      "__obrBroadcast",
      async (channel: string, data: unknown) => {
        await Promise.all(
          [...this.clients]
            .filter(p => !p.isClosed() && this.clientIds.get(p) === client)
            .map(p =>
              p.evaluate(
                ({ channel, data, client }) => {
                  (window as MockWindow).__obrMock.receiveBroadcast(channel, {
                    data,
                    connectionId: client,
                  })
                },
                { channel, data, client },
              ),
            ),
        )
      },
    )
    await page.goto(`${path}?client=${client}&role=${role}`)
    if (path === "/")
      await expect(
        page.getByRole("textbox", { name: "Имя участника", exact: true }),
      ).toBeVisible()
    return page
  }

  assertAtomicWrites() {
    for (const patch of this.writes) {
      expect(Object.keys(patch)).toHaveLength(1)
      expect(Object.keys(patch)[0]).toMatch(/^com\.toaldo27\.recombat\/op\//)
    }
    expect(Object.keys(this.metadata)).toHaveLength(this.writes.length)
  }
}

export const rows = (page: Page) => page.getByTestId(/^combatant-/)

export async function add(page: Page, name: string) {
  await page.getByRole("textbox", { name: "Имя участника", exact: true }).fill(name)
  await page.getByRole("button", { name: "Добавить", exact: true }).click()
}

export async function edit(page: Page, label: string, value: string) {
  const input = page.getByLabel(label, { exact: true })
  await input.fill(value)
  await input.press("Enter")
}
