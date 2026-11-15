import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import OBR from "@owlbear-rodeo/sdk"
import { store } from "./store"
import { canControl, canEdit, orderedCombatants } from "./model"
import { AUDIO_STATUS, readAudio, requestAudio } from "./audio"
import type { Combatant, Settings, Snapshot } from "./types"
import { SOURCE_URL } from "./types"

const manifestUrl = new URL("manifest.json", document.baseURI).href
const run = (task: Promise<unknown>) => {
  void task.catch(() => undefined)
}

function Source() {
  return (
    <footer>
      <span>ToAlDo27 · REcombat 1.0</span>
      <a href={SOURCE_URL} target="_blank" rel="noreferrer">
        Исходный код ↗
      </a>
    </footer>
  )
}

function Landing() {
  const [copied, setCopied] = useState(false)
  return (
    <main className="landing">
      <header className="brand">
        <img src="./icon.svg" alt="" />
        <div>
          <strong>REcombat</strong>
          <span>для Owlbear Rodeo</span>
        </div>
        <span className="tag">1.0</span>
      </header>
      <div className="hero-mark" aria-hidden="true">
        ⚔
      </div>
      <p className="eyebrow">ОТ ПЕРВОГО БРОСКА ДО ПОБЕДЫ</p>
      <h1>
        Бой под
        <br />
        <em>контролем.</em>
      </h1>
      <p className="lead">
        Общая инициатива, ХП и КЗ на токенах. Каждый видит текущий ход, а удар меча
        объявляет следующий.
      </p>
      <div className="features">
        <div>
          <b>01</b>
          <strong>Бросайте вместе</strong>
          <p>Общий список участников и настройки инициативы.</p>
        </div>
        <div>
          <b>02</b>
          <strong>Следите за полем</strong>
          <p>Показатели и подсветка прямо на токенах.</p>
        </div>
        <div>
          <b>03</b>
          <strong>Возвращайтесь в бой</strong>
          <p>Список, раунд и текущий ход сохраняются в сцене.</p>
        </div>
      </div>
      <section className="install">
        <h2>Добавить в Owlbear Rodeo</h2>
        <p>
          Откройте комнату → Extras → Extensions → Add Extension. Вставьте эту ссылку:
        </p>
        <a className="manifest-link" href={manifestUrl}>
          {manifestUrl}
        </a>
        <button
          className="primary"
          onClick={() => {
            void navigator.clipboard
              .writeText(manifestUrl)
              .then(() => setCopied(true))
              .catch(() => setCopied(false))
          }}
        >
          {copied ? "Ссылка скопирована ✓" : "Скопировать ссылку установки"}
        </button>
        <small>
          Откройте сцену и нажмите на значок REcombat. Для звука каждый игрок включает его
          у себя.
        </small>
      </section>
      <Source />
    </main>
  )
}

function Field({
  label,
  value,
  save,
  disabled,
  text = false,
  placeholder,
}: {
  label: string
  value: string | number | null
  save: (value: string) => void
  disabled?: boolean
  text?: boolean
  placeholder?: string
}) {
  const [draft, setDraft] = useState(value === null ? "" : String(value))
  const focused = useRef(false)
  const dirty = useRef(false)
  useEffect(() => {
    if (!focused.current) setDraft(value === null ? "" : String(value))
  }, [value])
  const commit = () => {
    if (dirty.current) {
      dirty.current = false
      save(draft.trim())
    }
  }
  return (
    <input
      aria-label={label}
      value={draft}
      disabled={disabled}
      placeholder={placeholder}
      inputMode={text ? "text" : "decimal"}
      onFocus={() => {
        focused.current = true
      }}
      onChange={event => {
        dirty.current = true
        setDraft(event.target.value)
      }}
      onBlur={() => {
        focused.current = false
        commit()
        setDraft(value === null ? "" : String(value))
      }}
      onKeyDown={event => {
        if (event.key === "Enter") event.currentTarget.blur()
        if (event.key === "Escape") {
          dirty.current = false
          setDraft(value === null ? "" : String(value))
          event.currentTarget.blur()
        }
      }}
    />
  )
}

