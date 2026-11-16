// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { startBrowserBridge } from "../src/browserBridge"
import { BROWSER_BRIDGE } from "../src/browserBridgeProtocol"
import { emptyState } from "../src/model"
import type { CombatStore } from "../src/store"
import type { Snapshot } from "../src/types"

vi.mock("@owlbear-rodeo/sdk", () => ({ default: { room: { id: "room" } } }))
const dispose: (() => void)[] = []
afterEach(() => {
  dispose.splice(0).forEach(stop => stop())
  vi.restoreAllMocks()
})
function receiver() {
  const state: Snapshot = {
    ...emptyState(),
    ready: true,
    loading: false,
    pending: 0,
    sceneKey: "scene-one",
    actor: { id: "gm", connectionId: "gm", role: "GM", name: "GM", color: "#fff" },
    // A connected client without this companion must not block the local writer.
    party: [
      { id: "absent", connectionId: "a", role: "GM", name: "Other", color: "#fff" },
    ],
    items: [],
    combatants: [
      {
        id: "character",
        ownerId: "gm",
        name: "Same name",
        initiative: 14,
        hp: 15,
        maxHp: 15,
        ac: 18,
        bonus: 0,
        faction: "npc",
        lss: {
          characterId: "actual-id",
          url: "https://longstoryshort.app/characters/digital/actual-id/",
          sync: true,
        },
      },
    ],
  }
  const dispatch = vi.fn(async () => {})
  const store = {
    getSnapshot: () => state,
    subscribe: () => () => {},
    dispatch,
  } as unknown as CombatStore
  const post = vi.spyOn(window, "postMessage").mockImplementation(() => {})
  dispose.push(startBrowserBridge(store))
  const ready = post.mock.calls[0][0] as { context: { nonce: string } }
  const message = {
    channel: BROWSER_BRIDGE,
    from: "companion",
    type: "initiative",
    nonce: ready.context.nonce,
    roomId: "room",
    sceneKey: "scene-one",
    requestId: "52f00a0a-8660-4718-9cd8-734b07c05adb",
    roll: {
      eventId: "b39760b6-8d8e-44f3-9670-33f0581307ea",
      characterId: "actual-id",
      total: 19,
      timestamp: Date.now(),
    },
  }
  const send = (
    data: unknown,
    origin = location.origin,
    source: MessageEventSource = window,
  ) => window.dispatchEvent(new MessageEvent("message", { data, origin, source }))
  return { state, dispatch, post, message, send }
}
describe("local browser bridge receiver", () => {
  it("confirms a direct ID-bound write without another eligible writer", async () => {
    const { send, message, dispatch, post } = receiver()
    send(message)
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledOnce())
    expect(dispatch).toHaveBeenCalledWith(
      { kind: "patch", id: "character", patch: { initiative: 19 } },
      "browser-roll:" + message.roll.eventId + ":character",
    )
    await vi.waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "result",
          result: expect.objectContaining({ ok: true, applied: 1 }),
        }),
        location.origin,
      ),
    )
  })
  it("rejects another window/origin, forged nonce and invalid payload", async () => {
    const { send, message, dispatch } = receiver()
    const iframe = document.createElement("iframe")
    document.body.append(iframe)
    send(message, "https://attacker.test")
    send(message, location.origin, iframe.contentWindow!)
    send({ ...message, nonce: crypto.randomUUID() })
    send({ ...message, roll: { ...message.roll, total: "19 | 7" } })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(dispatch).not.toHaveBeenCalled()
    iframe.remove()
  })
  it("does not apply a valid old-scene delivery or expired result", async () => {
    const { send, message, dispatch, post, state } = receiver()
    state.sceneKey = "scene-two"
    send(message)
    send({
      ...message,
      sceneKey: "scene-two",
      roll: { ...message.roll, timestamp: Date.now() - 31_000 },
    })
    await vi.waitFor(() =>
      expect(
        post.mock.calls.filter(
          ([value]) => (value as { type?: string }).type === "result",
        ),
      ).toHaveLength(2),
    )
    expect(dispatch).not.toHaveBeenCalled()
  })
})
