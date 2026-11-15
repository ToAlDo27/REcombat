import { describe, expect, it } from "vitest"
import {
  canControl,
  canEdit,
  emptyState,
  normalizeOperation,
  orderedCombatants,
  reduceOperations,
} from "../src/model"
import type { Actor, Combatant, Command, Operation } from "../src/types"

const fighter = (id = "a"): Combatant => ({
  id,
  name: id,
  ownerId: "alice",
  initiative: null,
  bonus: 0,
  hp: 20,
  maxHp: 20,
  ac: 12,
  faction: "pc",
})
const op = (
  command: Command,
  clock: number,
  actorId = "alice",
  idempotencyId = `${actorId}-${clock}`,
): Operation => ({ ...command, schema: 1, clock, actorId, idempotencyId })

describe("persistent combat operation reducer", () => {
  it("replays out-of-order delivery and duplicate registrations without resetting stats", () => {
    const add = op({ kind: "add", combatant: { ...fighter(), tokenId: "token-a" } }, 1)
    const patch = op({ kind: "patch", id: "a", patch: { ac: 19, bonus: 4 } }, 2)
    const damage = op({ kind: "hp", id: "a", delta: -7 }, 3)
    const duplicate = op(
      { kind: "add", combatant: { ...fighter("other-id"), tokenId: "token-a" } },
      4,
      "bob",
    )
    const state = reduceOperations([damage, duplicate, add, patch, add, damage])
    expect(state.opCount).toBe(4)
    expect(state.combatants).toEqual([
      { ...fighter(), tokenId: "token-a", ac: 19, bonus: 4, hp: 13 },
    ])
    expect(reduceOperations([add, patch, damage, duplicate])).toEqual(state)
  })

  it("preserves independent fields, additive HP changes, and deterministic same-field resolution", () => {
    const values = [
      op({ kind: "add", combatant: fighter() }, 1),
      op({ kind: "patch", id: "a", patch: { ac: 15, name: "Alice" } }, 2, "alice"),
      op({ kind: "patch", id: "a", patch: { bonus: 8, name: "Bob" } }, 2, "bob"),
      op({ kind: "hp", id: "a", delta: -3 }, 3, "alice"),
      op({ kind: "hp", id: "a", delta: -4 }, 3, "bob"),
    ]
    const forward = reduceOperations(values)
    expect(reduceOperations([...values].reverse())).toEqual(forward)
    expect(forward.combatants[0]).toMatchObject({ ac: 15, bonus: 8, name: "Bob", hp: 13 })
  })

  it("collapses concurrent turn advances from one parent and accepts a later next", () => {
    const values = [
      op({ kind: "add", combatant: fighter("a") }, 1),
      op({ kind: "add", combatant: fighter("b") }, 2),
      op(
        { kind: "turn", active: true, round: 1, combatantId: "a", expectedEventId: null },
        3,
        "alice",
        "start",
      ),
      op(
        {
          kind: "turn",
          active: true,
          round: 1,
          combatantId: "b",
          expectedEventId: "start",
        },
        4,
        "alice",
        "next-a",
      ),
      op(
        {
          kind: "turn",
          active: true,
          round: 1,
          combatantId: "b",
          expectedEventId: "start",
        },
        4,
        "bob",
        "next-b",
      ),
    ]
    expect(reduceOperations(values).turn).toEqual({
      active: true,
      round: 1,
      combatantId: "b",
      eventId: "next-a",
    })
    values.push(
      op(
        {
          kind: "turn",
          active: true,
          round: 2,
          combatantId: "a",
          expectedEventId: "next-a",
        },
        5,
        "bob",
        "later",
      ),
    )
    expect(reduceOperations([...values].reverse()).turn).toEqual({
      active: true,
      round: 2,
      combatantId: "a",
      eventId: "later",
    })
  })

  it("ignores malformed journal data and does not mutate input", () => {
    const add = op({ kind: "add", combatant: fighter() }, 1)
    const frozen = JSON.stringify(add)
    expect(normalizeOperation({ ...add, clock: NaN })).toBeNull()
    expect(
      normalizeOperation({ ...add, combatant: { ...fighter(), maxHp: 0 } }),
    ).toBeNull()
    expect(
      normalizeOperation({ ...add, kind: "settings", patch: { diceSides: 1 } }),
    ).toBeNull()
    expect(
      normalizeOperation({ ...add, kind: "hp", id: "a", delta: Infinity }),
    ).toBeNull()
    expect(
      reduceOperations([
        null,
        false,
        { schema: 2 },
        add,
        op({ kind: "hp", id: "a", delta: -50 }, 2),
      ]).combatants[0].hp,
    ).toBe(0)
    expect(JSON.stringify(add)).toBe(frozen)
  })

  it("sorts unrolled participants last in both directions and tie-breaks predictably", () => {
    const state = emptyState()
    state.combatants = [
      fighter("z"),
      { ...fighter("b"), initiative: 10, bonus: 2 },
      { ...fighter("a"), initiative: 10, bonus: 4 },
      { ...fighter("c"), initiative: 3 },
    ]
    expect(orderedCombatants(state).map(c => c.id)).toEqual(["a", "b", "c", "z"])
    state.settings.reverse = true
    expect(orderedCombatants(state).map(c => c.id)).toEqual(["c", "a", "b", "z"])
  })

  it("keeps the shared register editable by everyone by default", () => {
    const settings = emptyState().settings
    const player: Actor = {
      id: "bob",
      connectionId: "b",
      name: "Bob",
      color: "#000",
      role: "PLAYER",
    }
    expect(canEdit(fighter(), player, settings)).toBe(true)
    expect(canControl(player, settings)).toBe(false)
    settings.playerEdit = "own"
    expect(canEdit(fighter(), player, settings)).toBe(false)
    expect(canEdit(fighter(), { ...player, role: "GM" }, settings)).toBe(true)
  })
})
