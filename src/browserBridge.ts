import OBR from "@owlbear-rodeo/sdk"
import type { CombatStore } from "./store"
import { applyLinkedInitiative } from "./lssIntegration"
import {
  BROWSER_BRIDGE,
  object,
  parseBrowserInitiative,
  uuid,
  type BridgeContext,
  type BridgeResult,
} from "./browserBridgeProtocol"

/** Runs only in background.html; the companion injects into this exact document. */
export function startBrowserBridge(store: CombatStore): () => void {
  const nonce = crypto.randomUUID()
  let stopped = false
  let lastContext = ""
  let queue = Promise.resolve()
  const context = (): BridgeContext => {
    const state = store.getSnapshot()
    return {
      roomId: OBR.room.id,
      sceneKey: state.sceneKey,
      nonce,
      ready: state.ready && !state.loading && !!state.actor,
    }
  }
  const announce = (force = false) => {
    const current = context()
    const key = JSON.stringify(current)
    if (stopped || (!force && key === lastContext)) return
    lastContext = key
    window.postMessage(
      { channel: BROWSER_BRIDGE, from: "recombat", type: "ready", context: current },
      location.origin,
    )
  }
  const receive = (event: MessageEvent<unknown>) => {
    if (
      stopped ||
      event.source !== window ||
      event.origin !== location.origin ||
      !object(event.data) ||
      event.data.channel !== BROWSER_BRIDGE ||
      event.data.from !== "companion"
    )
      return
    const data = event.data
    if (data.type === "probe") {
      announce(true)
      return
    }
    if (data.type !== "initiative" || data.nonce !== nonce || !uuid(data.requestId))
      return
    const roll = parseBrowserInitiative(data.roll)
    if (!roll) return
    const requestId = data.requestId
    // Preserve arrival order even when scene writes take different amounts of time.
    queue = queue.then(async () => {
      if (stopped) return
      let result: BridgeResult
      const current = context()
      if (
        !current.ready ||
        data.roomId !== current.roomId ||
        data.sceneKey !== current.sceneKey ||
        Date.now() - roll.timestamp > 30_000 ||
        roll.timestamp - Date.now() > 5_000
      ) {
        result = {
          ok: false,
          applied: 0,
          message: "Сцена изменилась или бросок устарел. Бросьте инициативу ещё раз.",
        }
      } else {
        try {
          const applied = await applyLinkedInitiative(
            store,
            roll.characterId,
            roll.total,
            "browser-roll:" + roll.eventId,
          )
          result = {
            ok: applied > 0,
            applied,
            message: applied
              ? "Инициатива " + roll.total + " сохранена в REcombat."
              : "Нет доступного токена с этим ID LSS и включённым приёмом инициативы.",
          }
        } catch (error) {
          result = {
            ok: false,
            applied: 0,
            message:
              error instanceof Error ? error.message : "Не удалось сохранить инициативу.",
          }
        }
      }
      if (!stopped)
        window.postMessage(
          {
            channel: BROWSER_BRIDGE,
            from: "recombat",
            type: "result",
            nonce,
            requestId,
            result,
          },
          location.origin,
        )
    })
  }
  window.addEventListener("message", receive)
  const stop = store.subscribe(() => announce())
  announce()
  return () => {
    stopped = true
    stop()
    window.removeEventListener("message", receive)
  }
}