function CombatantCard({
  c,
  snapshot,
  perform,
}: {
  c: Combatant
  snapshot: Snapshot
  perform: (task: Promise<unknown>) => void
}) {
  const editable = canEdit(c, snapshot.actor, snapshot.settings)
  const hidden =
    snapshot.actor?.role !== "GM" && c.faction === "npc" && snapshot.settings.hideNpcStats
  const active = snapshot.turn.active && snapshot.turn.combatantId === c.id
  const [confirmRemove, setConfirmRemove] = useState(false)
  const patch = (
    field: "name" | "bonus" | "initiative" | "hp" | "maxHp" | "ac",
    value: string,
  ) => {
    if (field === "name") {
      if (value)
        perform(store.dispatch({ kind: "patch", id: c.id, patch: { name: value } }))
      return
    }
    if (field === "hp" && /^[+-]\d+(\.\d+)?$/.test(value)) {
      perform(store.dispatch({ kind: "hp", id: c.id, delta: Number(value) }))
      return
    }
    const number = field === "initiative" && value === "" ? null : Number(value)
    if (
      (value === "" && field !== "initiative") ||
      (number !== null && !Number.isFinite(number))
    )
      return
    perform(store.dispatch({ kind: "patch", id: c.id, patch: { [field]: number } }))
  }
  return (
    <article
      className={`combatant ${active ? "active" : ""} ${c.hp === 0 ? "down" : ""}`}
      data-testid={`combatant-${c.id}`}
    >
      <div className="combatant-top">
        <span
          className={`faction ${c.faction}`}
          title={c.faction === "pc" ? "Персонаж" : "NPC"}
        >
          {c.faction === "pc" ? "◆" : "◇"}
        </span>
        <Field
          text
          label={`Имя ${c.name}`}
          value={c.name}
          save={value => patch("name", value)}
          disabled={!editable}
        />
        {active && <span className="turn-label">ХОД</span>}
        <button
          className="icon-button delete"
          disabled={!editable}
          aria-label={`Удалить ${c.name}`}
          onClick={() => setConfirmRemove(!confirmRemove)}
        >
          ×
        </button>
      </div>
      {confirmRemove && (
        <div className="confirm">
          <span>Убрать из боя?</span>
          <button onClick={() => perform(store.dispatch({ kind: "remove", id: c.id }))}>
            Убрать
          </button>
          <button onClick={() => setConfirmRemove(false)}>Отмена</button>
        </div>
      )}
      <div className="stats">
        <label className="initiative-stat">
          <span>Инициатива</span>
          <div className="input-action">
            <Field
              label={`Инициатива ${c.name}`}
              value={c.initiative}
              placeholder="—"
              save={value => patch("initiative", value)}
              disabled={!editable}
            />
            <button
              title="Бросить инициативу"
              aria-label={`Бросить инициативу ${c.name}`}
              disabled={!editable}
              onClick={() => perform(store.roll(c.id))}
            >
              ⚄
            </button>
          </div>
        </label>
        <label className="bonus-stat">
          <span>Бонус</span>
          <Field
            label={`Бонус ${c.name}`}
            value={c.bonus}
            save={value => patch("bonus", value)}
            disabled={!editable}
          />
        </label>
        {hidden ? (
          <div className="hidden-stats">Показатели скрыты</div>
        ) : (
          <>
            <label className="hp-stat">
              <span>
                ХП <small>± урон / лечение</small>
              </span>
              <div className="hp-inputs">
                <Field
                  label={`ХП ${c.name}`}
                  value={c.hp}
                  save={value => patch("hp", value)}
                  disabled={!editable}
                />
                <span>/</span>
                <Field
                  label={`Максимум ХП ${c.name}`}
                  value={c.maxHp}
                  save={value => patch("maxHp", value)}
                  disabled={!editable}
                />
              </div>
            </label>
            <label className="ac-stat">
              <span>КЗ</span>
              <Field
                label={`КЗ ${c.name}`}
                value={c.ac}
                save={value => patch("ac", value)}
                disabled={!editable}
              />
            </label>
          </>
        )}
      </div>
      <div className="card-bottom">
        <span>
          {c.tokenId ? "Связан с токеном" : "Без токена"}
          {c.lastRoll &&
            ` · d${c.lastRoll.sides}: ${c.lastRoll.natural} ${
              c.bonus >= 0 ? "+" : "−"
            } ${Math.abs(c.bonus)}`}
        </span>
        <select
          aria-label={`Тип ${c.name}`}
          value={c.faction}
          disabled={!editable}
          onChange={event =>
            perform(
              store.dispatch({
                kind: "patch",
                id: c.id,
                patch: { faction: event.target.value as "pc" | "npc" },
              }),
            )
          }
        >
          <option value="pc">Персонаж</option>
          <option value="npc">NPC</option>
        </select>
      </div>
      {!hidden && (
        <div className="hp-bar">
          <i style={{ width: `${Math.min(100, (c.hp / c.maxHp) * 100)}%` }} />
        </div>
      )}
    </article>
  )
}

