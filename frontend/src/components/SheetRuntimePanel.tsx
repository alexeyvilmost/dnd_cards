import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { X } from 'lucide-react';
import { charactersV3Api } from '../character/api';
import type { AssembledCharacter } from '../character/assemble';
import { buildCharacterContext, alignRuntimeHp, forgeToRuntimeState } from '../character/runtime';
import {
  buildResourceRuntimePatch,
  hpNeedsSync,
  resourcesNeedSync,
} from '../character/resourceInit';
import type { ForgeCharacter } from '../character/types';
import type { CharacterRuleState } from '../character/rules/types';
import { buildResourceRecharge } from '../engine/resources';
import { collectFreeuseRecharge, isFreeusePoolKey } from '../engine/freeuse';
import { expiryLabel, removeActiveEffect } from '../engine/effects';
import FreeuseSpellsRow from './FreeuseSpellsRow';
import type { EngineEvent, RuntimeState } from '../mvp/contracts';
import { findResource, useResourceOptions } from '../utils/resources';
import type { ResourceOption } from '../utils/resources';
import SheetRestButtons from './SheetRestButtons';

interface Props {
  character: ForgeCharacter;
  assembled: AssembledCharacter;
  ruleState: CharacterRuleState;
  onUpdated: (c: ForgeCharacter) => void;
  onEvents?: (events: EngineEvent[]) => void;
}

const RESOURCE_LABELS: Record<string, string> = {
  action: 'Действие',
  bonus_action: 'Бонус',
  reaction: 'Реакция',
  second_wind: 'Второе дыхание',
  heroic_inspiration: 'Вдохновение',
};

// Каталог /charges/ пуст (см. utils/resources.ts) — такие пути считаем отсутствием картинки.
const usableImageUrl = (url?: string): string | undefined =>
  url && !url.startsWith('/charges/') ? url : undefined;

/* ==== BG3-плитки ресурсов ==== */

type GlyphKind = 'action' | 'bonus_action' | 'reaction';

// Ресурсы стоимости хода — встроенные SVG-глифы в стиле BG3.
const GLYPH_KEYS: Record<string, GlyphKind> = {
  action: 'action',
  main_action: 'action',
  bonus_action: 'bonus_action',
  reaction: 'reaction',
};

const GLYPH_ORDER: Record<GlyphKind, number> = { action: 1, bonus_action: 2, reaction: 3 };

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'];

const spellSlotLevel = (key: string): number | null => {
  const m = /^spell_slot_([1-9])$/.exec(key);
  return m ? Number(m[1]) : null;
};

// warlock_spell_slot и warlock_spell_slot_N; 0 — без указания круга.
const warlockSlotLevel = (key: string): number | null => {
  const m = /^warlock_spell_slot(?:_([1-9]))?$/.exec(key);
  return m ? (m[1] ? Number(m[1]) : 0) : null;
};

const monogram = (label: string): string => {
  const words = label.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  if (words.length === 1) return words[0].slice(0, 2);
  return (words[0][0] + words[1][0]).toUpperCase();
};

// Порядок плиток как в BG3: действие/бонус/реакция → ячейки → прочие ресурсы.
function tileOrder(key: string, options: ResourceOption[]): number {
  const glyph = GLYPH_KEYS[key];
  if (glyph) return GLYPH_ORDER[glyph];
  const slot = spellSlotLevel(key);
  if (slot != null) return 100 + slot;
  const warlock = warlockSlotLevel(key);
  if (warlock != null) return 150 + warlock;
  return 1000 + Math.min(findResource(options, key)?.sortOrder ?? 8999, 8999);
}

