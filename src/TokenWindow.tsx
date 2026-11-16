import { useEffect, useState, useSyncExternalStore } from "react"
import OBR from "@owlbear-rodeo/sdk"
import { store } from "./store"
import { canEdit } from "./model"
import TokenEditor from "./TokenEditor"
import { readTokenProfile } from "./tokenData"
import { LssGuide, LssPanel } from "./LssPanel"
import { VortexPanel } from "./VortexPanel"
import { TOKEN_WINDOW_ID } from "./tokenWindowApi"

type Tab = "data" | "lss" | "vortex"
const query = new URLSearchParams(location.search)
const tokenId = query.get("token") ?? ""
const initialTab: Tab =
  query.get("tab") === "lss" ? "lss" : query.get("tab") === "vortex" ? "vortex" : "data"

export function TokenWindow() {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const [tab, setTab] = useState<Tab>(initialTab)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [remove, setRemove] = useState(false)
  useEffect(() => store.start(), [])
  const close = () => {
    void OBR.modal.close(TOKEN_WINDOW_ID).catch(() => undefined)
  }
  const perform = async (task: () => Promise<unknown>) => {
    if (busy) return
    setBusy(true)
    setError("")
    try {
      await task()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось сохранить изменение.")
    } finally {
      setBusy(false)
    }
  }
  const item = snapshot.items.find(
    item =>
      item.id === tokenId &&
      item.type === "IMAGE" &&
      ["CHARACTER", "MOUNT"].includes(item.layer) &&
      (snapshot.actor?.role === "GM" || item.visible),
  )
  const combatant = snapshot.combatants.find(c => c.tokenId === tokenId)
  const profile =
    combatant ??
    snapshot.tokenProfiles[tokenId] ??
    (item
      ? readTokenProfile(item, snapshot.actor?.role === "GM" ? "npc" : "pc")
      : undefined)
  const editable =
    !!snapshot.actor &&
    !!item &&
    (combatant
      ? canEdit(combatant, snapshot.actor, snapshot.settings)
      : snapshot.actor.role === "GM" ||
        snapshot.settings.playerEdit === "all" ||
        item.createdUserId === snapshot.actor.id)
  const hidden =
    profile?.faction === "npc" &&
    snapshot.actor?.role !== "GM" &&
    snapshot.settings.hideNpcStats
  return (
    <main className="token-window">
      <header className="brand">
        <img src="./icon.svg" alt="" />
        <div>
          <strong>REcombat</strong>
          <span>{profile?.name ?? "Данные токена"}</span>
        </div>
        <button className="quiet" aria-label="Закрыть окно токена" onClick={close}>
          ×
        </button>
      </header>
      {(error || snapshot.error) && (
        <p className="error" role="alert">
          {error || snapshot.error}
        </p>
      )}
      {!OBR.isAvailable ? (
        <p>Откройте это окно через меню токена в Owlbear Rodeo.</p>
      ) : !snapshot.ready || snapshot.loading ? (
        <p role="status">Загружаем данные токена…</p>
      ) : !item || !profile ? (
        <p role="alert">Токен удалён или недоступен в текущей сцене.</p>
      ) : (
        <>
          <nav className="token-tabs" aria-label="Раздел карточки токена">
            <button aria-pressed={tab === "data"} onClick={() => setTab("data")}>
              Данные и бой
            </button>
            <button aria-pressed={tab === "lss"} onClick={() => setTab("lss")}>
              Лист LSS
            </button>
            <button aria-pressed={tab === "vortex"} onClick={() => setTab("vortex")}>
              Vortex
            </button>
          </nav>
          {tab === "data" &&
            (hidden ? (
              <p>Показатели NPC скрыты ведущим.</p>
            ) : (
              <>
                <div className="token-summary" aria-label="Состояние токена">
                  <span>
                    ХП{" "}
                    <b>
                      {profile.hp}/{profile.maxHp}
                    </b>
                  </span>
                  <span>
                    КЗ <b>{profile.ac}</b>
                  </span>
                  <span>
                    Инициатива <b>{profile.initiative ?? "—"}</b>
                  </span>
                </div>
                <div className="token-battle-actions">
                  {combatant ? (
                    <>
                      <button
                        disabled={!editable || busy}
                        onClick={() => void perform(() => store.roll(combatant.id))}
                      >
                        ⚄ Бросить инициативу
                      </button>
                      <button
                        className="quiet"
                        disabled={!editable || busy}
                        onClick={() => setRemove(!remove)}
                      >
                        Убрать из боя
                      </button>
                    </>
                  ) : (
                    <span className="save-note">
                      Сохраните карточку или добавьте токен в бой кнопкой ниже.
                    </span>
                  )}
                </div>
                {remove && combatant && (
                  <div className="confirm">
                    <span>Убрать из боя, сохранив карточку?</span>
                    <button
                      disabled={busy}
                      onClick={() =>
                        void perform(async () => {
                          await store.dispatch({ kind: "remove", id: combatant.id })
                          setRemove(false)
                        })
                      }
                    >
                      Убрать
                    </button>
                    <button onClick={() => setRemove(false)}>Отмена</button>
                  </div>
                )}
                <TokenEditor
                  key={snapshot.sceneKey + item.id}
                  inline
                  item={item}
                  profile={profile}
                  combatant={combatant}
                  settings={snapshot.settings}
                  defaultFaction={snapshot.actor?.role === "GM" ? "npc" : "pc"}
                  disabled={!editable || busy}
                  onSave={patch => store.saveTokenProfile(item.id, patch)}
                  onAdd={initiative => store.addTokens([item], { initiative })}
                  onClose={close}
                />
              </>
            ))}
          {tab === "lss" && (
            <>
              <div className="token-sheet-links">
                {profile.lss ? (
                  <a href={profile.lss.url} target="_blank" rel="noreferrer">
                    Открыть этого персонажа на LSS ↗
                  </a>
                ) : (
                  <p>
                    Персонаж LSS пока не привязан к токену. Укажите ссылку на вкладке
                    «Данные и бой» или выберите свой лист ниже.
                  </p>
                )}
                <button className="quiet" onClick={() => setTab("data")}>
                  Настроить привязку
                </button>
              </div>
              <p className="save-note">
                Доступ к листу определяет LSS. Общую группу и просмотр участников удобно
                открыть на вкладке Vortex.
              </p>
              <LssPanel
                key={snapshot.sceneKey + item.id}
                item={item}
                snapshot={snapshot}
                onClose={close}
              />
              <LssGuide />
            </>
          )}
          {tab === "vortex" && <VortexPanel />}
        </>
      )}
    </main>
  )
}
