import type {
  ContextMenuItem,
  Item,
  Metadata,
  Modal,
  Player,
  Popover,
} from "@owlbear-rodeo/sdk"
// Keep real SDK builders and item geometry. Only its network transport is replaced.
export * from "../../node_modules/@owlbear-rodeo/sdk/lib/index.js"

type Handler<T> = (value: T) => void
type Transport = Window & {
  __obrGetMetadata?: () => Promise<Metadata>
  __obrSetMetadata?: (patch: Metadata) => Promise<void>
  __obrGetRoomMetadata?: () => Promise<Metadata>
  __obrSetRoomMetadata?: (patch: Metadata) => Promise<void>
  __obrGetItems?: () => Promise<Item[]>
  __obrGetPlayers?: () => Promise<Player[]>
  __obrUpdateItems?: (items: Item[]) => Promise<void>
  __obrBroadcast?: (
    channel: string,
    data: unknown,
    options?: { destination?: "LOCAL" | "REMOTE" | "ALL" },
  ) => Promise<void>
  __obrOpenPopover?: (popover: Popover) => Promise<void>
  __obrOpenModal?: (modal: Modal) => Promise<void>
  __obrCloseModal?: (id: string) => Promise<void>
  __obrClosePopover?: (id: string) => Promise<void>
  __obrResizePopover?: (
    id: string,
    dimension: "width" | "height",
    value: number,
  ) => Promise<void>
}
const transport = window as Transport
const query = new URLSearchParams(location.search)
const role = query.get("role") === "PLAYER" ? "PLAYER" : "GM"
const client = query.get("client") ?? "host"
const metadataListeners = new Set<Handler<Metadata>>()
const roomMetadataListeners = new Set<Handler<Metadata>>()
const itemsListeners = new Set<Handler<Item[]>>()
const readyListeners = new Set<Handler<boolean>>()
const partyListeners = new Set<Handler<Player[]>>()
const broadcasts = new Map<
  string,
  Set<Handler<{ data: unknown; connectionId: string }>>
>()
const clone = <T>(value: T): T => structuredClone(value)
const noop = async () => undefined
const noSubscription = () => () => undefined
const player: Player = {
  id: client,
  connectionId: client,
  name: client,
  role,
  color: "#93bbdd",
  syncView: false,
  metadata: {},
  selection: [],
}
type MockRelay = {
  receiveMetadata(metadata: Metadata): void
  receiveRoomMetadata(metadata: Metadata): void
  receiveItems(items: Item[]): void
  receiveParty(players: Player[]): void
  receiveBroadcast(
    channel: string,
    message: { data: unknown; connectionId: string },
  ): void
}
// Modal tests mount real extension documents in child frames. Each document has
// its own SDK/store, just as Owlbear does, and receives the host's scene relay.
const childMocks = (): MockRelay[] => {
  const children: MockRelay[] = []
  for (let index = 0; index < window.frames.length; index++) {
    try {
      const mock = (window.frames[index] as Window & { __obrMock?: MockRelay })
        .__obrMock
      if (mock) children.push(mock)
    } catch {
      // A cross-origin LSS sheet is not an Owlbear extension client.
    }
  }
  return children
}
const state = {
  metadata: {} as Metadata,
  roomMetadata: {} as Metadata,
  items: [] as Item[],
  local: [] as Item[],
  selection: [] as string[],
  ready: true,
  writes: [] as Metadata[],
  roomWrites: [] as Metadata[],
  localWrites: [] as { kind: string; ids: string[] }[],
  notifications: [] as string[],
  contextMenus: [] as ContextMenuItem[],
  modalOpens: [] as Modal[],
  modalCloses: [] as string[],
  players: [] as Player[],
  clickContextMenu: async (id: string, itemIds: string[]) => {
    const menu = state.contextMenus.find(menu => menu.id === id)
    if (!menu?.onClick) throw new Error(`Unknown context menu: ${id}`)
    const items = transport.__obrGetItems
      ? await transport.__obrGetItems()
      : state.items
    await menu.onClick(
      {
        items: clone(items.filter(item => itemIds.includes(item.id))),
        selectionBounds: {
          min: { x: 0, y: 0 },
          max: { x: 150, y: 150 },
          center: { x: 75, y: 75 },
          width: 150,
          height: 150,
        },
      },
      id,
    )
  },
  receiveParty: (players: Player[]) => {
    state.players = clone(players)
    partyListeners.forEach(fn => fn(clone(players)))
    childMocks().forEach(child => child.receiveParty(players))
  },
  receiveMetadata: (metadata: Metadata) => {
    state.metadata = clone(metadata)
    metadataListeners.forEach(fn => fn(clone(state.metadata)))
    childMocks().forEach(child => child.receiveMetadata(metadata))
  },
  receiveRoomMetadata: (metadata: Metadata) => {
    state.roomMetadata = clone(metadata)
    roomMetadataListeners.forEach(fn => fn(clone(state.roomMetadata)))
    childMocks().forEach(child => child.receiveRoomMetadata(metadata))
  },
  receiveItems: (items: Item[]) => {
    state.items = clone(items)
    itemsListeners.forEach(fn => fn(clone(state.items)))
    childMocks().forEach(child => child.receiveItems(items))
  },
  setReady: (ready: boolean) => {
    state.ready = ready
    readyListeners.forEach(fn => fn(ready))
  },
  receiveBroadcast: (channel: string, message: { data: unknown; connectionId: string }) => {
    broadcasts.get(channel)?.forEach(fn => fn(message))
    childMocks().forEach(child => child.receiveBroadcast(channel, message))
  },
}
Object.assign(window, { __obrMock: state })

