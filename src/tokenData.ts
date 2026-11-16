import type { Item } from "@owlbear-rodeo/sdk"
import { normalizeLssLink } from "./lss"
import {
  PREFIX,
  type Combatant,
  type TokenProfile,
  type TokenProfilePatch,
} from "./types"

export const TOKEN_DATA_KEY = `${PREFIX}/token`
const own = (value: object, key: string) =>
  Object.prototype.hasOwnProperty.call(value, key)
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value)
const finite = (value: unknown, min: number, max = 1_000_000): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= min && value <= max

/** Reject invalid edits instead of silently storing a broken token card. */
export function normalizeTokenPatch(value: unknown): TokenProfilePatch | null {
  if (!record(value)) return null
  const result: TokenProfilePatch = {}
  if (own(value, "name")) {
    if (
      typeof value.name !== "string" ||
      !value.name.trim() ||
      value.name.trim().length > 200
    )
      return null
    result.name = value.name.trim()
  }
  for (const [key, min, max] of [
    ["hp", 0, 1_000_000],
    ["maxHp", 1, 1_000_000],
    ["ac", 0, 10000],
    ["bonus", -10000, 10000],
  ] as const) {
    if (!own(value, key)) continue
    const field = value[key]
    if (!finite(field, min, max)) return null
    result[key] = field
  }
  if (own(value, "initiative")) {
    if (value.initiative !== null && !finite(value.initiative, -1_000_000)) return null
    result.initiative = value.initiative
  }
  if (own(value, "faction")) {
    if (value.faction !== "pc" && value.faction !== "npc") return null
    result.faction = value.faction
  }
  if (own(value, "rollMode")) {
    if (
      value.rollMode !== null &&
      value.rollMode !== "normal" &&
      value.rollMode !== "advantage" &&
      value.rollMode !== "disadvantage"
    )
      return null
    result.rollMode = value.rollMode
  }
  if (own(value, "lss")) {
    if (value.lss === null) result.lss = null
    else {
      const link = normalizeLssLink(value.lss)
      if (!link) return null
      result.lss = link
    }
  }
  return result
}

export function normalizeTokenProfile(value: unknown): TokenProfile | null {
  const patch = normalizeTokenPatch(value)
  return patch &&
    typeof patch.name === "string" &&
    typeof patch.hp === "number" &&
    typeof patch.maxHp === "number" &&
    typeof patch.ac === "number" &&
    typeof patch.bonus === "number" &&
    patch.initiative !== undefined &&
    patch.faction
    ? ({ ...patch, hp: Math.min(patch.hp, patch.maxHp) } as TokenProfile)
    : null
}

export function readTokenProfile(
  item: Item,
  faction: TokenProfile["faction"] = "npc",
): TokenProfile {
  const stored = item.metadata?.[TOKEN_DATA_KEY]
  const profile =
    record(stored) && stored.schema === 1 ? normalizeTokenProfile(stored) : null
  return (
    profile ?? {
      name: (item.name || "Без имени").slice(0, 200),
      hp: 10,
      maxHp: 10,
      ac: 10,
      bonus: 0,
      initiative: null,
      faction,
    }
  )
}

export function tokenProfileFromCombatant(combatant: Combatant): TokenProfile {
  const { name, hp, maxHp, ac, bonus, initiative, faction, rollMode, lss } = combatant
  return {
    name,
    hp,
    maxHp,
    ac,
    bonus,
    initiative,
    faction,
    ...(rollMode !== undefined ? { rollMode } : {}),
    ...(lss !== undefined ? { lss: lss ? { ...lss } : null } : {}),
  }
}

export function tokenMetadata(profile: TokenProfile): TokenProfile & { schema: 1 } {
  return { schema: 1, ...profile }
}
