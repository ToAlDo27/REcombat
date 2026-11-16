import { useEffect, useState } from "react"
import { createRoot } from "react-dom/client"
import OBR from "@owlbear-rodeo/sdk"
import { SwordSound } from "./sword"
import {
  AUDIO_CHANNEL,
  AUDIO_POPOVER,
  AUDIO_STATUS,
  AUDIO_TURN,
  normalizeAudio,
  readAudio,
  saveAudio,
  type AudioPreferences,
  type AudioStatus,
} from "./audio"
import "./audio-player.css"

// This is the only AudioContext owner. Keep this iframe mounted while listening;
// the action and background never attempt to unlock or synthesize audio.
const sound = new SwordSound()
let preferences = readAudio()
let publishView: (() => void) | undefined
let compact = false
let lastTurn = ""
const status = (): AudioStatus => ({
  enabled: preferences.enabled && sound.isRunning,
  player: true,
  unlocked: sound.isRunning,
  volume: preferences.volume,
})
const publish = (requestId?: string) => {
  publishView?.()
  void OBR.broadcast
    .sendMessage(AUDIO_STATUS, { ...status(), requestId }, { destination: "LOCAL" })
    .catch(() => undefined)
}
const setPreferences = (next: AudioPreferences) => {
  preferences = normalizeAudio(next)
  saveAudio(preferences)
  sound.setVolume(preferences.volume)
  sound.mute(!preferences.enabled)
  publish()
}
const resize = (small: boolean) => {
  compact = small
  publishView?.()
  void Promise.all([
    OBR.popover.setWidth(AUDIO_POPOVER, small ? 220 : 320),
    OBR.popover.setHeight(AUDIO_POPOVER, small ? 56 : 240),
  ]).catch(() => undefined)
}
sound.setVolume(preferences.volume)
sound.mute(!preferences.enabled)
sound.onStateChange = publish

OBR.onReady(() => {
  const unlistenControls = OBR.broadcast.onMessage(AUDIO_CHANNEL, event => {
    if (!event.data || typeof event.data !== "object") return
    const message = event.data as Partial<AudioPreferences> & {
      command?: string
      requestId?: string
    }
    if (message.command === "status") publish(message.requestId)
    else if (message.command === "expand") resize(false)
    else if (typeof message.enabled === "boolean") {
      // A relay message has no user activation. It may adjust an already
      // unlocked context, but only the direct button below calls enable().
      setPreferences(normalizeAudio(message))
    }
  })
  const unlistenTurns = OBR.broadcast.onMessage(AUDIO_TURN, event => {
    const data = event.data as { scene?: unknown; turn?: unknown } | undefined
    if (!data || typeof data.scene !== "string" || typeof data.turn !== "string") return
    const key = JSON.stringify([data.scene, data.turn])
    if (key === lastTurn) return
    lastTurn = key
    if (preferences.enabled) sound.play()
  })
  publish()
  window.addEventListener(
    "pagehide",
    () => {
      unlistenControls()
      unlistenTurns()
      sound.onStateChange = undefined
      void sound.destroy()
    },
    { once: true },
  )
})

function AudioPlayer() {
  const [, redraw] = useState(0)
  const [error, setError] = useState("")
  const [pending, setPending] = useState(false)
  useEffect(() => {
    publishView = () => redraw(value => value + 1)
    return () => {
      publishView = undefined
    }
  }, [])
  const enable = () => {
    setError("")
    setPending(true)
    // Invocation happens synchronously inside this iframe's real click handler.
    void sound
      .enable()
      .then(() => {
        setPreferences({ ...preferences, enabled: true })
        sound.play()
        resize(true)
      })
      .catch(cause => {
        setError(cause instanceof Error ? cause.message : "Браузер не разрешил звук.")
      })
      .finally(() => setPending(false))
  }
  const close = () => {
    setPreferences({ ...preferences, enabled: false })
    void OBR.broadcast
      .sendMessage(AUDIO_STATUS, { ...status(), player: false }, { destination: "LOCAL" })
      .catch(() => undefined)
      .finally(() => {
        void OBR.popover.close(AUDIO_POPOVER)
      })
  }
  return (
    <main className={compact ? "audio-player compact" : "audio-player"}>
      <header>
        <strong>{status().enabled ? "♫ Меч включён" : "♪ Звук меча"}</strong>
        <div>
          {compact && (
            <button aria-label="Настроить звук" onClick={() => resize(false)}>
              ⚙
            </button>
          )}
          <button aria-label="Выключить и закрыть звук" onClick={close}>
            ×
          </button>
        </div>
      </header>
      {!compact && (
        <>
          <p>
            Разрешите звук здесь. Маленький виджет останется на карте и озвучит ходы, даже
            когда панель боя закрыта.
          </p>
          <button className="enable" disabled={pending} onClick={enable}>
            {pending ? "Разрешаем…" : "Разрешить и проверить звук"}
          </button>
          <label>
            Громкость
            <input
              aria-label="Громкость звукового виджета"
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={preferences.volume}
              onChange={event =>
                setPreferences({ ...preferences, volume: Number(event.target.value) })
              }
            />
          </label>
          {error && <p role="alert">{error}</p>}
        </>
      )}
    </main>
  )
}
createRoot(document.getElementById("root")!).render(<AudioPlayer />)
