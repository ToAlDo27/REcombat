import {
  BROWSER_BRIDGE,
  object,
  parseBridgeContext,
  type BridgeContext,
  type BridgeResult,
} from "../../src/browserBridgeProtocol"

let context: BridgeContext | null = null
const pending = new Map<
  string,
  { finish: (result: BridgeResult) => void; timer: number }
>()
const send = (data: Record<string, unknown>) =>
  window.postMessage(
    { channel: BROWSER_BRIDGE, from: "companion", ...data },
    location.origin,
  )
window.addEventListener("message", event => {
  if (
    event.source !== window ||
    event.origin !== location.origin ||
    !object(event.data) ||
    event.data.channel !== BROWSER_BRIDGE ||
    event.data.from !== "recombat"
  )
    return
  const data = event.data
  if (data.type === "ready") {
    const next = parseBridgeContext(data.context)
    if (!next) return
    context = next
    void chrome.runtime.sendMessage({ type: "receiver:ready", context }).catch(() => {})
  } else if (
    data.type === "result" &&
    data.nonce === context?.nonce &&
    typeof data.requestId === "string" &&
    object(data.result) &&
    typeof data.result.ok === "boolean" &&
    typeof data.result.applied === "number" &&
    typeof data.result.message === "string"
  ) {
    const request = pending.get(data.requestId)
    if (!request) return
    clearTimeout(request.timer)
    pending.delete(data.requestId)
    request.finish({
      ok: data.result.ok,
      applied: data.result.applied,
      message: data.result.message.slice(0, 500),
    })
  }
})
chrome.runtime.onMessage.addListener((message: unknown, _sender, respond) => {
  if (!object(message) || message.type !== "receiver:deliver") return false
  if (!context?.ready || message.nonce !== context.nonce) {
    respond({
      ok: false,
      applied: 0,
      message: "Обновите страницу Owlbear и выберите комнату ещё раз.",
    })
    return false
  }
  const requestId = crypto.randomUUID()
  const timer = window.setTimeout(() => {
    pending.delete(requestId)
    respond({
      ok: false,
      applied: 0,
      message: "REcombat не ответил. Обновите страницу Owlbear.",
    })
  }, 8_000)
  pending.set(requestId, { finish: respond, timer })
  send({ type: "initiative", ...context, requestId, roll: message.roll })
  return true
})
send({ type: "probe" })