const itemsApi = {
  getItems: async (filter?: (item: Item) => boolean) => {
    if (transport.__obrGetItems) state.items = await transport.__obrGetItems()
    return clone(filter ? state.items.filter(filter) : state.items)
  },
  onChange: (fn: Handler<Item[]>) => {
    itemsListeners.add(fn)
    return () => itemsListeners.delete(fn)
  },
  updateItems: async (ids: string[], update: (draft: Item[]) => void) => {
    const latest = transport.__obrGetItems ? await transport.__obrGetItems() : state.items
    const draft = clone(latest.filter(item => ids.includes(item.id)))
    update(draft)
    if (transport.__obrUpdateItems) await transport.__obrUpdateItems(draft)
    else
      state.receiveItems(
        state.items.map(item => draft.find(next => next.id === item.id) ?? item),
      )
  },
  getItemBounds: async (ids: string[]) => {
    const found = state.items.filter(item => ids.includes(item.id))
    const x = found[0]?.position.x ?? 0
    const y = found[0]?.position.y ?? 0
    return {
      min: { x: x - 75, y: y - 75 },
      max: { x: x + 75, y: y + 75 },
      center: { x, y },
      width: 150,
      height: 150,
    }
  },
}
const localApi = {
  getItems: async () => clone(state.local),
  addItems: async (items: Item[]) => {
    state.localWrites.push({ kind: "add", ids: items.map(item => item.id) })
    state.local.push(...clone(items))
  },
  updateItems: async (idsOrItems: string[] | Item[], update: (draft: Item[]) => void) => {
    const ids = idsOrItems.map(item => (typeof item === "string" ? item : item.id))
    const draft = clone(state.local.filter(item => ids.includes(item.id)))
    update(draft)
    state.local = state.local.map(item => draft.find(next => next.id === item.id) ?? item)
    state.localWrites.push({ kind: "update", ids })
  },
  deleteItems: async (ids: string[]) => {
    state.local = state.local.filter(item => !ids.includes(item.id))
    state.localWrites.push({ kind: "delete", ids })
  },
}
const OBR = {
  isAvailable: query.get("embedded") !== "0",
  isReady: true,
  onReady: (callback: () => void) => queueMicrotask(callback),
  room: {
    id: "mock-room",
    getId: async () => "mock-room",
    getMetadata: async () => {
      if (transport.__obrGetRoomMetadata)
        state.roomMetadata = await transport.__obrGetRoomMetadata()
      return clone(state.roomMetadata)
    },
    setMetadata: async (patch: Metadata) => {
      state.roomWrites.push(clone(patch))
      if (transport.__obrSetRoomMetadata) await transport.__obrSetRoomMetadata(patch)
      else state.receiveRoomMetadata({ ...state.roomMetadata, ...patch })
    },
    onMetadataChange: (fn: Handler<Metadata>) => {
      roomMetadataListeners.add(fn)
      return () => roomMetadataListeners.delete(fn)
    },
  },
  player: {
    id: client,
    getId: async () => client,
    getConnectionId: async () => client,
    getRole: async () => role,
    getName: async () => client,
    getColor: async () => player.color,
    getSelection: async () => state.selection,
    hasPermission: async () => true,
    onChange: noSubscription,
  },
  party: {
    getPlayers: async () => {
      if (transport.__obrGetPlayers) state.players = await transport.__obrGetPlayers()
      return clone(state.players)
    },
    onChange: (fn: Handler<Player[]>) => {
      partyListeners.add(fn)
      return () => partyListeners.delete(fn)
    },
  },
  scene: {
    isReady: async () => state.ready,
    onReadyChange: (fn: Handler<boolean>) => {
      readyListeners.add(fn)
      return () => readyListeners.delete(fn)
    },
    getMetadata: async () => {
      if (transport.__obrGetMetadata) state.metadata = await transport.__obrGetMetadata()
      return clone(state.metadata)
    },
    setMetadata: async (patch: Metadata) => {
      state.writes.push(clone(patch))
      if (transport.__obrSetMetadata) await transport.__obrSetMetadata(patch)
      else state.receiveMetadata({ ...state.metadata, ...patch })
    },
    onMetadataChange: (fn: Handler<Metadata>) => {
      metadataListeners.add(fn)
      return () => metadataListeners.delete(fn)
    },
    items: itemsApi,
    local: localApi,
    grid: { getDpi: async () => 150 },
  },
  contextMenu: {
    create: async (menu: ContextMenuItem) => {
      state.contextMenus = state.contextMenus.filter(entry => entry.id !== menu.id)
      state.contextMenus.push(menu)
    },
    remove: async (id: string) => {
      state.contextMenus = state.contextMenus.filter(menu => menu.id !== id)
    },
  },
  modal: {
    open: async (modal: Modal) => {
      state.modalOpens.push(clone(modal))
      await transport.__obrOpenModal?.(modal)
    },
    close: async (id: string) => {
      state.modalCloses.push(id)
      await transport.__obrCloseModal?.(id)
    },
  },
  popover: {
    open: async (popover: Popover) => transport.__obrOpenPopover?.(popover),
    close: async (id: string) => transport.__obrClosePopover?.(id),
    setWidth: async (id: string, value: number) =>
      transport.__obrResizePopover?.(id, "width", value),
    setHeight: async (id: string, value: number) =>
      transport.__obrResizePopover?.(id, "height", value),
  },
  action: { setHeight: noop, setBadgeText: noop, setBadgeBackgroundColor: noop },
  notification: {
    show: async (message: string) => {
      state.notifications.push(message)
    },
  },
  theme: {
    getTheme: async () => ({ mode: "DARK" }),
    onChange: noSubscription,
  },
  viewport: { animateTo: noop },
  broadcast: {
    sendMessage: async (
      channel: string,
      data: unknown,
      options?: { destination?: "LOCAL" | "REMOTE" | "ALL" },
    ) => {
      if (transport.__obrBroadcast) await transport.__obrBroadcast(channel, data, options)
      else if (options?.destination === "LOCAL" || options?.destination === "ALL")
        state.receiveBroadcast(channel, { data, connectionId: client })
    },
    onMessage: (
      channel: string,
      fn: Handler<{ data: unknown; connectionId: string }>,
    ) => {
      let listeners = broadcasts.get(channel)
      if (!listeners) {
        listeners = new Set()
        broadcasts.set(channel, listeners)
      }
      listeners.add(fn)
      return () => listeners?.delete(fn)
    },
  },
}
export default OBR
