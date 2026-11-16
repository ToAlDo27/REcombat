import {
  lssCharacterId,
  object,
  parseBridgeContext,
  parseBrowserInitiative,
  type BridgeContext,
  type BridgeResult,
} from "../../src/browserBridgeProtocol"

interface Receiver extends BridgeContext {
  tabId: number
  frameId: number
  documentId: string
  label: string
}
interface State {
  receivers: Receiver[]
  target: { tabId: number; roomId: string } | null
  last: { ok: boolean; text: string } | null
}
const empty = (): State => ({ receivers: [], target: null, last: null })
async function state(): Promise<State> {
  const stored = (await chrome.storage.session.get("bridgeState")).bridgeState
  return (stored as State | undefined) ?? empty()
}
async function save(next: State) {
  await chrome.storage.session.set({ bridgeState: next })
}
function room(address?: string): { id: string; label: string } | null {
  try {
    const url = new URL(address ?? "")
    if (url.origin !== "https://www.owlbear.rodeo") return null
    const match = /^\/room\/([a-zA-Z0-9_-]{1,128})(?:\/([^/]+))?\/?$/.exec(url.pathname)
    return match
      ? { id: match[1], label: decodeURIComponent(match[2] ?? match[1]) }
      : null
  } catch {
    return null
  }
}
function isReceiver(sender: chrome.runtime.MessageSender) {
  try {
    const url = new URL(sender.url ?? "")
    return (
      sender.id === chrome.runtime.id &&
      sender.tab?.id !== undefined &&
      !!sender.frameId &&
      !!sender.documentId &&
      url.origin === "https://toaldo27.github.io" &&
      url.pathname === "/REcombat/background.html"
    )
  } catch {
    return false
  }
}
const popup = (sender: chrome.runtime.MessageSender) =>
  sender.id === chrome.runtime.id && sender.url === chrome.runtime.getURL("popup.html")

async function recordResult(next: State, result: BridgeResult) {
  next.last = { ok: result.ok, text: result.message }
  await save(next)
  await chrome.action.setBadgeText({ text: result.ok ? "✓" : "!" })
  await chrome.action.setBadgeBackgroundColor({
    color: result.ok ? "#287a54" : "#a44236",
  })
  return result
}

async function handle(message: unknown, sender: chrome.runtime.MessageSender) {
  if (!object(message) || sender.id !== chrome.runtime.id) return
  const next = await state()
  if (message.type === "receiver:ready" && isReceiver(sender)) {
    const context = parseBridgeContext(message.context)
    const parent = room((await chrome.tabs.get(sender.tab!.id!)).url)
    if (!context || parent?.id !== context.roomId) return
    const tabId = sender.tab!.id!
    next.receivers = next.receivers.filter(receiver => receiver.tabId !== tabId)
    next.receivers.push({
      ...context,
      tabId,
      frameId: sender.frameId!,
      documentId: sender.documentId!,
      label: parent.label,
    })
    await save(next)
    return { ok: true }
  }
  if (popup(sender)) {
    if (message.type === "popup:state") {
      const tabs = await chrome.tabs.query({})
      next.receivers = next.receivers.filter(receiver =>
        tabs.some(
          tab => tab.id === receiver.tabId && room(tab.url)?.id === receiver.roomId,
        ),
      )
      await save(next)
      // Do not expose the frame nonce to the UI.
      return {
        ...next,
        receivers: next.receivers.map(({ tabId, roomId, label, ready }) => ({
          tabId,
          roomId,
          label,
          ready,
        })),
      }
    }
    if (message.type === "popup:connect") {
      const receiver = next.receivers.find(
        item =>
          item.tabId === message.tabId && item.roomId === message.roomId && item.ready,
      )
      if (!receiver) return { ok: false }
      next.target = { tabId: receiver.tabId, roomId: receiver.roomId }
      next.last = {
        ok: true,
        text: "Подключено: " + receiver.label + ". Теперь бросьте инициативу в LSS.",
      }
      await save(next)
      return { ok: true }
    }
    if (message.type === "popup:disconnect") {
      next.target = null
      next.last = { ok: true, text: "Передача инициативы отключена." }
      await save(next)
      await chrome.action.setBadgeText({ text: "" })
      return { ok: true }
    }
    return
  }
  if (message.type !== "source:roll" || sender.frameId !== 0 || !sender.tab) return
  const roll = parseBrowserInitiative(message.roll)
  // Chrome sender.url can remain at the document's initial Gatsby route.
  // The tab URL is browser-provided and follows the current character selection.
  if (
    !roll ||
    new URL(sender.url ?? "").origin !== "https://longstoryshort.app" ||
    sender.tab.id === undefined
  )
    return
  const sourceTab = await chrome.tabs.get(sender.tab.id)
  const characterId = lssCharacterId(sourceTab.url ?? "")
  if (!characterId || characterId !== roll.characterId) return
  const target = next.target
  const receiver =
    target &&
    next.receivers.find(
      item => item.tabId === target.tabId && item.roomId === target.roomId && item.ready,
    )
  if (!receiver)
    return recordResult(next, {
      ok: false,
      applied: 0,
      message: "Выберите открытую комнату Owlbear в меню REcombat · LSS Bridge.",
    })
  try {
    const tab = await chrome.tabs.get(receiver.tabId)
    if (room(tab.url)?.id !== receiver.roomId)
      throw new Error("Комната Owlbear закрыта или изменилась.")
    const result: unknown = await chrome.tabs.sendMessage(
      receiver.tabId,
      { type: "receiver:deliver", nonce: receiver.nonce, roll },
      { documentId: receiver.documentId },
    )
    if (
      !object(result) ||
      typeof result.ok !== "boolean" ||
      typeof result.applied !== "number" ||
      typeof result.message !== "string"
    )
      throw new Error("REcombat не подтвердил сохранение.")
    return recordResult(next, {
      ok: result.ok,
      applied: result.applied,
      message: result.message.slice(0, 500),
    })
  } catch {
    return recordResult(next, {
      ok: false,
      applied: 0,
      message:
        "Приёмник недоступен. Обновите страницу Owlbear и проверьте выбранную комнату.",
    })
  }
}

// Serial processing also prevents old delivery acknowledgements overwriting a new target.
let queue = Promise.resolve()
chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
  queue = queue.then(async () => {
    try {
      respond(await handle(message, sender))
    } catch {
      respond({ ok: false, message: "Не удалось связаться с мостом." })
    }
  })
  return true
})
function forget(tabId: number, removed: boolean) {
  queue = queue
    .then(async () => {
      const next = await state()
      next.receivers = next.receivers.filter(receiver => receiver.tabId !== tabId)
      if (removed && next.target?.tabId === tabId) next.target = null
      await save(next)
    })
    .catch(() => {})
}
chrome.tabs.onRemoved.addListener(tabId => forget(tabId, true))
chrome.tabs.onUpdated.addListener((tabId, change) => {
  // Child popovers also change a tab's loading status; only top URL changes
  // invalidate the registration. A reload is guarded by documentId + nonce.
  if (change.url) forget(tabId, false)
})
