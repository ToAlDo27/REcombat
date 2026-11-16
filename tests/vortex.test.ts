// @vitest-environment jsdom
import { createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { act } from "react-dom/test-utils"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  VORTEX_ROOM_METADATA_KEY,
  parseVortexHostMessage,
  vortexRoomUrl,
} from "../src/vortex"
import { useVortexRoom, type VortexRoomState } from "../src/useVortexRoom"
import { VortexPanel } from "../src/VortexPanel"

const sdk = vi.hoisted(() => ({
  room: undefined as unknown,
  player: undefined as unknown,
}))
vi.mock("@owlbear-rodeo/sdk", () => ({ default: sdk }))

let root: Root | undefined
let container: HTMLDivElement
let current: VortexRoomState

function mount() {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  const Probe = () => {
    current = useVortexRoom()
    return null
  }
  act(() => root!.render(createElement(Probe)))
}

beforeEach(() => {
  sdk.room = undefined
  sdk.player = undefined
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(() => {
  if (root) act(() => root!.unmount())
  root = undefined
  container?.remove()
})

describe("official Vortex room URL", () => {
  it("reads the official room key and retains an official, fixed origin", () => {
    expect(vortexRoomUrl({ [VORTEX_ROOM_METADATA_KEY]: "67cc4d-abc_123" })).toBe(
      "https://vortex.longstoryshort.app/room/67cc4d-abc_123?colorScheme=dark",
    )
    expect(vortexRoomUrl({ [VORTEX_ROOM_METADATA_KEY]: "a".repeat(128) })).not.toBeNull()
  })

  it("rejects missing, malformed, overlong and URL-like identifiers", () => {
    for (const metadata of [null, undefined, [], "room", {}, { unrelated: "abc" }])
      expect(vortexRoomUrl(metadata)).toBeNull()
    for (const id of [
      "",
      " ",
      "abc ",
      "https://evil.example",
      "//evil.example",
      "../settings",
      "abc/other",
      "abc?redirect=https://evil.example",
      "abc#fragment",
      "a%2Fb",
      "a".repeat(129),
      42,
      { id: "abc" },
    ])
      expect(vortexRoomUrl({ [VORTEX_ROOM_METADATA_KEY]: id })).toBeNull()
  })
})

describe("official Vortex messages", () => {
  it("accepts only the supported, validated payloads", () => {
    expect(
      parseVortexHostMessage({ type: "vortex:roomSelected", roomId: "room-123" }),
    ).toEqual({ type: "vortex:roomSelected", roomId: "room-123" })
    expect(parseVortexHostMessage({ type: "vortex:roomNotFound" })).toEqual({
      type: "vortex:roomNotFound",
    })
    expect(parseVortexHostMessage({ type: "vortex:windowResize", height: 550 })).toEqual({
      type: "vortex:windowResize",
      height: 550,
    })
    for (const value of [
      null,
      "vortex:roomNotFound",
      { type: "vortex:newRoll" },
      { type: "vortex:roomSelected", roomId: "https://evil.example" },
      { type: "vortex:windowResize", height: "550" },
      { type: "vortex:windowResize", height: Infinity },
      { type: "vortex:windowResize", height: 0 },
      { type: "vortex:windowResize", height: 100_001 },
    ])
      expect(parseVortexHostMessage(value)).toBeNull()
  })
})

describe("Vortex room subscription", () => {
  it("has a safe empty fallback when the room API is unavailable", () => {
    mount()
    expect(current).toEqual({ url: null, loading: false })
  })

  it("loads the binding, updates on room events and unsubscribes on unmount", async () => {
    let receive: (metadata: unknown) => void = () => {}
    const stop = vi.fn()
    const getMetadata = vi.fn(async () => ({ [VORTEX_ROOM_METADATA_KEY]: "initial" }))
    sdk.room = {
      getMetadata,
      onMetadataChange: (callback: typeof receive) => {
        receive = callback
        return stop
      },
    }
    mount()
    expect(current.loading).toBe(true)
    await act(async () => {})
    expect(current).toEqual({
      url: vortexRoomUrl({ [VORTEX_ROOM_METADATA_KEY]: "initial" }),
      loading: false,
    })
    act(() => receive({ [VORTEX_ROOM_METADATA_KEY]: "updated" }))
    expect(current.url).toContain("/room/updated?")
    act(() => receive({}))
    expect(current).toEqual({ url: null, loading: false })
    act(() => root!.unmount())
    root = undefined
    expect(stop).toHaveBeenCalledOnce()
    expect(getMetadata).toHaveBeenCalledOnce()
  })

  it("does not let an old initial read overwrite a newer room event", async () => {
    let resolve!: (metadata: unknown) => void
    let receive!: (metadata: unknown) => void
    sdk.room = {
      getMetadata: () =>
        new Promise(done => {
          resolve = done
        }),
      onMetadataChange: (callback: typeof receive) => {
        receive = callback
        return () => {}
      },
    }
    mount()
    await act(async () => {})
    act(() => receive({ [VORTEX_ROOM_METADATA_KEY]: "newer" }))
    await act(async () => resolve({ [VORTEX_ROOM_METADATA_KEY]: "stale" }))
    expect(current.url).toContain("/room/newer?")
  })

  it("settles a rejected initial read and supports read-only SDK mocks", async () => {
    sdk.room = {
      getMetadata: vi.fn(async () => {
        throw new Error("Unavailable")
      }),
    }
    mount()
    await act(async () => {})
    expect(current).toEqual({ url: null, loading: false })
  })
})

describe("Vortex panel", () => {
  async function panel(initialRoom?: string) {
    let role = "GM"
    let metadata: Record<string, unknown> = initialRoom
      ? { [VORTEX_ROOM_METADATA_KEY]: initialRoom }
      : {}
    const listeners = new Set<(metadata: unknown) => void>()
    const writes = vi.fn(async (update: Record<string, unknown>) => {
      metadata = { ...metadata, ...update }
      for (const receive of listeners) receive(metadata)
    })
    sdk.room = {
      getMetadata: async () => metadata,
      onMetadataChange: (receive: (metadata: unknown) => void) => {
        listeners.add(receive)
        return () => listeners.delete(receive)
      },
      setMetadata: writes,
    }
    sdk.player = {
      getRole: async () => role,
      onChange: () => () => {},
    }
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => root!.render(createElement(VortexPanel)))
    return {
      writes,
      setRole: (next: string) => {
        role = next
      },
    }
  }

  async function send(
    data: unknown,
    origin = "https://vortex.longstoryshort.app",
    source: Window | null = container.querySelector("iframe")!.contentWindow,
  ) {
    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", { data, origin, source }))
    })
  }

  it("checks iframe source, origin, payload and a fresh GM role before binding a selection", async () => {
    const { writes, setRole } = await panel()
    const selection = { type: "vortex:roomSelected", roomId: "chosen" }
    expect(container.querySelector("iframe")!.src).toBe(
      "https://vortex.longstoryshort.app/iframe/?colorScheme=dark",
    )
    await send(selection, "https://evil.example")
    await send(selection, "https://vortex.longstoryshort.app", window)
    await send({ ...selection, roomId: "https://evil.example" })
    setRole("PLAYER")
    await send(selection)
    expect(writes).not.toHaveBeenCalled()
    setRole("GM")
    await send(selection)
    expect(writes).toHaveBeenCalledOnce()
    expect(writes).toHaveBeenCalledWith({
      [VORTEX_ROOM_METADATA_KEY]: "chosen",
    })
    expect(container.querySelector("iframe")!.src).toBe(
      "https://vortex.longstoryshort.app/room/chosen?colorScheme=dark",
    )
  })

  it("does not write on opening or roomNotFound and clears only on an explicit GM click", async () => {
    const { writes } = await panel("existing")
    expect(writes).not.toHaveBeenCalled()
    await send({ type: "vortex:roomSelected", roomId: "existing" })
    await send({ type: "vortex:roomNotFound" })
    expect(writes).not.toHaveBeenCalled()
    expect(container.textContent).toContain("Комната не найдена")
    const choose = [...container.querySelectorAll("button")].find(
      button => button.textContent?.includes("Выбрать другую"),
    )!
    await act(async () =>
      choose.dispatchEvent(new MouseEvent("click", { bubbles: true })),
    )
    expect(writes).toHaveBeenCalledOnce()
    expect(writes).toHaveBeenCalledWith({
      [VORTEX_ROOM_METADATA_KEY]: undefined,
    })
    expect(container.querySelector("iframe")!.src).toContain("/iframe/?")
  })
})
