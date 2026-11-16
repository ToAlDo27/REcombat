import OBR from "@owlbear-rodeo/sdk"
import { store } from "./store"
import { createOverlayRenderer } from "./overlays"
import { startLssIntegration } from "./lssIntegration"
import { AUDIO_TURN } from "./audio"
import { startTokenContextMenus } from "./contextMenu"
import { startBrowserBridge } from "./browserBridge"

if (OBR.isAvailable) {
  let stopLss: (() => void) | undefined
  let stopMenus: (() => void) | undefined
  let stopBrowserBridge: (() => void) | undefined
  let stopped = false
  OBR.onReady(() => {
    if (stopped) return
    stopLss = startLssIntegration(store)
    stopBrowserBridge = startBrowserBridge(store)
    stopMenus = startTokenContextMenus(store)
  })
  const overlays = createOverlayRenderer()
  let previousScene = ""
  let previousTurn = ""
  let initialized = false
  const stop = store.start()
  const update = () => {
    const snapshot = store.getSnapshot()
    overlays.render(snapshot)
    if (!snapshot.ready) {
      initialized = false
      return
    }
    const turn = JSON.stringify([
      snapshot.turn.active,
      snapshot.turn.combatantId,
      snapshot.turn.round,
    ])
    if (!initialized || previousScene !== snapshot.sceneKey) {
      previousScene = snapshot.sceneKey
      previousTurn = turn
      initialized = true
      return
    }
    if (previousTurn !== turn) {
      previousTurn = turn
      // User activation belongs to the visible audio iframe. This background
      // only relays turn changes, so opening the action cannot double playback.
      if (snapshot.turn.active && snapshot.settings.sound)
        void OBR.broadcast
          .sendMessage(
            AUDIO_TURN,
            { scene: snapshot.sceneKey, turn },
            { destination: "LOCAL" },
          )
          .catch(() => undefined)
    }
  }
  const unsubscribe = store.subscribe(update)
  window.addEventListener(
    "pagehide",
    () => {
      stopped = true
      stopMenus?.()
      stopLss?.()
      stopBrowserBridge?.()
      unsubscribe()
      stop()
      void overlays.destroy()
    },
    { once: true },
  )
}
