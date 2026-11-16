import type { LssLink } from "./types"

export const LSS_ORIGIN = "https://longstoryshort.app"
export const LSS_DND_MANIFEST = "https://bridge.longstoryshort.app/dnd/obr/manifest.json"
export const LSS_VORTEX_MANIFEST =
  "https://bridge.longstoryshort.app/vortex/obr/manifest.json"

const validId = (id: unknown): id is string =>
  typeof id === "string" && /^[a-zA-Z0-9_-]{1,160}$/.test(id)

/** Accept only actual LSS character pages or a character ID, never arbitrary embeds. */
export function normalizeLssLink(value: unknown): LssLink | null {
  let input: unknown = value
  let sync = true
  let expectedId: unknown
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>
    input = record.url || record.characterId
    expectedId = record.characterId
    sync = record.sync !== false
    if (record.sync !== undefined && typeof record.sync !== "boolean") return null
  }
  if (typeof input !== "string") return null
  input = input.trim()
  let characterId: string
  if (validId(input)) characterId = input
  else {
    try {
      const url = new URL(input as string)
      if (url.origin !== LSS_ORIGIN || url.username || url.password) return null
      const match = url.pathname.match(
        /^\/(?:iframe\/)?characters\/(?:digital|builder)\/([^/]+)\/?$/,
      )
      if (!match) return null
      characterId = decodeURIComponent(match[1])
      if (!validId(characterId)) return null
    } catch {
      return null
    }
  }
  if (expectedId !== undefined && expectedId !== characterId) return null
  return { characterId, url: `${LSS_ORIGIN}/characters/digital/${characterId}/`, sync }
}

export function lssFrameUrl(link: LssLink): string {
  const safe = normalizeLssLink(link)
  return safe
    ? `${LSS_ORIGIN}/iframe/characters/digital/${safe.characterId}/`
    : `${LSS_ORIGIN}/iframe/characters/list/`
}
