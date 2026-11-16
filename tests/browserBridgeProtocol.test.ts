import { describe, expect, it } from "vitest"
import { initiativeFromPageRecord } from "../browser-bridge/src/lssRecord"
import { lssCharacterId, parseBrowserInitiative } from "../src/browserBridgeProtocol"

const id = "6af99ae6b404ec0e45164c77"
const address = "https://longstoryshort.app/characters/digital/" + id + "/"
const eventId = "a99e4144-5cf5-4be7-a134-3f450655279f"
const detail = {
  record: {
    version: 1,
    formula: "1d20+2",
    total: 19,
    meta: { kind: "initiative", statKey: "initiative", title: "Любой перевод" },
    timestamp: 1794800000000,
  },
}

describe("standalone LSS initiative adapter", () => {
  it("uses the machine kind, integer total and ID from the ordinary sheet URL", () => {
    expect(initiativeFromPageRecord(detail, address + "?modal=health", eventId)).toEqual({
      eventId,
      characterId: id,
      total: 19,
      timestamp: detail.record.timestamp,
    })
    for (const total of [0, -2])
      expect(
        initiativeFromPageRecord(
          { record: { ...detail.record, total } },
          address,
          eventId,
        )?.total,
      ).toBe(total)
  })
  it("ignores a renamed attack, unknown schema, private rolls and ambiguous results", () => {
    for (const patch of [
      { meta: { kind: "attack", statKey: "initiative", title: "Инициатива" } },
      { meta: { kind: "initiative", statKey: "dex" } },
      { version: 2 },
      { visibility: "self" },
      { total: "19 | 7" },
      { total: 1.5 },
      { total: Infinity },
      { timestamp: "yesterday" },
    ])
      expect(
        initiativeFromPageRecord(
          { record: { ...detail.record, ...patch } },
          address,
          eventId,
        ),
      ).toBeNull()
  })
  it("does not confuse another website, iframe, constructor or unsafe ID with this sheet", () => {
    for (const url of [
      "https://attacker.test/characters/digital/" + id,
      "http://longstoryshort.app/characters/digital/" + id,
      "https://longstoryshort.app/iframe/characters/digital/" + id,
      "https://longstoryshort.app/characters/builder/" + id,
      "https://longstoryshort.app/characters/digital/%2Fsecret",
    ]) {
      expect(lssCharacterId(url)).toBeNull()
      expect(initiativeFromPageRecord(detail, url, eventId)).toBeNull()
    }
  })
  it("requires a bounded delivery envelope", () => {
    const valid = initiativeFromPageRecord(detail, address, eventId)!
    expect(parseBrowserInitiative(valid)).toEqual(valid)
    for (const patch of [
      { eventId: "../x" },
      { characterId: "x/y" },
      { total: 1_000_001 },
      { timestamp: -1 },
    ])
      expect(parseBrowserInitiative({ ...valid, ...patch })).toBeNull()
  })
})
