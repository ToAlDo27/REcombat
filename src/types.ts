import type { Item } from "@owlbear-rodeo/sdk"

export const PREFIX = "com.toaldo27.recombat"
export const SOURCE_URL = "https://github.com/ToAlDo27/REcombat"
export interface Actor {
  id: string
  connectionId: string
  name: string
  role: "GM" | "PLAYER"
  color: string
}
export interface RollResult {
  natural: number
  total: number
  sides: number
  mode: "normal" | "advantage" | "disadvantage"
}
export interface LssLink {
  characterId: string
  url: string
  sync: boolean
}
export interface TokenProfile {
  name: string
  initiative: number | null
  bonus: number
  hp: number
  maxHp: number
  ac: number
  faction: "pc" | "npc"
  /** null/omitted follows the room setting. */
  rollMode?: RollResult["mode"] | null
  lss?: LssLink | null
}
export type TokenProfilePatch = Partial<TokenProfile>
export type TokenInitiative = "manual" | "roll" | "empty"
export interface Combatant extends TokenProfile {
  id: string
  tokenId?: string
  ownerId: string
  lastRoll?: RollResult
}
export interface Settings {
  diceSides: number
  reverse: boolean
  showHp: boolean
  showAc: boolean
  highlight: boolean
  sound: boolean
  playerEdit: "all" | "own"
  playersCanAdvance: boolean
  hideNpcStats: boolean
  rollMode: "normal" | "advantage" | "disadvantage"
  tokenInitiative: TokenInitiative
}
export interface Turn {
  active: boolean
  combatantId: string | null
  round: number
  eventId: string | null
}
export interface CombatState {
  combatants: Combatant[]
  tokenProfiles: Record<string, TokenProfile>
  settings: Settings
  turn: Turn
  opCount: number
}
export type Command =
  | { kind: "add"; combatant: Combatant; initiative?: TokenInitiative }
  | { kind: "token"; tokenId: string; base: TokenProfile; patch: TokenProfilePatch }
  | { kind: "patch"; id: string; patch: Partial<Omit<Combatant, "id" | "tokenId">> }
  | { kind: "hp"; id: string; delta: number }
  | { kind: "remove"; id: string }
  | { kind: "roll"; id: string; result: RollResult }
  | { kind: "settings"; patch: Partial<Settings> }
  | {
      kind: "turn"
      combatantId: string | null
      round: number
      active: boolean
      expectedEventId: string | null
    }
  | { kind: "resetInitiative" }
export type Operation = Command & {
  schema: 1
  idempotencyId: string
  clock: number
  actorId: string
}
export interface Snapshot extends CombatState {
  ready: boolean
  loading: boolean
  pending: number
  error?: string
  actor: Actor | null
  items: Item[]
  party: Actor[]
  sceneKey: string
}
