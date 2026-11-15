import type { RollResult, Settings } from "./types"

/** Rejection sampling avoids the modulo bias of randomByte % sides. */
export function randomDie(sides: number): number {
  if (!Number.isInteger(sides) || sides < 2 || sides > 1000)
    throw new Error("Размер кости должен быть от 2 до 1000.")
  const limit = Math.floor(0x100000000 / sides) * sides
  const values = new Uint32Array(1)
  do {
    crypto.getRandomValues(values)
  } while (values[0] >= limit)
  return (values[0] % sides) + 1
}

export function rollInitiative(bonus: number, settings: Settings): RollResult {
  const first = randomDie(settings.diceSides)
  const second = settings.rollMode === "normal" ? first : randomDie(settings.diceSides)
  const natural =
    settings.rollMode === "advantage"
      ? Math.max(first, second)
      : settings.rollMode === "disadvantage"
        ? Math.min(first, second)
        : first
  return {
    natural,
    total: natural + bonus,
    sides: settings.diceSides,
    mode: settings.rollMode,
  }
}
