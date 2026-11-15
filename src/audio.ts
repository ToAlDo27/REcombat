import OBR from "@owlbear-rodeo/sdk"
import { PREFIX } from "./types"

export const AUDIO_CHANNEL = `${PREFIX}/audio`
export const AUDIO_STATUS = `${PREFIX}/audio-status`
export const AUDIO_KEY = `${PREFIX}/audio-preferences`
export interface AudioPreferences {
  enabled: boolean
  volume: number
}
export function readAudio(): AudioPreferences {
  try {
    const value = JSON.parse(localStorage.getItem(AUDIO_KEY) ?? "{}")
    return {
      enabled: value.enabled === true,
      volume:
        typeof value.volume === "number" ? Math.max(0, Math.min(1, value.volume)) : 0.45,
    }
  } catch {
    return { enabled: false, volume: 0.45 }
  }
}
export async function requestAudio(value: AudioPreferences) {
  localStorage.setItem(AUDIO_KEY, JSON.stringify(value))
  await OBR.broadcast.sendMessage(AUDIO_CHANNEL, value, { destination: "LOCAL" })
}
