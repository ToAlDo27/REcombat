import OBR, {
  type ContextMenuContext,
  type ContextMenuIconFilter,
  type ContextMenuItem,
  type Item,
} from "@owlbear-rodeo/sdk"
import { store, type CombatStore } from "./store"
import { openTokenWindow } from "./tokenWindowApi"
import { PREFIX } from "./types"

export const TOKEN_MENU_IDS = {
  add: `${PREFIX}/add-token`,
  data: `${PREFIX}/token-data`,
  lss: `${PREFIX}/token-lss`,
} as const

type ContextMenuSdk = Pick<typeof OBR, "contextMenu" | "notification">
type TokenStore = Pick<CombatStore, "getSnapshot" | "addTokens">

// KeyFilter has no grouped expression/IN operator. Excluding the other SDK
// layers preserves IMAGE && (CHARACTER || MOUNT), also for mixed selections.
const otherLayers: Item["layer"][] = [
  "MAP",
  "GRID",
  "DRAWING",
  "PROP",
  "ATTACHMENT",
  "NOTE",
  "TEXT",
  "RULER",
  "FOG",
  "POINTER",
  "POST_PROCESS",
  "CONTROL",
  "POPOVER",
]

function tokenFilter(single: boolean): ContextMenuIconFilter {
  return {
    min: 1,
    ...(single ? { max: 1 } : {}),
    every: [
      { key: "type", value: "IMAGE" },
      ...otherLayers.map(layer => ({
        key: "layer",
        value: layer,
        operator: "!=" as const,
      })),
    ],
  }
}

const isToken = (item: Item) =>
  item.type === "IMAGE" && ["CHARACTER", "MOUNT"].includes(item.layer)

/** Register once in the background, so the menu works without the action panel. */
export function startTokenContextMenus(
  combatStore: TokenStore = store,
  sdk: ContextMenuSdk = OBR,
  openWindow: typeof openTokenWindow = openTokenWindow,
): () => void {
  let stopped = false
  const registered = new Set<string>()
  const notify = async (
    message: string,
    variant: "ERROR" | "INFO" | "SUCCESS",
  ) => {
    if (!stopped) await sdk.notification.show(message, variant)
  }
  const report = async (error: unknown) => {
    try {
      await notify(
        error instanceof Error ? error.message : "Не удалось выполнить действие REcombat.",
        "ERROR",
      )
    } catch {
      // A room closing can also make the notification transport unavailable.
    }
  }
  const currentTokens = (context: ContextMenuContext) => {
    const snapshot = combatStore.getSnapshot()
    if (!snapshot.ready || !snapshot.actor)
      throw new Error("Дождитесь синхронизации сцены и повторите действие.")
    const ids = new Set(context.items.map(item => item.id))
    const items = snapshot.items.filter(
      item =>
        ids.has(item.id) &&
        isToken(item) &&
        (snapshot.actor?.role === "GM" || item.visible),
    )
    if (!items.length)
      throw new Error("Токен недоступен или уже удалён из текущей сцены.")
    return { snapshot, items }
  }
  const action = (run: (context: ContextMenuContext) => Promise<void>) =>
    async (context: ContextMenuContext) => {
      if (stopped) return
      try {
        await run(context)
      } catch (error) {
        await report(error)
      }
    }
  const icon = new URL("action.svg", document.baseURI).href
  const menus: ContextMenuItem[] = [
    {
      id: TOKEN_MENU_IDS.add,
      icons: [{ icon, label: "Добавить в REcombat", filter: tokenFilter(false) }],
      onClick: action(async context => {
        const { snapshot, items } = currentTokens(context)
        const added = items.filter(
          item => !snapshot.combatants.some(combatant => combatant.tokenId === item.id),
        )
        if (!added.length) {
          await notify("Выбранные токены уже участвуют в REcombat.", "INFO")
          return
        }
        // The store owns authorization, initiative policy and journal persistence.
        await combatStore.addTokens(added)
        await notify(`Добавлено в REcombat: ${added.length}.`, "SUCCESS")
      }),
    },
    {
      id: TOKEN_MENU_IDS.data,
      icons: [{ icon, label: "Данные токена · REcombat", filter: tokenFilter(true) }],
      onClick: action(async context => {
        const { items } = currentTokens(context)
        await openWindow(items[0].id, "data")
      }),
    },
    {
      id: TOKEN_MENU_IDS.lss,
      icons: [{ icon, label: "Открыть лист LSS", filter: tokenFilter(true) }],
      onClick: action(async context => {
        const { items } = currentTokens(context)
        // The LSS tab also explains binding when this token has no character yet.
        await openWindow(items[0].id, "lss")
      }),
    },
  ]

  const remove = (id: string) =>
    sdk.contextMenu.remove(id).catch(() => {
      // Host disposal already removes the iframe's menus when leaving the room.
    })
  for (const menu of menus) {
    void sdk.contextMenu
      .create(menu)
      .then(async () => {
        if (stopped) await remove(menu.id)
        else registered.add(menu.id)
      })
      .catch(report)
  }

  return () => {
    if (stopped) return
    stopped = true
    for (const id of registered) void remove(id)
    registered.clear()
  }
}
