import OBR from "@owlbear-rodeo/sdk"
import { store } from "./store"
import { createOverlayRenderer } from "./overlays"
import { SwordSound } from "./sword"
import { AUDIO_CHANNEL, AUDIO_STATUS, readAudio } from "./audio"

if (OBR.isAvailable) {
  const overlays = createOverlayRenderer()
  const sound = new SwordSound()
  let enabled = false
  let previousScene = ""
  let previousTurn = ""
  let audioRevision = 0
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
      if (enabled && snapshot.turn.active && snapshot.settings.sound) sound.play()
    }
  }
  const unsubscribe = store.subscribe(update)
  OBR.onReady(() => {
    const apply = async (value: unknown) => {
      if (!value || typeof value !== "object") return
      const revision = ++audioRevision
      const preferences = value as { enabled?: unknown; volume?: unknown }
      if (typeof preferences.volume === "number")
        sound.setVolume(Math.max(0, Math.min(1, preferences.volume)))
      if (preferences.enabled === true) {
        try {
          await sound.enable()
          if (revision !== audioRevision) return
          enabled = true
          sound.mute(false)
        } catch {
          if (revision !== audioRevision) return
          enabled = false
        }
      } else {
        enabled = false
        sound.mute(true)
      }
      await OBR.broadcast
        .sendMessage(AUDIO_STATUS, { enabled }, { destination: "LOCAL" })
        .catch(() => undefined)
    }
    OBR.broadcast.onMessage(AUDIO_CHANNEL, event => {
      void apply(event.data)
    })
    void apply(readAudio())
  })
  window.addEventListener(
    "pagehide",
    () => {
      unsubscribe()
      stop()
      void overlays.destroy()
      sound.destroy()
    },
    { once: true },
  )
}
