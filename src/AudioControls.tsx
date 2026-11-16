import { useEffect, useState } from "react"
import OBR from "@owlbear-rodeo/sdk"
import {
  AUDIO_STATUS,
  expandAudioPlayer,
  getAudioStatus,
  openAudioPlayer,
  queryAudio,
  readAudio,
  requestAudio,
  type AudioStatus,
} from "./audio"

export function AudioControls() {
  const [preferences, setPreferences] = useState(readAudio)
  const [status, setStatus] = useState<AudioStatus | null>(null)
  const [error, setError] = useState("")
  const [pending, setPending] = useState(false)
  useEffect(() => {
    let alive = true
    let dispose: (() => void) | undefined
    OBR.onReady(() => {
      if (!alive) return
      dispose = OBR.broadcast.onMessage(AUDIO_STATUS, event => {
        const value = event.data as AudioStatus
        if (!value || typeof value.enabled !== "boolean") return
        setStatus(value)
        setPreferences(current => ({ ...current, volume: value.volume }))
      })
      void queryAudio().catch(() => undefined)
    })
    return () => {
      alive = false
      dispose?.()
    }
  }, [])
  const perform = (task: Promise<unknown>) => {
    setError("")
    void task.catch(cause =>
      setError(cause instanceof Error ? cause.message : "Не удалось открыть звук."),
    )
  }
  const toggle = () => {
    setPending(true)
    perform(
      (async () => {
        const current = await getAudioStatus()
        setStatus(current)
        if (current?.player && current.unlocked) {
          const next = { volume: current.volume, enabled: !current.enabled }
          setPreferences(next)
          await requestAudio(next)
        } else if (current?.player) await expandAudioPlayer()
        else await openAudioPlayer()
      })().finally(() => setPending(false)),
    )
  }
  return (
    <>
      <div className="audio-controls">
        <button className="quiet" onClick={toggle} disabled={pending}>
          {status?.enabled ? "♫ Звук включён" : "♪ Включить звук"}
        </button>
        <input
          aria-label="Громкость удара меча"
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={preferences.volume}
          onChange={event => {
            const next = {
              ...preferences,
              enabled: status?.enabled === true,
              volume: Number(event.target.value),
            }
            setPreferences(next)
            perform(requestAudio(next))
          }}
        />
        <small>Только у вас</small>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </>
  )
}
