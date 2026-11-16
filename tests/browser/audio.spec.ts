import { expect, test, type Frame, type Page } from "@playwright/test"
import type { Metadata, Popover } from "@owlbear-rodeo/sdk"

type AudioProbe = Window & {
  __audioProbe: {
    contexts: number
    strikes: number
    peak: number
    reset(): void
  }
  __obrMock?: {
    receiveMetadata(metadata: Metadata): void
    receiveBroadcast(
      channel: string,
      message: { data: unknown; connectionId: string },
    ): void
  }
}

const probe = (frame: Frame) =>
  frame.evaluate(() => {
    const { contexts, strikes, peak } = (window as AudioProbe).__audioProbe
    return { contexts, strikes, peak }
  })

async function audioRoom(page: Page) {
  let metadata: Metadata = {}
  const popovers: Popover[] = []
  const errors: string[] = []
  page.on("pageerror", cause => errors.push(cause.message))
  await page.context().addInitScript(() => {
    const state = {
      contexts: 0,
      strikes: 0,
      peak: 0,
      reset() {
        state.peak = 0
      },
    }
    const target = window as AudioProbe
    target.__audioProbe = state
    const Original = window.AudioContext
    window.AudioContext = class extends Original {
      constructor(options?: AudioContextOptions) {
        super(options)
        state.contexts++
      }
    }
    const start = AudioBufferSourceNode.prototype.start
    AudioBufferSourceNode.prototype.start = function (...args: Parameters<typeof start>) {
      state.strikes++
      return start.apply(this, args)
    }
    // Observe actual samples after the gain/mute stage, adjacent to the browser
    // output. No fake AudioContext or start-count-only assertion can pass this.
    const connect = AudioNode.prototype.connect
    AudioNode.prototype.connect = function (
      destination: AudioNode | AudioParam,
      output?: number,
      input?: number,
    ) {
      if (destination instanceof AudioDestinationNode) {
        const analyser = this.context.createAnalyser()
        analyser.fftSize = 256
        connect.call(this, analyser)
        const samples = new Float32Array(analyser.fftSize)
        setInterval(() => {
          analyser.getFloatTimeDomainData(samples)
          for (const sample of samples)
            state.peak = Math.max(state.peak, Math.abs(sample))
        }, 5)
      }
      return (
        connect as (
          this: AudioNode,
          destination: AudioNode | AudioParam,
          output?: number,
          input?: number,
        ) => AudioNode
      ).call(this, destination, output, input)
    } as typeof AudioNode.prototype.connect
  })
  const frames = () => page.frames().filter(frame => frame.parentFrame())
  const notifyMetadata = async () => {
    await Promise.all(
      frames().map(frame =>
        frame.evaluate(value => {
          const target = window as AudioProbe
          target.__obrMock?.receiveMetadata(value)
        }, metadata),
      ),
    )
  }
  await page.exposeBinding("__obrGetMetadata", () => metadata)
  await page.exposeBinding("__obrGetItems", () => [])
  await page.exposeBinding("__obrSetMetadata", async (_, patch: Metadata) => {
    metadata = { ...metadata, ...patch }
    await notifyMetadata()
  })
  await page.exposeBinding(
    "__obrBroadcast",
    async (_, channel: string, data: unknown) => {
      await Promise.all(
        frames().map(frame =>
          frame.evaluate(
            ({ channel, data }) => {
              const target = window as AudioProbe
              target.__obrMock?.receiveBroadcast(channel, {
                data,
                connectionId: "host",
              })
            },
            { channel, data },
          ),
        ),
      )
    },
  )
  await page.exposeBinding("__obrOpenPopover", async (_, popover: Popover) => {
    popovers.push(popover)
    await page.evaluate(value => {
      if (document.getElementById(value.id)) return
      const iframe = document.createElement("iframe")
      iframe.id = value.id
      iframe.name = "audio"
      iframe.title = "Sword audio player"
      iframe.src = value.url
      iframe.allow = "autoplay"
      iframe.style.cssText = `position:fixed;right:12px;top:100px;border:0;width:${value.width}px;height:${value.height}px;z-index:10`
      document.body.append(iframe)
    }, popover)
  })
  await page.exposeBinding("__obrClosePopover", async (_, id: string) => {
    await page.evaluate(id => document.getElementById(id)?.remove(), id)
  })
  await page.exposeBinding(
    "__obrResizePopover",
    async (_, id: string, dimension: "width" | "height", value: number) => {
      await page.evaluate(
        ({ id, dimension, value }) => {
          const iframe = document.getElementById(id)
          if (iframe) iframe.style[dimension] = `${value}px`
        },
        { id, dimension, value },
      )
    },
  )
  await page.goto("/tests/browser/audio-host.html")
  return { popovers, errors }
}