function SettingsPanel({
  snapshot,
  perform,
}: {
  snapshot: Snapshot
  perform: (task: Promise<unknown>) => void
}) {
  const gm = snapshot.actor?.role === "GM"
  const s = snapshot.settings
  const patch = (value: Partial<Settings>) =>
    perform(store.dispatch({ kind: "settings", patch: value }))
  return (
    <details className="settings">
      <summary>
        Настройки боя <span>{gm ? "Для всей комнаты" : "Управляет ведущий"}</span>
      </summary>
      <fieldset disabled={!gm}>
        <div className="settings-grid">
          <label>
            Кость инициативы
            <select
              value={s.diceSides}
              onChange={event => patch({ diceSides: Number(event.target.value) })}
            >
              {[4, 6, 8, 10, 12, 20, 100].map(d => (
                <option key={d} value={d}>
                  d{d}
                </option>
              ))}
            </select>
          </label>
          <label>
            Режим броска
            <select
              value={s.rollMode}
              onChange={event =>
                patch({ rollMode: event.target.value as Settings["rollMode"] })
              }
            >
              <option value="normal">Обычный</option>
              <option value="advantage">Преимущество</option>
              <option value="disadvantage">Помеха</option>
            </select>
          </label>
          <label>
            Порядок ходов
            <select
              value={String(s.reverse)}
              onChange={event => patch({ reverse: event.target.value === "true" })}
            >
              <option value="false">От большего к меньшему</option>
              <option value="true">От меньшего к большему</option>
            </select>
          </label>
          <label>
            Редактирование игроков
            <select
              value={s.playerEdit}
              onChange={event =>
                patch({ playerEdit: event.target.value as Settings["playerEdit"] })
              }
            >
              <option value="all">Общий список — всем</option>
              <option value="own">Только свои участники</option>
            </select>
          </label>
        </div>
        <div className="checks">
          {(
            [
              ["showHp", "ХП на токенах"],
              ["showAc", "КЗ на токенах"],
              ["highlight", "Подсветка текущего хода"],
              ["sound", "Удар меча при смене хода"],
              ["playersCanAdvance", "Игроки могут переключать ход"],
              ["hideNpcStats", "Скрывать показатели NPC у игроков"],
            ] as const
          ).map(([key, label]) => (
            <label key={key}>
              <input
                type="checkbox"
                checked={s[key]}
                onChange={event => patch({ [key]: event.target.checked })}
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
    </details>
  )
}

function Combat() {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const [name, setName] = useState("")
  const [picker, setPicker] = useState(false)
  const [error, setError] = useState("")
  const [audio, setAudio] = useState(readAudio)
  const [audioActive, setAudioActive] = useState(false)
  const [audioPending, setAudioPending] = useState(false)
  const audioTimer = useRef<ReturnType<typeof setTimeout>>()
  useEffect(() => store.start(), [])
  useEffect(() => {
    let dispose: (() => void) | undefined
    let alive = true
    OBR.onReady(() => {
      if (!alive) return
      dispose = OBR.broadcast.onMessage(AUDIO_STATUS, event => {
        const data = event.data as { enabled?: boolean }
        setAudioActive(data.enabled === true)
        setAudioPending(false)
        clearTimeout(audioTimer.current)
      })
      run(requestAudio(readAudio()))
    })
    return () => {
      alive = false
      dispose?.()
      clearTimeout(audioTimer.current)
    }
  }, [])
  const perform = (task: Promise<unknown>) => {
    setError("")
    void task.catch(cause =>
      setError(
        cause instanceof Error
          ? cause.message
          : "Не удалось сохранить изменение. Повторите действие.",
      ),
    )
  }
  const changeAudio = (enabled: boolean, volume = audio.volume) => {
    const next = { enabled, volume }
    setAudio(next)
    setAudioPending(true)
    clearTimeout(audioTimer.current)
    audioTimer.current = setTimeout(() => {
      setAudioPending(false)
      if (enabled)
        setError(
          "Звук пока не включён. Нажмите «Включить звук» ещё раз в открытой комнате.",
        )
    }, 4000)
    perform(requestAudio(next))
  }
  const tokens = snapshot.items.filter(
    item =>
      (item.layer === "CHARACTER" || item.layer === "MOUNT") &&
      item.type === "IMAGE" &&
      (snapshot.actor?.role === "GM" || item.visible),
  )
  const invisibleIds = new Set(
    snapshot.actor?.role === "GM"
      ? []
      : snapshot.items.filter(item => !item.visible).map(item => item.id),
  )
  const roster = orderedCombatants(snapshot).filter(
    c => !c.tokenId || !invisibleIds.has(c.tokenId),
  )
  const current = roster.find(c => c.id === snapshot.turn.combatantId)
  const control = canControl(snapshot.actor, snapshot.settings)
  const available = snapshot.ready && !snapshot.loading
  return (
    <main className="tracker">
      <header className="brand">
        <img src="./icon.svg" alt="" />
        <div>
          <strong>REcombat</strong>
          <span>Инициатива и состояние боя</span>
        </div>
        <span
          className={`sync ${snapshot.pending ? "pending" : ""}`}
          title="Состояние хранится в текущей сцене"
        >
          {snapshot.loading
            ? "Загрузка…"
            : snapshot.pending
              ? "Сохраняем…"
              : snapshot.ready
                ? "● Сохранено"
                : "Нет сцены"}
        </span>
      </header>
      {(error || snapshot.error) && (
        <div className="error" role="alert">
          {error || snapshot.error}
          <button
            onClick={() => {
              setError("")
              store.clearError()
            }}
            aria-label="Закрыть уведомление"
          >
            ×
          </button>
        </div>
      )}
      {!available ? (
        <section className="empty">
          <span>◇</span>
          <h2>{snapshot.loading ? "Загружаем бой…" : "Откройте сцену"}</h2>
          <p>Участники, настройки и текущий ход привязаны к сцене Owlbear Rodeo.</p>
        </section>
      ) : (
        <>
          <section className={`turn-panel ${snapshot.turn.active ? "running" : ""}`}>
            <div>
              <p className="eyebrow">
                {snapshot.turn.active
                  ? `РАУНД ${snapshot.turn.round}`
                  : "ПОЛЕ БОЯ ГОТОВО"}
              </p>
              <h1>
                {snapshot.turn.active
                  ? current?.name ?? "Выберите следующего участника"
                  : "Время бросать кости"}
              </h1>
              <p>
                {snapshot.turn.active
                  ? "Сейчас ходит этот участник"
                  : `${roster.length} участников · d${snapshot.settings.diceSides}${
                      snapshot.settings.rollMode === "advantage"
                        ? " · преимущество"
                        : snapshot.settings.rollMode === "disadvantage"
                          ? " · помеха"
                          : ""
                    }`}
              </p>
            </div>
            <span className="turn-glyph" aria-hidden="true">
              ⚔
            </span>
            <div className="turn-controls">
              {snapshot.turn.active ? (
                <>
                  <button
                    className="icon-button"
                    disabled={!control}
                    aria-label="Предыдущий ход"
                    title="Предыдущий ход"
                    onClick={() => perform(store.advance(-1))}
                  >
                    ←
                  </button>
                  <button
                    className="primary"
                    disabled={!control || !roster.length}
                    onClick={() => perform(store.advance(1))}
                  >
                    Следующий ход <span>→</span>
                  </button>
                  <button
                    className="quiet"
                    disabled={!control}
                    onClick={() => perform(store.endCombat())}
                  >
                    Завершить
                  </button>
                </>
              ) : (
                <button
                  className="primary"
                  disabled={!control || !roster.length}
                  onClick={() => perform(store.startCombat())}
                >
                  Начать бой <span>→</span>
                </button>
              )}
            </div>
          </section>
          <div className="audio-controls">
            <button
              className="quiet"
              disabled={audioPending}
              onClick={() => changeAudio(!audioActive)}
            >
              {audioPending
                ? "Включаем…"
                : audioActive
                  ? "♫ Звук включён"
                  : "♪ Включить звук"}
            </button>
            <input
              aria-label="Громкость удара меча"
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={audio.volume}
              onChange={event => {
                const next = { ...audio, volume: Number(event.target.value) }
                setAudio(next)
                run(requestAudio(next))
              }}
            />
            <small>Только у вас</small>
          </div>
          <section className="roster">
            <div className="section-title">
              <h2>
                Участники <span>{roster.length}</span>
              </h2>
              <button
                className="quiet"
                disabled={
                  !roster.some(c => canEdit(c, snapshot.actor, snapshot.settings))
                }
                onClick={() =>
                  perform(
                    Promise.all(
                      roster
                        .filter(c => canEdit(c, snapshot.actor, snapshot.settings))
                        .map(c => store.roll(c.id)),
                    ),
                  )
                }
              >
                ⚄ Бросить всем
              </button>
            </div>
            {roster.length ? (
              <div className="roster-list">
                {roster.map(c => (
                  <CombatantCard key={c.id} c={c} snapshot={snapshot} perform={perform} />
                ))}
              </div>
            ) : (
              <div className="roster-empty">
                <strong>Пока никого</strong>
                <p>Выделите токены на карте или добавьте участника по имени.</p>
              </div>
            )}
          </section>
          <section className="add-panel">
            <div className="add-buttons">
              <button
                onClick={() =>
                  perform(
                    OBR.player.getSelection().then(ids => {
                      const selected = tokens.filter(item => ids?.includes(item.id))
                      if (!selected.length)
                        throw new Error("Выделите токены персонажей на карте.")
                      return store.addTokens(selected)
                    }),
                  )
                }
              >
                ＋ Выделенные токены
              </button>
              <button
                className="quiet"
                aria-expanded={picker}
                onClick={() => setPicker(!picker)}
              >
                Выбрать из сцены {picker ? "↑" : "↓"}
              </button>
            </div>
            {picker && (
              <div className="token-picker">
                {tokens.length ? (
                  tokens.map(item => (
                    <button
                      key={item.id}
                      disabled={snapshot.combatants.some(c => c.tokenId === item.id)}
                      onClick={() => perform(store.addTokens([item]))}
                    >
                      <span>{item.name || "Без имени"}</span>
                      <span>
                        {snapshot.combatants.some(c => c.tokenId === item.id)
                          ? "✓"
                          : "＋"}
                      </span>
                    </button>
                  ))
                ) : (
                  <p>В сцене нет токенов персонажей.</p>
                )}
              </div>
            )}
            <form
              className="add-manual"
              onSubmit={event => {
                event.preventDefault()
                if (name.trim()) {
                  perform(store.addManual(name.trim()))
                  setName("")
                }
              }}
            >
              <input
                aria-label="Имя участника"
                placeholder="Имя участника без токена"
                maxLength={200}
                value={name}
                onChange={event => setName(event.target.value)}
              />
              <button type="submit" disabled={!name.trim()}>
                Добавить
              </button>
            </form>
          </section>
          <SettingsPanel snapshot={snapshot} perform={perform} />
          <p className="save-note">
            Общий список сохраняется в сцене. Все игроки могут добавлять участников
            одновременно.
          </p>
        </>
      )}
      <Source />
    </main>
  )
}

export default function App() {
  return OBR.isAvailable ? <Combat /> : <Landing />
}
