interface View {
  receivers: { tabId: number; roomId: string; label: string; ready: boolean }[]
  target: { tabId: number; roomId: string } | null
  last: { ok: boolean; text: string } | null
}
const rooms = document.querySelector<HTMLSelectElement>("#rooms")!
const connect = document.querySelector<HTMLButtonElement>("#connect")!
const disconnect = document.querySelector<HTMLButtonElement>("#disconnect")!
const active = document.querySelector<HTMLElement>("#active")!
const last = document.querySelector<HTMLElement>("#last")!
let view: View
async function refresh() {
  view = await chrome.runtime.sendMessage({ type: "popup:state" })
  if (!view?.receivers) return
  const selected = rooms.value
  rooms.replaceChildren()
  for (const receiver of view.receivers) {
    const option = document.createElement("option")
    option.value = receiver.tabId + ":" + receiver.roomId
    option.textContent = receiver.label + (receiver.ready ? "" : " · сцена не открыта")
    option.disabled = !receiver.ready
    rooms.append(option)
  }
  if (!rooms.options.length) {
    const option = document.createElement("option")
    option.textContent = "Откройте Owlbear с REcombat 1.3.0"
    option.value = ""
    rooms.append(option)
  }
  const target = view.target && view.target.tabId + ":" + view.target.roomId
  const wanted = selected || target
  if (wanted && [...rooms.options].some(option => option.value === wanted))
    rooms.value = wanted
  connect.disabled = !rooms.value || !!rooms.selectedOptions[0]?.disabled
  disconnect.disabled = !view.target
  const receiver = view.receivers.find(
    item => item.tabId === view.target?.tabId && item.roomId === view.target?.roomId,
  )
  active.textContent = view.target
    ? receiver?.ready
      ? "Подключено: " + receiver.label
      : "Ожидаем выбранную комнату Owlbear."
    : "Комната ещё не выбрана."
  last.textContent =
    view.last?.text ??
    "После установки обновите вкладки LSS и Owlbear, затем выберите комнату."
  last.classList.toggle("error", view.last?.ok === false)
}
connect.addEventListener("click", () => {
  const receiver = view.receivers.find(
    item => item.tabId + ":" + item.roomId === rooms.value,
  )
  if (!receiver) return
  void chrome.runtime
    .sendMessage({
      type: "popup:connect",
      tabId: receiver.tabId,
      roomId: receiver.roomId,
    })
    .then(refresh)
})
disconnect.addEventListener("click", () => {
  void chrome.runtime.sendMessage({ type: "popup:disconnect" }).then(refresh)
})
rooms.addEventListener("change", () => {
  connect.disabled = !rooms.value || !!rooms.selectedOptions[0]?.disabled
})
void refresh()
setInterval(() => void refresh(), 2_000)
export {}