test("direct audio iframe activation emits real samples and survives closing the combat panel", async ({
  page,
}) => {
  await page.setViewportSize({ width: 950, height: 950 })
  const room = await audioRoom(page)
  const action = page.frame({ name: "action" })!
  const background = page.frame({ name: "background" })!
  await action.getByRole("textbox", { name: "Имя участника", exact: true }).fill("Воин")
  await action.getByRole("button", { name: "Добавить", exact: true }).click()
  await expect(action.getByTestId(/^combatant-/)).toHaveCount(1)
  await action.getByRole("button", { name: /Включить звук/ }).click()
  await expect.poll(() => page.frame({ name: "audio" }) !== null).toBe(true)
  const audio = page.frame({ name: "audio" })!
  await expect(
    audio.getByRole("button", { name: "Разрешить и проверить звук" }),
  ).toBeVisible()
  expect(room.popovers[0].disableClickAway).toBe(true)
  expect(await probe(audio)).toEqual({ contexts: 0, strikes: 0, peak: 0 })
  await audio.getByRole("button", { name: "Разрешить и проверить звук" }).click()
  await expect.poll(async () => (await probe(audio)).peak).toBeGreaterThan(0.005)
  await expect(action.getByRole("button", { name: /Звук включён/ })).toBeVisible()
  expect((await probe(audio)).strikes).toBe(1)
  expect((await probe(action)).contexts).toBe(0)
  expect((await probe(background)).contexts).toBe(0)

  await action.getByRole("button", { name: /^Начать бой/ }).click()
  await expect.poll(async () => (await probe(audio)).strikes).toBe(2)
  // Close the action iframe exactly as Owlbear does. Only the background and
  // audio popover remain; the next turn arrives without any visible panel.
  await page.locator('iframe[name="action"]').evaluate(element => element.remove())
  expect(action.isDetached()).toBe(true)
  await page.waitForTimeout(550)
  await audio.evaluate(() => (window as AudioProbe).__audioProbe.reset())
  await background.evaluate(async () => {
    const source = "/src/store.ts"
    const { store } = await import(source)
    await store.advance(1)
  })
  await expect.poll(async () => (await probe(audio)).strikes).toBe(3)
  await expect.poll(async () => (await probe(audio)).peak).toBeGreaterThan(0.005)
  expect((await probe(audio)).contexts).toBe(1)
  expect((await probe(background)).contexts).toBe(0)

  // Reopening the panel queries the existing player instead of recreating it.
  await page.evaluate(() => {
    const iframe = document.createElement("iframe")
    iframe.name = "controller"
    iframe.src = "/?client=host&role=GM"
    iframe.style.cssText = "width:520px;height:940px;border:0"
    document.body.prepend(iframe)
  })
  await expect.poll(() => page.frame({ name: "controller" }) !== null).toBe(true)
  const controller = page.frame({ name: "controller" })!
  await expect(controller.getByRole("button", { name: /^Следующий ход/ })).toBeVisible()
  expect((await probe(audio)).contexts).toBe(1)
  expect((await probe(controller)).contexts).toBe(0)
  expect((await probe(background)).contexts).toBe(0)

  await controller.getByRole("button", { name: /Звук включён/ }).click()
  await page.waitForTimeout(550)
  await audio.evaluate(() => (window as AudioProbe).__audioProbe.reset())
  await controller.getByRole("button", { name: /^Следующий ход/ }).click()
  await page.waitForTimeout(250)
  expect((await probe(audio)).strikes).toBe(3)
  expect((await probe(audio)).peak).toBe(0)
  expect(room.errors).toEqual([])
})
