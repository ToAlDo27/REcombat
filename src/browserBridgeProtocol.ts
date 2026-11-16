/** Wire format shared by REcombat and its optional browser companion. */
export const BROWSER_BRIDGE = "com.toaldo27.recombat/browser-bridge/v1"

export const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value)
export const safeId = (value: unknown): value is string =>
  typeof value === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(value)
export const uuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)

export interface BrowserInitiative {
  eventId: string
  characterId: string
  total: number
  timestamp: number
}

export function parseBrowserInitiative(value: unknown): BrowserInitiative | null {
  if (
    !object(value) ||
    !uuid(value.eventId) ||
    !safeId(value.characterId) ||
    typeof value.total !== "number" ||
    !Number.isSafeInteger(value.total) ||
    Math.abs(value.total) > 1_000_000 ||
    typeof value.timestamp !== "number" ||
    !Number.isSafeInteger(value.timestamp) ||
    value.timestamp < 0
  )
    return null
  return {
    eventId: value.eventId,
    characterId: value.characterId,
    total: value.total,
    timestamp: value.timestamp,
  }
}

export function lssCharacterId(address: string): string | null {
  try {
    const url = new URL(address)
    if (url.origin !== "https://longstoryshort.app") return null
    const match = /^\/characters\/digital\/([a-zA-Z0-9_-]{1,128})\/?$/.exec(url.pathname)
    return match?.[1] ?? null
  } catch {
    return null
  }
}

export interface BridgeContext {
  roomId: string
  sceneKey: string
  nonce: string
  ready: boolean
}
export function parseBridgeContext(value: unknown): BridgeContext | null {
  if (
    !object(value) ||
    !safeId(value.roomId) ||
    !uuid(value.nonce) ||
    typeof value.sceneKey !== "string" ||
    value.sceneKey.length > 400 ||
    typeof value.ready !== "boolean"
  )
    return null
  return {
    roomId: value.roomId,
    sceneKey: value.sceneKey,
    nonce: value.nonce,
    ready: value.ready,
  }
}

export interface BridgeResult {
  ok: boolean
  applied: number
  message: string
}
