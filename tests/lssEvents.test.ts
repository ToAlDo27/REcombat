import { describe, expect, it } from "vitest"
import {
  LSS_SHEET_CHANNEL,
  initiativeFromRoll,
  parseLssRoll,
  rollIdentity,
  type DiceRollPayload,
} from "../src/lssEvents"

const roll: DiceRollPayload = {
  characterId: "687540d9b19b77c88dc839a3",
  characterName: "Ардан",
  title: "Инициатива",
  formula: "(1к20) + 3",
  breakdown: "(15) + 3",
  total: "18",
  isCrit: false,
  timestamp: 1794787200000,
}

describe("official LSS sheet event compatibility", () => {
  it("reads a direct OBR SheetEvent and copies only the public roll fields", () => {
    expect(LSS_SHEET_CHANNEL).toBe("rodeo.lss/sheet-events")
    const input = { type: "lss:roll", payload: { ...roll, tokenId: "untrusted" } }
    const parsed = parseLssRoll(input)
    expect(parsed).toEqual(roll)
    expect(parsed).not.toBe(input.payload)
    expect(
      parseLssRoll({ type: "lss:roll", payload: { ...roll, total: "18 | 7" } })?.total,
    ).toBe("18 | 7")
  })

  it("rejects wrong transports, legacy copies, malformed and oversized data", () => {
    for (const value of [
      null,
      [],
      roll,
      { type: "dnd:roll", payload: roll },
      { __lssSheetSdk: 2, event: { type: "lss:roll", payload: roll } },
      {
        type: "dnd:health",
        payload: { characterId: roll.characterId, current: 3, max: 10 },
      },
      ...[
        { characterId: " " },
        { characterId: "id\nnext" },
        { characterName: "" },
        { title: "x".repeat(201) },
        { formula: "x".repeat(2001) },
        { breakdown: "x".repeat(4001) },
        { total: 18 },
        { total: "x".repeat(201) },
        { timestamp: NaN },
        { timestamp: Infinity },
        { timestamp: -1 },
        { timestamp: 1.5 },
        { isCrit: "false" },
        { critKind: "other" },
      ].map(patch => ({ type: "lss:roll", payload: { ...roll, ...patch } })),
    ])
      expect(parseLssRoll(value)).toBeNull()
  })

  it("accepts an explicit initiative label and one exact integer only", () => {
    for (const title of [
      "Инициатива",
      "Проверка инициативы",
      "Инициатива (Ловкость)",
      "Initiative",
      "Initiative Roll",
    ]) {
      expect(initiativeFromRoll({ ...roll, title })).toBe(18)
    }
    expect(initiativeFromRoll({ ...roll, total: " -2 " })).toBe(-2)
    expect(initiativeFromRoll({ ...roll, total: "0" })).toBe(0)
    for (const title of [
      "Меч инициативы",
      "Атака",
      "Initiative attack",
      "Initiative of sword",
    ]) {
      expect(initiativeFromRoll({ ...roll, title })).toBeNull()
    }
    for (const total of [
      "18 | 7",
      "18 / 7",
      "18 (15+3)",
      "1e2",
      "0x10",
      "18.5",
      "Infinity",
      "1000001",
      "",
    ]) {
      expect(initiativeFromRoll({ ...roll, total })).toBeNull()
    }
  })

  it("deduplicates the same roll without merging distinct results or actors", () => {
    const identity = rollIdentity(roll)
    expect(rollIdentity({ ...roll })).toBe(identity)
    expect(identity.length).toBeLessThan(80)
    for (const patch of [
      { characterId: "another" },
      { timestamp: roll.timestamp + 1 },
      { title: "Initiative" },
      { total: "19" },
      { breakdown: "(16) + 3" },
    ])
      expect(rollIdentity({ ...roll, ...patch })).not.toBe(identity)
  })
})