function ResourceGlyph({ kind, spent }: { kind: GlyphKind; spent: boolean }) {
  const cls = `res-tile-glyph${spent ? ' res-tile-glyph--dim' : ''}`;
  if (kind === 'action') {
    return (
      <svg className={cls} viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="8" fill="#4f9e38" stroke="#9ade6f" strokeWidth="1.6" />
        <circle cx="12" cy="12" r="4.5" fill="#7cc757" opacity="0.55" />
      </svg>
    );
  }
  if (kind === 'bonus_action') {
    return (
      <svg className={cls} viewBox="0 0 24 24" aria-hidden="true">
        <polygon points="12,3.5 21,19.5 3,19.5" fill="#d98a2b" stroke="#f4bf6a" strokeWidth="1.6" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg className={cls} viewBox="0 0 24 24" aria-hidden="true">
      <polygon points="12,3 21,12 12,21 3,12" fill="#8a79d6" stroke="#c2b6f2" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

interface ResTileProps {
  resKey: string;
  option?: ResourceOption;
  current: number;
  max: number;
}

function ResTile({ resKey, option, current, max }: ResTileProps) {
  // Пути картинок, которые не загрузились, — падаем на следующий вариант иконки.
  const [failed, setFailed] = useState<Record<string, boolean>>({});
  const markFailed = (src: string) => setFailed((f) => ({ ...f, [src]: true }));

  const spent = current <= 0;
  const slotLevel = spellSlotLevel(resKey);
  const warlockLevel = warlockSlotLevel(resKey);

  const label = option?.label
    || (slotLevel != null ? `Ячейка ${slotLevel}-го круга` : undefined)
    || (warlockLevel != null ? 'Ячейка колдуна' : undefined)
    || RESOURCE_LABELS[resKey]
    || resKey;
  const title = `${current}/${max} ${label}${option?.description ? `\n${option.description}` : ''}`;

  const customUrl = usableImageUrl(option?.imageUrl);
  const spentUrl = usableImageUrl(option?.imageUrlSpent);
  const glyphKind = GLYPH_KEYS[resKey];
  const builtinUrl = slotLevel != null
    ? '/icons/resources/spell_slot.png'
    : warlockLevel != null
      ? '/icons/resources/warlock_spell_slot.png'
      : undefined;

  let icon: ReactElement;
  if (customUrl && !failed[customUrl]) {
    // Кастомная картинка из справочника; потраченное состояние — image_url_spent, иначе CSS-фильтр.
    const useSpentImg = spent && !!spentUrl && !failed[spentUrl];
    const src = useSpentImg && spentUrl ? spentUrl : customUrl;
    icon = (
      <img
        src={src}
        alt=""
        className={`res-tile-icon${spent && !useSpentImg ? ' res-tile-icon--dim' : ''}`}
        onError={() => markFailed(src)}
      />
    );
  } else if (glyphKind) {
    icon = <ResourceGlyph kind={glyphKind} spent={spent} />;
  } else if (builtinUrl && !failed[builtinUrl]) {
    icon = (
      <img
        src={builtinUrl}
        alt=""
        className={`res-tile-icon${spent ? ' res-tile-icon--dim' : ''}`}
        onError={() => markFailed(builtinUrl)}
      />
    );
  } else {
    icon = <span className={`res-tile-mono${spent ? ' res-tile-mono--dim' : ''}`}>{monogram(label)}</span>;
  }

  const cornerLevel = slotLevel ?? (warlockLevel && warlockLevel > 0 ? warlockLevel : null);

  return (
    <span className={`res-tile${spent ? ' res-tile--spent' : ''}`} title={title}>
      {icon}
      {cornerLevel != null && <span className="res-tile-corner">{ROMAN[cornerLevel - 1]}</span>}
      {max > 1 && current !== 1 && <span className="res-tile-count">{current}</span>}
    </span>
  );
}

export default function SheetRuntimePanel({ character, assembled, ruleState, onUpdated, onEvents }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const syncAttempted = useRef(false);
  const resourceOptions = useResourceOptions();

  const resourceRecharge = useMemo(
    () => ({
      ...buildResourceRecharge((assembled.klass?.resources ?? null) as Record<string, unknown> | null),
      ...collectFreeuseRecharge(ruleState.freeuseSpells),
    }),
    [assembled.klass?.resources, ruleState.freeuseSpells],
  );

  const ctx = useMemo(
    () => ({
      ...buildCharacterContext(
        ruleState,
        { level: character.level, abilities: character.abilities ?? {} },
        [],
        assembled.klass,
      ),
      resourceRecharge,
    }),
    [ruleState, character.level, character.abilities, assembled.klass, resourceRecharge],
  );

  const runtime = useMemo(
    () => alignRuntimeHp(forgeToRuntimeState(character), ruleState.maxHP),
    [character, ruleState.maxHP],
  );

  function persistPayload(state: RuntimeState) {
    return {
      current_hp: state.hp.current,
      max_hp: state.hp.max,
      resources: state.resources,
      max_resources: state.maxResources,
      active_effects: state.activeEffects,
      turn_state: { ...(character.turn_state ?? {}), temp_hp: state.hp.temp },
    };
  }

  const apply = useCallback(async (next: RuntimeState, events: EngineEvent[]) => {
    setBusy(true);
    setError(null);
    try {
      const updated = await charactersV3Api.patchRuntime(character.id, persistPayload(next));
      onUpdated(updated);
      onEvents?.(events);
    } catch (e) {
      console.error(e);
      setError('Не удалось сохранить состояние');
    } finally {
      setBusy(false);
    }
  }, [character.id, onUpdated, onEvents]);

  const syncResources = useCallback(async (force = false) => {
    const patch = buildResourceRuntimePatch(character, ctx, assembled, force, ruleState.maxHP, ruleState.freeuseSpells);
    if (!patch) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await charactersV3Api.patchRuntime(character.id, patch);
      onUpdated(updated);
    } catch (e) {
      console.error(e);
      setError('Не удалось синхронизировать ресурсы');
    } finally {
      setBusy(false);
    }
  }, [character, ctx, assembled, onUpdated, ruleState.maxHP]);

  useEffect(() => {
    if (syncAttempted.current || (!resourcesNeedSync(character) && !hpNeedsSync(character, ruleState.maxHP))) return;
    syncAttempted.current = true;
    syncResources();
  }, [character, ruleState.maxHP, syncResources]);

  // Скрываем пустые пулы, счётчики использований действий (uses_*) и пулы freeuse
  // (freeuse-<spell>, рисуются витриной FreeuseSpellsRow; freeuse-spells не пул).
  const resourceKeys = useMemo(
    () => Object.keys(runtime.maxResources)
      .filter((k) => runtime.maxResources[k] > 0 && !k.startsWith('uses_') && !isFreeusePoolKey(k))
      .sort((a, b) => tileOrder(a, resourceOptions) - tileOrder(b, resourceOptions) || a.localeCompare(b)),
    [runtime.maxResources, resourceOptions],
  );

  const handleDismissEffect = (effectId: string) => {
    const { state, events } = removeActiveEffect(runtime, effectId);
    apply(state, events);
  };

  return (
    <section className="sheet-panel">
      <h2 className="sheet-h2">Ресурсы и отдых</h2>
      {error && <p className="issues">{error}</p>}

      <div className="res-tile-row">
        {resourceKeys.map((key) => (
          <ResTile
            key={key}
            resKey={key}
            option={findResource(resourceOptions, key)}
            current={runtime.resources[key] ?? 0}
            max={runtime.maxResources[key]}
          />
        ))}
        {!resourceKeys.length && (
          <p className="forge-note">
            Ресурсы не инициализированы.{' '}
            <button type="button" className="sheet-link-btn" disabled={busy} onClick={() => syncResources(true)}>
              Синхронизировать
            </button>
          </p>
        )}
      </div>

      <FreeuseSpellsRow
        runtime={runtime}
        freeuseSpells={ruleState.freeuseSpells}
        spells={assembled.spells}
        resourceOptions={resourceOptions}
      />

      <SheetRestButtons
        character={character}
        assembled={assembled}
        ruleState={ruleState}
        onUpdated={onUpdated}
        onEvents={onEvents}
      />

      {runtime.activeEffects.length > 0 && (
        <div className="sheet-group" style={{ marginTop: 12 }}>
          <h3 className="sheet-h3">Активные эффекты</h3>
          <ul className="sheet-active-effects">
            {runtime.activeEffects.map((fx) => (
              <li key={fx.id} className="sheet-active-effect">
                <span className="sheet-active-effect-name">{fx.name}</span>
                <span className="sheet-active-effect-meta">{expiryLabel(fx.expiry)}</span>
                <button
                  type="button"
                  className="sheet-active-effect-dismiss"
                  disabled={busy}
                  title="Снять вручную"
                  onClick={() => handleDismissEffect(fx.id)}
                >
                  <X size={14} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="forge-note" style={{ marginTop: 8 }}>
        Короткий отдых: +50% от максимума HP и восстановление зарядов умений с recharge «короткий отдых». Длинный отдых: полное HP и все ресурсы.
      </p>
    </section>
  );
}
