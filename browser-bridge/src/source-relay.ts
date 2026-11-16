import {
  BROWSER_BRIDGE,
  object,
  parseBrowserInitiative,
} from "../../src/browserBridgeProtocol"

// Only this isolated half has access to the browser messaging API.
window.addEventListener("message", event => {
  if (
    event.source !== window ||
    event.origin !== location.origin ||
    !object(event.data) ||
    event.data.channel !== BROWSER_BRIDGE ||
    event.data.from !== "lss-page" ||
    event.data.type !== "initiative"
  )
    return
  const roll = parseBrowserInitiative(event.data.roll)
  if (!roll) return
  void chrome.runtime.sendMessage({ type: "source:roll", roll }).catch(() => {})
})
