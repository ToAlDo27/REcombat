import { useEffect, useRef, useState } from "react"
import OBR, { type Item } from "@owlbear-rodeo/sdk"
import { createBridgeSheetSource, SHEET_IFRAME_SANDBOX } from "@longstoryshort/vtt-sdk"
import {
  LSS_DND_MANIFEST,
  LSS_ORIGIN,
  LSS_VORTEX_MANIFEST,
  lssFrameUrl,
  normalizeLssLink,
} from "./lss"
import { LSS_RELAY_CHANNEL } from "./lssIntegration"
import { LSS_SHEET_CHANNEL, parseLssRoll } from "./lssEvents"
import { store } from "./store"
import { readTokenProfile } from "./tokenData"
import type { Snapshot } from "./types"

export function LssGuide() {
  const [last, setLast] = useState<{ name: string; id: string }>()
  useEffect(
    () =>
      OBR.broadcast.onMessage(LSS_SHEET_CHANNEL, event => {
        const roll = parseLssRoll(event.data)
        if (roll) setLast({ name: roll.characterName, id: roll.characterId })
      }),
    [],
  )
  return (
    <details className="settings lss-guide">
      <summary>
        Листы Long Story Short <span>Связать с токенами</span>
      </summary>
      <p>
        В карточке токена укажите ссылку или ID персонажа LSS. Бросок «Инициатива» из
        официального листа попадёт в связанный токен и список боя.
      </p>
      <div className="lss-links">
        <a href={LSS_DND_MANIFEST} target="_blank" rel="noreferrer">
          Установить официальный лист D&D ↗
        </a>
        <a href={LSS_VORTEX_MANIFEST} target="_blank" rel="noreferrer">
          Установить Vortex ↗
        </a>
        <a
          href="https://longstoryshort.app/doc/integration/owlbear/"
          target="_blank"
          rel="noreferrer"
        >
          Инструкция LSS для Owlbear ↗
        </a>
      </div>
      <p>
        Установочные ссылки открывают манифест: скопируйте адрес в Extensions → Add
        Extension. Лист каждого игрока открывается под его аккаунтом.
      </p>
      <p>
        Официальный лист отправляет броски другим участникам. Для приёма ваших бросков
        REcombat должен быть включён также у ведущего. ХП и КЗ официальный мост не
        передаёт: заполните их на токене.
      </p>
      {last && (
        <p className="lss-last">
          Последний персонаж: <b>{last.name}</b>
          <br />
          ID: <code>{last.id}</code>
        </p>
      )}
    </details>
  )
}

/** Optional direct SDK bridge. LSS must allow the deployed host to embed sheets. */
export function LssPanel({
  item,
  snapshot,
  onClose,
}: {
  item: Item
  snapshot: Snapshot
  onClose: () => void
}) {
  const profile =
    snapshot.tokenProfiles[item.id] ??
    snapshot.combatants.find(c => c.tokenId === item.id) ??
    readTokenProfile(item)
  const link = profile.lss
  const iframe = useRef<HTMLIFrameElement>(null)
  const [status, setStatus] = useState("Загружаем лист…")
  const [characterId, setCharacterId] = useState("")
  const [error, setError] = useState("")
  const src = link ? lssFrameUrl(link) : `${LSS_ORIGIN}/iframe/characters/list/`
  useEffect(() => {
    const element = iframe.current
    if (!element) return
    let alive = true
    let connected = false
    const source = createBridgeSheetSource({
      iframe: element,
      allowedOrigins: [LSS_ORIGIN],
      targetOrigin: LSS_ORIGIN,
    })
    const timer = setTimeout(() => {
      if (!connected && alive)
        setStatus(
          "Нет связи с листом. Войдите в LSS; если встраивание запрещено, используйте официальный лист Owlbear по инструкции ниже.",
        )
    }, 12000)
    source.onEvent(event => {
      // The SDK validates the transport envelope, not every payload field.
      if (
        !event ||
        typeof event !== "object" ||
        typeof event.type !== "string" ||
        !event.payload ||
        typeof event.payload !== "object"
      )
        return
      if (event.type === "lss:roll" && !parseLssRoll(event)) return
      if (
        event.type === "dnd:health" &&
        (typeof event.payload.characterId !== "string" ||
          !Number.isFinite(event.payload.current) ||
          !Number.isFinite(event.payload.max) ||
          event.payload.current < 0 ||
          event.payload.max < 1 ||
          event.payload.max > 1_000_000)
      )
        return
      connected = true
      setStatus("Лист подключён · инициатива и ХП принимаются, пока он открыт")
      if (event.type === "lss:roll" || event.type === "dnd:health")
        setCharacterId(event.payload.characterId)
      const current = store.getSnapshot()
      const token = current.items.find(token => token.id === item.id)
      if (!token || current.sceneKey !== snapshot.sceneKey) return
      const currentProfile = current.tokenProfiles[item.id] ?? readTokenProfile(token)
      if (event.type === "lss:roll") {
        void OBR.broadcast
          .sendMessage(LSS_RELAY_CHANNEL, event, { destination: "ALL" })
          .catch(cause => {
            if (alive) setError(String(cause instanceof Error ? cause.message : cause))
          })
      }
      if (
        event.type === "dnd:health" &&
        currentProfile.lss?.sync &&
        currentProfile.lss.characterId === event.payload.characterId
      ) {
        const { current: hp, max: maxHp } = event.payload
        if (
          (currentProfile.hp !== hp || currentProfile.maxHp !== maxHp) &&
          Number.isFinite(hp) &&
          hp >= 0 &&
          Number.isFinite(maxHp) &&
          maxHp >= 1 &&
          maxHp <= 1_000_000
        )
          void store
            .saveTokenProfile(item.id, { hp: Math.min(hp, maxHp), maxHp })
            .catch(cause => {
              if (alive) setError(String(cause instanceof Error ? cause.message : cause))
            })
      }
    })
    return () => {
      alive = false
      clearTimeout(timer)
      source.dispose()
    }
  }, [item.id, snapshot.sceneKey, src])
  const bind = async () => {
    const next = normalizeLssLink(characterId)
    if (!next) return
    try {
      await store.saveTokenProfile(item.id, { lss: next })
      setError("")
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }
  return (
    <section className="lss-sheet" aria-label={`Лист LSS ${item.name}`}>
      <div className="section-title">
        <h2>LSS · {profile.name}</h2>
        <button onClick={onClose}>Закрыть лист</button>
      </div>
      <p role="status">{status}</p>
      <p>
        Встроенный лист доступен, если LSS разрешил адрес этого расширения. КЗ вводится на
        токене; изменения ХП из REcombat обратно в лист не отправляются.
      </p>
      {characterId && characterId !== link?.characterId && (
        <button onClick={() => void bind()}>
          Привязать открытого персонажа к токену
        </button>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <iframe
        ref={iframe}
        src={src}
        sandbox={SHEET_IFRAME_SANDBOX}
        allow="clipboard-write"
        title="Лист персонажа Long Story Short"
      />
    </section>
  )
}
