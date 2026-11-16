import { useEffect, useRef, useState } from "react"
import OBR from "@owlbear-rodeo/sdk"
import { SHEET_IFRAME_SANDBOX } from "@longstoryshort/vtt-sdk"
import { useVortexRoom } from "./useVortexRoom"
import {
  VORTEX_BRIDGE_SOURCE,
  VORTEX_ORIGIN,
  VORTEX_PICKER_URL,
  VORTEX_ROOM_METADATA_KEY,
  parseVortexHostMessage,
  vortexRoomUrl,
} from "./vortex"

/** Based on the official LSS bridge; the shared binding remains GM-controlled. */
export function VortexPanel() {
  const { url, loading } = useVortexRoom()
  const frame = useRef<HTMLIFrameElement>(null)
  const [isGM, setIsGM] = useState(false)
  const [error, setError] = useState("")
  const [notFound, setNotFound] = useState(false)
  const [height, setHeight] = useState(560)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    let active = true
    void Promise.resolve()
      .then(() => OBR.player?.getRole?.())
      .then(role => {
        if (active) setIsGM(role === "GM")
      })
      .catch(() => {})
    const stop = OBR.player?.onChange?.(player => setIsGM(player.role === "GM"))
    return () => {
      active = false
      stop?.()
    }
  }, [])

  useEffect(() => {
    setNotFound(false)
    setError("")
    setPending(false)
    let active = true
    let writing = false
    const receive = (event: MessageEvent<unknown>) => {
      if (
        event.origin !== VORTEX_ORIGIN ||
        !frame.current?.contentWindow ||
        event.source !== frame.current.contentWindow
      )
        return
      const message = parseVortexHostMessage(event.data)
      if (!message) return
      if (message.type === "vortex:windowResize") {
        setHeight(Math.max(360, Math.min(900, Math.round(message.height))))
        return
      }
      if (message.type === "vortex:roomNotFound") {
        setNotFound(true)
        return
      }
      // Only a selection emitted by this panel may change the official binding.
      // Loading an already-linked room never writes room metadata.
      const selectedUrl = vortexRoomUrl({ [VORTEX_ROOM_METADATA_KEY]: message.roomId })
      if (selectedUrl === url || writing) return
      const selectionFrame = frame.current.contentWindow
      writing = true
      setPending(true)
      void (async () => {
        if ((await OBR.player?.getRole?.()) !== "GM") return
        if (!active || frame.current?.contentWindow !== selectionFrame) return
        if (typeof OBR.room?.setMetadata !== "function")
          throw new Error("Комната Owlbear недоступна. Откройте Vortex в комнате стола.")
        await OBR.room.setMetadata({ [VORTEX_ROOM_METADATA_KEY]: message.roomId })
      })()
        .catch(cause => {
          if (active)
            setError(
              cause instanceof Error ? cause.message : "Не удалось выбрать комнату.",
            )
        })
        .finally(() => {
          writing = false
          if (active) setPending(false)
        })
    }
    window.addEventListener("message", receive)
    return () => {
      active = false
      window.removeEventListener("message", receive)
    }
  }, [url])

  const chooseAnother = async () => {
    setPending(true)
    setError("")
    try {
      if ((await OBR.player?.getRole?.()) !== "GM")
        throw new Error("Выбрать комнату для всего стола может ведущий.")
      if (typeof OBR.room?.setMetadata !== "function")
        throw new Error("Комната Owlbear недоступна.")
      await OBR.room.setMetadata({ [VORTEX_ROOM_METADATA_KEY]: undefined })
      setNotFound(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось изменить комнату.")
    } finally {
      setPending(false)
    }
  }

  return (
    <section className="lss-sheet vortex-panel" aria-label="Комната Vortex">
      <div className="section-title">
        <h2>Vortex · группа и броски</h2>
      </div>
      <p role="status">
        {loading
          ? "Проверяем комнату Owlbear…"
          : url
            ? "Выбрана общая комната Vortex этого стола."
            : isGM
              ? "Выберите свою комнату Vortex в панели ниже."
              : "Комнату Vortex для стола выбирает ведущий."}
      </p>
      <p>
        Здесь доступны карточки группы и журнал бросков LSS. ХП и КЗ из Vortex на токены
        автоматически не передаются; инициатива принимается из связанного листа LSS.
      </p>
      <p>
        Если встроенная панель недоступна, откройте Vortex в отдельной вкладке. Доступ к
        комнате и разрешение встраивания определяет LSS.
      </p>
      <div className="lss-links">
        <a href={url ?? VORTEX_ORIGIN} target="_blank" rel="noreferrer">
          Открыть Vortex в отдельной вкладке ↗
        </a>
        <a href={VORTEX_BRIDGE_SOURCE} target="_blank" rel="noreferrer">
          На основе официального моста LSS ↗
        </a>
      </div>
      {notFound && (
        <p className="error" role="alert">
          Комната не найдена или недоступна этому аккаунту LSS. Войдите под нужным
          аккаунтом; ведущий может выбрать другую комнату.
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {isGM && url && (
        <button type="button" disabled={pending} onClick={() => void chooseAnother()}>
          Выбрать другую комнату Vortex
        </button>
      )}
      {!loading && (
        <iframe
          ref={frame}
          src={url ?? VORTEX_PICKER_URL}
          sandbox={SHEET_IFRAME_SANDBOX}
          allow="clipboard-write"
          title="Официальная комната Vortex Long Story Short"
          style={{ height }}
        />
      )}
    </section>
  )
}
