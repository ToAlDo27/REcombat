import { useRef, useState, type FormEvent } from "react"
import type { Item } from "@owlbear-rodeo/sdk"
import { normalizeLssLink } from "./lss"
import { readTokenProfile, tokenProfileFromCombatant } from "./tokenData"
import type {
  Combatant,
  Settings,
  TokenInitiative,
  TokenProfile,
  TokenProfilePatch,
} from "./types"

export interface TokenEditorProps {
  item: Item
  combatant?: Combatant
  profile?: TokenProfile
  settings: Settings
  defaultFaction?: "pc" | "npc"
  disabled?: boolean
  onSave: (patch: TokenProfilePatch) => Promise<void>
  onAdd: (initiative?: TokenInitiative) => Promise<void>
  onClose: () => void
}

export default function TokenEditor({
  item,
  combatant,
  profile,
  settings,
  defaultFaction,
  disabled,
  onSave,
  onAdd,
  onClose,
}: TokenEditorProps) {
  const initial = combatant
    ? tokenProfileFromCombatant(combatant)
    : profile ?? readTokenProfile(item, defaultFaction)
  const [draft, setDraft] = useState(() => ({
    name: initial.name,
    hp: String(initial.hp),
    maxHp: String(initial.maxHp),
    ac: String(initial.ac),
    bonus: String(initial.bonus),
    initiative: initial.initiative === null ? "" : String(initial.initiative),
    faction: initial.faction,
    rollMode: (initial.rollMode ?? "") as NonNullable<TokenProfile["rollMode"]> | "",
    lssUrl: initial.lss?.url ?? "",
    lssSync: initial.lss?.sync ?? true,
  }))
  const dirty = useRef(new Set<keyof typeof draft>())
  const [initiativeMode, setInitiativeMode] = useState<TokenInitiative>(
    settings.tokenInitiative,
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const change = <K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) => {
    dirty.current.add(key)
    setDraft(current => ({ ...current, [key]: value }))
  }
  const save = async (add: boolean) => {
    setSaving(true)
    setError("")
    try {
      const patch: TokenProfilePatch = {}
      if (dirty.current.has("name")) patch.name = draft.name.trim()
      for (const key of ["hp", "maxHp", "ac", "bonus"] as const)
        if (dirty.current.has(key)) {
          if (!draft[key].trim()) throw new Error("Заполните числовые поля карточки.")
          patch[key] = Number(draft[key])
        }
      if (dirty.current.has("initiative"))
        patch.initiative = draft.initiative.trim() ? Number(draft.initiative) : null
      if (dirty.current.has("faction")) patch.faction = draft.faction
      if (dirty.current.has("rollMode")) patch.rollMode = draft.rollMode || null
      if (dirty.current.has("lssUrl") || dirty.current.has("lssSync")) {
        patch.lss = draft.lssUrl.trim()
          ? normalizeLssLink({ url: draft.lssUrl, sync: draft.lssSync })
          : null
        if (draft.lssUrl.trim() && !patch.lss)
          throw new Error("Вставьте ссылку на персонажа longstoryshort.app или его ID.")
      }
      await onSave(patch)
      if (add && !combatant) await onAdd(initiativeMode)
      onClose()
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Не удалось сохранить карточку токена.",
      )
    } finally {
      setSaving(false)
    }
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    void save(false)
  }
  return (
    <form
      className="token-editor"
      aria-label={`Карточка токена ${item.name || "Без имени"}`}
      onSubmit={submit}
    >
      <div className="section-title">
        <h3>Карточка токена</h3>
        <button
          type="button"
          className="quiet"
          onClick={onClose}
          disabled={saving}
          aria-label="Закрыть карточку токена"
        >
          ×
        </button>
      </div>
      <p className="token-editor-note">
        Сохраните параметры на токене перед добавлением в бой.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <fieldset disabled={disabled || saving}>
        <label>
          Имя токена
          <input
            required
            maxLength={200}
            value={draft.name}
            onChange={event => change("name", event.target.value)}
          />
        </label>
        <div className="settings-grid">
          {(
            [
              ["hp", "Текущие ХП", 0, 1_000_000],
              ["maxHp", "Максимальные ХП", 1, 1_000_000],
              ["ac", "Класс защиты", 0, 10000],
              ["bonus", "Бонус инициативы", -10000, 10000],
            ] as const
          ).map(([key, label, min, max]) => (
            <label key={key}>
              {label}
              <input
                required
                type="number"
                min={min}
                max={max}
                value={draft[key]}
                onChange={event => change(key, event.target.value)}
              />
            </label>
          ))}
          <label>
            Инициатива
            <input
              type="number"
              min={-1_000_000}
              max={1_000_000}
              placeholder="Не задана"
              value={draft.initiative}
              onChange={event => change("initiative", event.target.value)}
            />
          </label>
          <label>
            Сторона
            <select
              aria-label="Сторона"
              value={draft.faction}
              onChange={event => change("faction", event.target.value as "pc" | "npc")}
            >
              <option value="pc">Персонаж</option>
              <option value="npc">NPC</option>
            </select>
          </label>
          <label>
            Бросок этого токена
            <select
              aria-label="Бросок этого токена"
              value={draft.rollMode}
              onChange={event =>
                change("rollMode", event.target.value as typeof draft.rollMode)
              }
            >
              <option value="">По настройкам комнаты</option>
              <option value="normal">Обычный</option>
              <option value="advantage">Преимущество</option>
              <option value="disadvantage">Помеха</option>
            </select>
          </label>
        </div>
        <label>
          Персонаж LSS
          <input
            type="text"
            value={draft.lssUrl}
            placeholder="Ссылка longstoryshort.app или ID персонажа"
            onChange={event => change("lssUrl", event.target.value)}
          />
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={draft.lssSync}
            onChange={event => change("lssSync", event.target.checked)}
          />
          Принимать инициативу из LSS
        </label>
        {!combatant && (
          <label>
            При добавлении в бой
            <select
              aria-label="При добавлении в бой"
              value={initiativeMode}
              onChange={event => setInitiativeMode(event.target.value as TokenInitiative)}
            >
              <option value="manual">Взять инициативу из карточки</option>
              <option value="roll">Бросить инициативу</option>
              <option value="empty">Добавить без инициативы</option>
            </select>
          </label>
        )}
        <div className="token-editor-actions">
          <button type="submit" className="primary">
            {saving ? "Сохраняем…" : "Сохранить карточку"}
          </button>
          {!combatant && (
            <button type="button" onClick={() => void save(true)}>
              Сохранить и добавить в бой
            </button>
          )}
        </div>
      </fieldset>
    </form>
  )
}
