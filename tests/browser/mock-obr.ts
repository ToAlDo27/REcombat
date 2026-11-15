import type { Item, Metadata, Player } from "@owlbear-rodeo/sdk"
// Keep real SDK builders and item geometry. Only its network transport is replaced.
export * from "../../node_modules/@owlbear-rodeo/sdk/lib/index.js"

type Handler<T> = (value: T) => void
type Transport = Window & {
  __obrGetMetadata?: () => Promise<Metadata>
  __obrSetMetadata?: (patch: Metadata) => Promise<void>
  __obrGetItems?: () => Promise<Item[]>
  __obrBroadcast?: (channel: string, data: unknown) => Promise<void>
}
const transport = window as Transport
const query = new URLSearchParams(location.search)
const role = query.get("role") === "PLAYER" ? "PLAYER" : "GM"
const client = query.get("client") ?? "host"
const metadataListeners = new Set<Handler<Metadata>>()
const itemsListeners = new Set<Handler<Item[]>>()
const readyListeners = new Set<Handler<boolean>>()
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
const state = {
  metadata: {} as Metadata,
  items: [] as Item[],
  local: [] as Item[],
  selection: [] as string[],
  ready: true,
  writes: [] as Metadata[],
  localWrites: [] as { kind: string; ids: string[] }[],
  notifications: [] as string[],
  receiveMetadata: (metadata: Metadata) => {
    state.metadata = clone(metadata)
    metadataListeners.forEach(fn => fn(clone(state.metadata)))
  },
  receiveItems: (items: Item[]) => {
    state.items = clone(items)
    itemsListeners.forEach(fn => fn(clone(state.items)))
  },
  setReady: (ready: boolean) => {
    state.ready = ready
    readyListeners.forEach(fn => fn(ready))
  },
  receiveBroadcast: (channel: string, message: { data: unknown; connectionId: string }) =>
    broadcasts.get(channel)?.forEach(fn => fn(message)),
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
  room: { id: "mock-room", getId: async () => "mock-room" },
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
  party: { getPlayers: async () => [], onChange: noSubscription },
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
  contextMenu: { create: noop, remove: noop },
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
    sendMessage: async (channel: string, data: unknown) => {
      if (transport.__obrBroadcast) await transport.__obrBroadcast(channel, data)
      else state.receiveBroadcast(channel, { data, connectionId: client })
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
