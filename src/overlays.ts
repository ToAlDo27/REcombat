import OBR, {
  type BoundingBox,
  type Item,
  type Label,
  type Path,
} from "@owlbear-rodeo/sdk"
import { PREFIX, type Snapshot } from "./types"

const MARKER = `${PREFIX}/overlay`
type OverlaySdk = Pick<typeof OBR, "scene">
type Overlay = Label | Path
const owned = (item: Item) => !!item.metadata[MARKER]

/** Local items keep the shared tokens untouched and obey each viewer's visibility. */
export function createOverlayRenderer(sdk: OverlaySdk = OBR) {
  const owner = crypto.randomUUID()
  const ids = new Map<string, string>()
  const bounds = new Map<string, { geometry: string; value: BoundingBox }>()
  let latest: Snapshot | undefined
  let version = 0
  let activeScene: string | undefined
  let running: Promise<void> | undefined
  let destroyed = false
  let lastError: unknown

  const idFor = (key: string) => {
    let id = ids.get(key)
    if (!id) {
      id = crypto.randomUUID()
      ids.set(key, id)
    }
    return id
  }

  function base(
    snapshot: Snapshot,
    token: Item,
    kind: string,
    position: Item["position"],
  ): Item {
    return {
      id: idFor(`${token.id}/${kind}`),
      type: "ITEM",
      name: `REcombat · ${kind}`,
      createdUserId: snapshot.actor!.id,
      lastModifiedUserId: snapshot.actor!.id,
      lastModified: "1970-01-01T00:00:00.000Z",
      metadata: { [MARKER]: { owner, version: 1 } },
      position,
      rotation: 0,
      scale: { x: 1, y: 1 },
      zIndex: kind === "turn" ? 1000 : 1001,
      visible: token.visible,
      locked: true,
      layer: "ATTACHMENT",
      attachedTo: token.id,
      disableHit: true,
      disableAutoZIndex: true,
      disableAttachmentBehavior: ["ROTATION", "SCALE", "COPY"],
    }
  }

  async function getBounds(token: Item) {
    // The host accounts for image DPI, grid offset, rotation and non-uniform scale.
    const geometry = JSON.stringify(token)
    const cached = bounds.get(token.id)
    if (cached?.geometry === geometry) return cached.value
    const value = await sdk.scene.items.getItemBounds([token.id])
    if (
      ![value.width, value.height, value.center.x, value.center.y].every(Number.isFinite)
    ) {
      throw new Error("Некорректные границы токена")
    }
    bounds.set(token.id, { geometry, value })
    return value
  }

  async function build(snapshot: Snapshot) {
    const tokens = new Map(snapshot.items.map(item => [item.id, item]))
    const desired: Overlay[] = []
    await Promise.all(
      snapshot.combatants.map(async combatant => {
        const token = combatant.tokenId ? tokens.get(combatant.tokenId) : undefined
        if (!token || (!token.visible && snapshot.actor?.role !== "GM")) return
        const hideStats =
          snapshot.actor?.role !== "GM" &&
          combatant.faction === "npc" &&
          snapshot.settings.hideNpcStats
        const stats = [
          snapshot.settings.showHp && !hideStats
            ? `ХП ${combatant.hp}/${combatant.maxHp}`
            : "",
          snapshot.settings.showAc && !hideStats ? `КЗ ${combatant.ac}` : "",
        ]
          .filter(Boolean)
          .join("  ·  ")
        const active =
          snapshot.settings.highlight &&
          snapshot.turn.active &&
          snapshot.turn.combatantId === combatant.id
        if (!stats && !active) return
        const box = await getBounds(token)
        if (stats) {
          desired.push({
            ...base(snapshot, token, "stats", { x: box.center.x, y: box.max.y + 8 }),
            type: "LABEL",
            text: {
              plainText: stats,
              richText: [{ type: "paragraph", children: [{ text: stats }] }],
              type: "PLAIN",
              width: "AUTO",
              height: "AUTO",
              style: {
                fontFamily: "Roboto",
                fontSize: 14,
                fontWeight: 700,
                fillColor: combatant.hp <= 0 ? "#fda4af" : "#f8fafc",
                fillOpacity: 1,
                strokeColor: "#111827",
                strokeOpacity: 0,
                strokeWidth: 0,
                textAlign: "CENTER",
                textAlignVertical: "MIDDLE",
                padding: 5,
                lineHeight: 1.1,
              },
            },
            style: {
              backgroundColor: "#111827",
              backgroundOpacity: 0.94,
              cornerRadius: 6,
              pointerWidth: 0,
              pointerHeight: 0,
              minViewScale: 0.45,
              maxViewScale: 1.7,
            },
          })
        }
        if (active) {
          const rx = Math.max(12, box.width / 2 + 9)
          const ry = Math.max(12, box.height / 2 + 9)
          const k = 0.5522847498
          // Explicit path coordinates give an unambiguous center at the host bounds center.
          desired.push({
            ...base(snapshot, token, "turn", box.center),
            type: "PATH",
            fillRule: "nonzero",
            commands: [
              [0, rx, 0],
              [4, rx, ry * k, rx * k, ry, 0, ry],
              [4, -rx * k, ry, -rx, ry * k, -rx, 0],
              [4, -rx, -ry * k, -rx * k, -ry, 0, -ry],
              [4, rx * k, -ry, rx, -ry * k, rx, 0],
              [5],
            ],
            style: {
              fillColor: "#fbbf24",
              fillOpacity: 0.08,
              strokeColor: "#fbbf24",
              strokeOpacity: 1,
              strokeWidth: Math.max(4, Math.min(rx, ry) / 12),
              strokeDash: [],
            },
          })
        }
      }),
    )
    return desired
  }

  const isCurrent = (revision: number, snapshot: Snapshot) =>
    !destroyed && version === revision && latest === snapshot && snapshot.ready

  async function reconcile(snapshot: Snapshot, revision: number) {
    if (!snapshot.ready || !snapshot.actor) {
      activeScene = undefined
      ids.clear()
      bounds.clear()
      return
    }
    if (activeScene !== snapshot.sceneKey) {
      const old = (await sdk.scene.local.getItems()).filter(owned)
      if (!isCurrent(revision, snapshot)) return
      if (old.length) await sdk.scene.local.deleteItems(old.map(item => item.id))
      if (!isCurrent(revision, snapshot)) return
      ids.clear()
      bounds.clear()
      activeScene = snapshot.sceneKey
    }
    const desired = await build(snapshot)
    if (!isCurrent(revision, snapshot)) return
    const existing = (await sdk.scene.local.getItems()).filter(owned)
    if (!isCurrent(revision, snapshot)) return
    const next = new Map(desired.map(item => [item.id, item]))
    const previous = new Map(existing.map(item => [item.id, item]))
    const removed = existing.filter(item => !next.has(item.id)).map(item => item.id)
    if (removed.length) await sdk.scene.local.deleteItems(removed)
    if (!isCurrent(revision, snapshot)) return
    const added = desired.filter(item => !previous.has(item.id))
    if (added.length) await sdk.scene.local.addItems(added)
    if (!isCurrent(revision, snapshot)) return
    const changed = desired.filter(
      item =>
        previous.has(item.id) && comparable(item) !== comparable(previous.get(item.id)!),
    )
    if (changed.length)
      await sdk.scene.local.updateItems(
        changed.map(item => previous.get(item.id)!),
        drafts => {
          for (const draft of drafts) {
            const replacement = next.get(draft.id)
            if (replacement) Object.assign(draft, replacement)
          }
        },
      )
    const tokenIds = new Set(snapshot.items.map(item => item.id))
    for (const key of bounds.keys()) if (!tokenIds.has(key)) bounds.delete(key)
  }

  function schedule() {
    if (running || destroyed) return
    running = (async () => {
      let handled = -1
      while (!destroyed && latest && handled !== version) {
        handled = version
        try {
          await reconcile(latest, handled)
          lastError = undefined
        } catch (error) {
          if (String(error) !== String(lastError))
            console.warn("REcombat: не удалось обновить подписи токенов", error)
          lastError = error
        }
      }
    })().finally(() => {
      running = undefined
    })
  }

  return {
    render(snapshot: Snapshot) {
      if (destroyed) return
      latest = snapshot
      version++
      schedule()
    },
    async destroy() {
      destroyed = true
      version++
      await running
      if (latest?.ready) {
        const local = await sdk.scene.local.getItems()
        const mine = local.filter(
          item =>
            (item.metadata[MARKER] as { owner?: string } | undefined)?.owner === owner,
        )
        if (mine.length) await sdk.scene.local.deleteItems(mine.map(item => item.id))
      }
      ids.clear()
      bounds.clear()
    },
  }
}

function comparable(item: Item) {
  return JSON.stringify(item, (key, value: unknown) =>
    key === "lastModified" || key === "lastModifiedUserId" ? undefined : value,
  )
}
