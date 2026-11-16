import {
  lssCharacterId,
  object,
  parseBrowserInitiative,
} from "../../src/browserBridgeProtocol"

/**
 * Observed LSS rollService CustomEvent, NOT the public iframe SDK envelope.
 * Fail closed on a changed schema; never infer initiative from a displayed name.
 */
export function initiativeFromPageRecord(
  detail: unknown,
  address: string,
  eventId: string,
) {
  const characterId = lssCharacterId(address)
  if (!characterId || !object(detail) || !object(detail.record)) return null
  const record = detail.record
  if (
    record.version !== 1 ||
    !object(record.meta) ||
    record.meta.kind !== "initiative" ||
    record.meta.statKey !== "initiative" ||
    (record.visibility !== undefined && record.visibility !== "all")
  )
    return null
  return parseBrowserInitiative({
    eventId,
    characterId,
    total: record.total,
    timestamp: record.timestamp,
  })
}
