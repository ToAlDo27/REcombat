/** Shared with the official LSS Vortex bridge. Only the GM may select a room. */
export const VORTEX_ROOM_METADATA_KEY = "rodeo.lss/vortex-room"
export const VORTEX_ORIGIN = "https://vortex.longstoryshort.app"
export const VORTEX_PICKER_URL = `${VORTEX_ORIGIN}/iframe/?colorScheme=dark`
export const VORTEX_BRIDGE_SOURCE =
  "https://github.com/tldrpg/lss-vtt-sdk/tree/master/bridges/vortex"

/** Build only an official room URL from a bounded, path-safe room identifier. */
export function vortexRoomUrl(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null
  const roomId = (metadata as Record<string, unknown>)[VORTEX_ROOM_METADATA_KEY]
  if (typeof roomId !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(roomId))
    return null
  return `${VORTEX_ORIGIN}/room/${roomId}?colorScheme=dark`
}

export type VortexHostMessage =
  | { type: "vortex:roomSelected"; roomId: string }
  | { type: "vortex:roomNotFound" }
  | { type: "vortex:windowResize"; height: number }

/** Validate payloads in addition to the iframe origin/source checks in the panel. */
export function parseVortexHostMessage(data: unknown): VortexHostMessage | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null
  const message = data as Record<string, unknown>
  if (
    message.type === "vortex:roomSelected" &&
    typeof message.roomId === "string" &&
    vortexRoomUrl({ [VORTEX_ROOM_METADATA_KEY]: message.roomId })
  )
    return { type: message.type, roomId: message.roomId }
  if (message.type === "vortex:roomNotFound") return { type: message.type }
  if (
    message.type === "vortex:windowResize" &&
    typeof message.height === "number" &&
    Number.isFinite(message.height) &&
    message.height > 0 &&
    message.height <= 100_000
  )
    return { type: message.type, height: message.height }
  return null
}
