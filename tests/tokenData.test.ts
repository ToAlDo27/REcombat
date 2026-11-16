import { describe, expect, it } from "vitest"
import type { Item } from "@owlbear-rodeo/sdk"
import {
  normalizeTokenPatch,
  readTokenProfile,
  TOKEN_DATA_KEY,
  tokenMetadata,
} from "../src/tokenData"

describe("portable token profiles", () => {
  it("reads valid data, clamps HP and defaults invalid metadata safely", () => {
    const item = { name: "Token", metadata: {} } as Item
    const profile = readTokenProfile(item, "pc")
    expect(profile).toMatchObject({ name: "Token", faction: "pc", initiative: null })
    item.metadata[TOKEN_DATA_KEY] = tokenMetadata({ ...profile, hp: 90, maxHp: 30 })
    expect(readTokenProfile(item).hp).toBe(30)
    item.metadata[TOKEN_DATA_KEY] = { schema: 999, name: "Invalid" }
    expect(readTokenProfile(item).name).toBe("Token")
  })

  it("rejects invalid stats and arbitrary LSS URLs, and accepts cleared/inherited values", () => {
    expect(normalizeTokenPatch({ maxHp: 0 })).toBeNull()
    expect(normalizeTokenPatch({ initiative: Infinity })).toBeNull()
    expect(
      normalizeTokenPatch({ lss: { url: "https://example.com/evil", sync: true } }),
    ).toBeNull()
    expect(normalizeTokenPatch({ lss: null, rollMode: null, initiative: null })).toEqual({
      lss: null,
      rollMode: null,
      initiative: null,
    })
  })
})
