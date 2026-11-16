import { initiativeFromPageRecord } from "./lssRecord"
import { BROWSER_BRIDGE, object } from "../../src/browserBridgeProtocol"

// The page world preserves record identity across CustomEvent deliveries.
// No page patching, API interception or cookie access.
const seen = new WeakSet<object>()
window.addEventListener("lss:roll", event => {
  const detail: unknown = (event as CustomEvent).detail
  if (!object(detail) || !object(detail.record) || seen.has(detail.record)) return
  const roll = initiativeFromPageRecord(detail, location.href, crypto.randomUUID())
  if (!roll) return
  seen.add(detail.record)
  window.postMessage(
    { channel: BROWSER_BRIDGE, from: "lss-page", type: "initiative", roll },
    location.origin,
  )
})
