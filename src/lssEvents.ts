/** Official LSS OBR bridge channel. Messages carry a SheetEvent directly. */
export const LSS_SHEET_CHANNEL = "rodeo.lss/sheet-events"

/** Public DiceRollPayload from @longstoryshort/vtt-sdk 0.9.0. */
export interface DiceRollPayload {
  characterId: string
  characterName: string
  title: string
  formula: string
  breakdown: string
  total: string
  isCrit: boolean
  critKind?: "success" | "failure"
  timestamp: number
}

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value)

const hasControlCharacters = (value: string): boolean => {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code === 127 || (code < 32 && code !== 9 && code !== 10 && code !== 13))
      return true
  }
  return false
}

const boundedText = (value: unknown, max: number, allowEmpty = false): value is string =>
  typeof value === "string" &&
  value.length <= max &&
  (allowEmpty || value.trim().length > 0) &&
  !hasControlCharacters(value)

/**
 * Parse the data field of an OBR broadcast, never an arbitrary postMessage.
 * The iframe transport has a different, versioned envelope and must validate
 * event.source and event.origin through the LSS SDK before reaching this layer.
 */
export function parseLssRoll(value: unknown): DiceRollPayload | null {
  if (!record(value) || value.type !== "lss:roll" || !record(value.payload)) return null
  const roll = value.payload
  if (
    !boundedText(roll.characterId, 200) ||
    /\s/u.test(roll.characterId) ||
    !boundedText(roll.characterName, 200) ||
    !boundedText(roll.title, 200) ||
    !boundedText(roll.formula, 2000, true) ||
    !boundedText(roll.breakdown, 4000, true) ||
    !boundedText(roll.total, 200) ||
    typeof roll.isCrit !== "boolean" ||
    (roll.critKind !== undefined &&
      roll.critKind !== "success" &&
      roll.critKind !== "failure") ||
    typeof roll.timestamp !== "number" ||
    !Number.isSafeInteger(roll.timestamp) ||
    roll.timestamp < 0
  )
    return null

  return {
    characterId: roll.characterId,
    characterName: roll.characterName,
    title: roll.title,
    formula: roll.formula,
    breakdown: roll.breakdown,
    total: roll.total,
    isCrit: roll.isCrit,
    ...(roll.critKind !== undefined ? { critKind: roll.critKind } : {}),
    timestamp: roll.timestamp,
  }
}

/**
 * LSS has no machine-readable roll kind. Accept only an explicit initiative
 * label and a single integer result; advantage pairs need a player's choice.
 */
export function initiativeFromRoll(roll: DiceRollPayload): number | null {
  const title = roll.title.trim().replace(/\s+/gu, " ")
  const russian =
    /^(?:(?:бросок|проверка) )?инициатив(?:а|ы)(?: ?(?:\([^()]{1,80}\)|\[[^[\]]{1,80}\]))?$/iu
  const english =
    /^(?:(?:roll|check) )?initiative(?: (?:roll|check))?(?: ?(?:\([^()]{1,80}\)|\[[^[\]]{1,80}\]))?$/iu
  if (!russian.test(title) && !english.test(title)) return null
  const total = roll.total.trim()
  if (!/^[+-]?\d{1,7}$/u.test(total)) return null
  const result = Number(total)
  return Number.isSafeInteger(result) && Math.abs(result) <= 1_000_000 ? result : null
}

/** Compact deterministic fingerprint for replay deduplication, not authentication. */
export function rollIdentity(roll: DiceRollPayload): string {
  const input = JSON.stringify([
    roll.characterId,
    roll.characterName,
    roll.timestamp,
    roll.title,
    roll.formula,
    roll.breakdown,
    roll.total,
    roll.isCrit,
    roll.critKind ?? null,
  ])
  let first = 0x811c9dc5
  let second = 0x9e3779b9
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i)
    first = Math.imul(first ^ code, 0x01000193)
    second = Math.imul(second ^ code, 0x85ebca6b)
  }
  const hex = (value: number) => (value >>> 0).toString(16).padStart(8, "0")
  return `lss-roll:${roll.timestamp}:${hex(first)}${hex(second)}`
}
