import { describe, expect, it } from "vitest"
import { lssFrameUrl, normalizeLssLink } from "../src/lss"

describe("LSS character links", () => {
  it("accepts official character pages and IDs and canonicalizes the iframe", () => {
    const link = normalizeLssLink(
      "https://longstoryshort.app/iframe/characters/builder/abc-123/?x=1",
    )!
    expect(link.characterId).toBe("abc-123")
    expect(link.url).toBe("https://longstoryshort.app/characters/digital/abc-123/")
    expect(lssFrameUrl(link)).toBe(
      "https://longstoryshort.app/iframe/characters/digital/abc-123/",
    )
    expect(normalizeLssLink({ characterId: "abc-123", sync: false })?.sync).toBe(false)
  })
  it("rejects foreign hosts, invalid IDs and mismatched links", () => {
    for (const value of [
      "javascript:alert(1)",
      "https://longstoryshort.app.evil.org/characters/digital/1/",
      "https://longstoryshort.app/characters/list/",
      "https://longstoryshort.app/characters/digital/%2F/",
      { characterId: "other", url: "https://longstoryshort.app/characters/digital/1/" },
    ])
      expect(normalizeLssLink(value)).toBeNull()
  })
})
