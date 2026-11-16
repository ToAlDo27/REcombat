import OBR from "@owlbear-rodeo/sdk"
import { PREFIX } from "./types"

export const AUDIO_CHANNEL = `${PREFIX}/audio`
export const AUDIO_STATUS = `${PREFIX}/audio-status`
export const AUDIO_KEY = `${PREFIX}/audio-preferences`
export const AUDIO_POPOVER = `${PREFIX}/audio-player`
export const AUDIO_TURN = `${PREFIX}/audio-turn`
export interface AudioPreferences {
  enabled: boolean
  volume: number
}
export interface AudioStatus {
  enabled: boolean
  player: boolean
  unlocked: boolean
  volume: number
  requestId?: string
}
export function normalizeAudio(value: Partial<AudioPreferences>): AudioPreferences {
  return {
    enabled: value.enabled === true,
    volume:
      typeof value.volume === "number" && Number.isFinite(value.volume)
        ? Math.max(0, Math.min(1, value.volume))
        : 0.45,
  }
}
export function readAudio(): AudioPreferences {
  try {
    const value = JSON.parse(localStorage.getItem(AUDIO_KEY) ?? "{}")
    return normalizeAudio(value && typeof value === "object" ? value : {})
  } catch {
    return { enabled: false, volume: 0.45 }
  }
}
export function saveAudio(value: AudioPreferences) {
  try {
    localStorage.setItem(AUDIO_KEY, JSON.stringify(normalizeAudio(value)))
  } catch {
    // Playback still works when the browser blocks persistent storage.
  }
}
export async function requestAudio(value: AudioPreferences) {
  const preferences = normalizeAudio(value)
  saveAudio(preferences)
  await OBR.broadcast.sendMessage(AUDIO_CHANNEL, preferences, { destination: "LOCAL" })
}
export async function queryAudio() {
  await OBR.broadcast.sendMessage(
    AUDIO_CHANNEL,
    { command: "status" },
    { destination: "LOCAL" },
  )
}
/** Probe the actual iframe, so Escape/navigation cannot leave a stale UI toggle. */
export function getAudioStatus(): Promise<AudioStatus | null> {
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID()
    const finish = (value: AudioStatus | null) => {
      clearTimeout(timer)
      unsubscribe()
      resolve(value)
    }
    const unsubscribe = OBR.broadcast.onMessage(AUDIO_STATUS, event => {
      const value = event.data as AudioStatus | undefined
      if (value?.requestId === requestId) finish(value)
    })
    const timer = setTimeout(() => finish(null), 600)
    void OBR.broadcast
      .sendMessage(
        AUDIO_CHANNEL,
        { command: "status", requestId },
        { destination: "LOCAL" },
      )
      .catch(cause => {
        clearTimeout(timer)
        unsubscribe()
        reject(cause)
      })
  })
}
export async function expandAudioPlayer() {
  await OBR.broadcast.sendMessage(
    AUDIO_CHANNEL,
    { command: "expand" },
    { destination: "LOCAL" },
  )
}
/** A separate, click-away-resistant iframe owns the unlocked AudioContext. */
export async function openAudioPlayer() {
  await OBR.popover.open({
    id: AUDIO_POPOVER,
    url: new URL("audio.html", document.baseURI).href,
    width: 320,
    height: 240,
    anchorReference: "POSITION",
    anchorPosition: { left: 20, top: 100 },
    anchorOrigin: { horizontal: "LEFT", vertical: "TOP" },
    transformOrigin: { horizontal: "LEFT", vertical: "TOP" },
    disableClickAway: true,
  })
}
