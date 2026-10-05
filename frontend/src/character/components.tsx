export { ChoiceResolver } from './ChoiceResolver';
export { optionsForChoice, choiceOptionIdByReference, featForChoiceOption } from './choiceOptions';
export type { ChoiceOption } from './choiceOptions';
import { useEffect, useRef, type ReactNode } from 'react';
import { labelOf, SKILLS } from '../mechanics/registries';
import { requiresInitialCharacterChoice, type PendingChoice } from '../mechanics/collectChoices';
import type { AssembledCharacter } from './assemble';
import { effectAbilityPresentation } from './abilityDisplay';
import type { CharacterRuleState } from './rules/types';
import {
  ABILITY_KEYS, ABILITY_LABEL_RU,
  type AbilityBonuses, type AbilityGenMethod, type AbilityKey, type CharacterDraft,
} from './types';
import type { Spell } from '../types';
import { abilityMod } from './derive';
import {
  POINT_BUY_BUDGET, POINT_BUY_MAX, POINT_BUY_MIN,
  baseOf, bonusOf, pointCost, pointsRemaining, reapplyBonuses,
} from './pointBuy';
import NavRail from '../components/NavRail';
import ForgeEntityIcon from '../components/forge/ForgeEntityIcon';
import ForgeAbilityLine from '../components/forge/ForgeAbilityLine';
import ForgeSpellIconGrid from '../components/forge/ForgeSpellIconGrid';

// ─── Левая навигация ─────────────────────────────────────────────────────────

export type ForgeSectionDef = {
  id: string;
  label: string;
  icon: ReactNode;
  sub?: string; // подпись (напр. выбранное значение)
  status?: 'ok' | 'todo' | null;
};

export function ForgeNav({
  sections, active, onSelect,
}: { sections: ForgeSectionDef[]; active: string; onSelect: (id: string) => void }) {
  // Сквозной навигационный примитив (десктоп — вертикальный рейл, ≤820px — нижний
  // таб-бар). Единый язык с листом персонажа, конструкторами и библиотекой.
  return (
    <NavRail
      className="forge-rail"
      items={sections}
      active={active}
      onSelect={onSelect}
      layout="wide"
      variant="dark"
      mobileDock="bottom"
      ariaLabel="Этапы создания персонажа"
    />
  );
}

// ─── Карточка выбора сущности ────────────────────────────────────────────────

export function EntityChoiceCard({
  name, subtitle, selected, onClick,
}: { name: string; subtitle?: string; selected: boolean; onClick: () => void }) {
  return (
    <button type="button" className={`entity-card ${selected ? 'selected' : ''}`} onClick={onClick}>
      <span className="ec-name">{name}</span>
      {subtitle && <span className="ec-sub">{subtitle}</span>}
    </button>
  );
}

// ─── Разрешение выбора из механики ───────────────────────────────────────────

// filter из механики choice(source:"feat") → категория черты в реестре.
/**
 * Чистое ядро авто-рекомендаций: какие выборы предзаполнить рекомендованными вариантами.
 * Возвращает карту `choiceId → рекомендованные ID` (не больше `count`). Пропускает:
 *  • выборы контекста in_play (разрешаются диалогом в момент действия);
 *  • уже применённые в этой сессии (`applied`) — очистка выбора игроком не должна
 *    триггерить повторное авто-заполнение;
 *  • уже затронутые (ключ есть в `resolved`, даже если массив пуст) — выбор игрока не перетираем.
 */
export function recommendedChoiceSeed(
  choices: PendingChoice[],
  resolved: Record<string, string[]>,
  applied: ReadonlySet<string>,
  policy: RecommendedChoiceSeedPolicy = {},
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const projectedResolved = { ...resolved };
  for (const pc of choices) {
    if (!requiresInitialCharacterChoice(pc) || applied.has(pc.id)) continue;
    // Presence, not length, is the durable "touched" signal. An explicitly
    // cleared choice must stay cleared after a remount or draft restore.
    if (Object.prototype.hasOwnProperty.call(resolved, pc.id)) continue;
    const rawRecommended = pc.recommended ?? [];
    if (!rawRecommended.length) continue;
    const recommended = policy.canonicalOptionId
      ? rawRecommended.flatMap((reference) => {
          const optionId = policy.canonicalOptionId?.(pc, reference);
          return optionId ? [optionId] : [];
        })
      : rawRecommended;
    const optionIds = policy.optionIds?.(pc) ?? recommended;
    const selection = recommendedOptionSelection({
      count: pc.count,
      recommended,
      optionIds,
      unavailable: (candidate, selected) => Boolean(policy.unavailableOptions?.({
        choice: pc,
        optionIds,
        selectedOptionIds: selected,
        resolvedChoices: projectedResolved,
      })[candidate]),
    });
    // Persist even an empty/partial legal result. That records that this
    // recommendation was considered once, while the normal completion gate
    // still asks the player to finish a genuinely under-specified choice.
    out[pc.id] = selection;
    projectedResolved[pc.id] = selection;
  }
  return out;
}

export interface RecommendedChoiceAvailabilityInput {
  choice: PendingChoice;
  optionIds: readonly string[];
  selectedOptionIds: readonly string[];
  /** Existing choices plus earlier recommendations from this atomic seed. */
  resolvedChoices: Readonly<Record<string, string[]>>;
}

export interface RecommendedChoiceSeedPolicy {
  /** Complete, ordered option domain declared by the choice UI. */
  optionIds?: (choice: PendingChoice) => readonly string[];
  /** Resolve aliases in recommendation metadata to persisted option ids. */
  canonicalOptionId?: (choice: PendingChoice, reference: string) => string | undefined;
  /** The same generic grant-conflict projection used to disable manual picks. */
  unavailableOptions?: (
    input: RecommendedChoiceAvailabilityInput,
  ) => Readonly<Record<string, string>>;
}

/**
 * Pick recommendations first, then fill missing slots from the declared option
 * order. Legality is caller-projected from mechanics; names and entity IDs are
 * never interpreted here.
 */
export function recommendedOptionSelection(input: {
  count: number;
  recommended: readonly string[];
  optionIds: readonly string[];
  unavailable?: (candidate: string, selected: readonly string[]) => boolean;
}): string[] {
  const count = Math.max(0, Math.floor(input.count));
  if (!count) return [];
  const domain = new Set(input.optionIds);
  const ordered = [...new Set([...input.recommended, ...input.optionIds])]
    .filter((candidate) => domain.has(candidate));
  const selected: string[] = [];
  for (const candidate of ordered) {
    if (selected.length >= count) break;
    if (input.unavailable?.(candidate, selected)) continue;
    selected.push(candidate);
  }
  return selected;
}

/**
 * Авто-выбор рекомендованных вариантов. Для каждого невыбранного choice с непустым
 * `recommended` один раз проставляет рекомендованные ID в resolved — снижает порог входа
 * новичкам: рекомендованные заклинания/эффекты уже отмечены, но их можно изменить.
 * Каждый выбор обрабатывается единожды (ref): даже если игрок очистит выбор, авто-
 * заполнение не повторится.
 */
export function useAutoRecommendedChoices(
  choices: PendingChoice[],
  resolved: Record<string, string[]>,
  setResolved: (id: string, vals: string[]) => void,
  setResolvedBatch?: (values: Record<string, string[]>) => void,
  policy?: RecommendedChoiceSeedPolicy,
): void {
  const applied = useRef<Set<string>>(new Set());
  useEffect(() => {
    const seed = recommendedChoiceSeed(choices, resolved, applied.current, policy);
    for (const pc of choices) {
      if (requiresInitialCharacterChoice(pc)) applied.current.add(pc.id);
    }
    if (!Object.keys(seed).length) return;
    if (setResolvedBatch) setResolvedBatch(seed);
    else for (const [id, vals] of Object.entries(seed)) setResolved(id, vals);
  }, [choices, resolved, setResolved, setResolvedBatch, policy]);
}

// ─── Раскладка характеристик ─────────────────────────────────────────────────

const fmtMod = (v: number) => (v >= 0 ? `+${v}` : `${v}`);

export function AbilityAssigner({
  abilities, method, bonuses, backgroundName, backgroundAbilities,
  recommended, onSet, onSetAll, onMethodChange, onBonusesChange,
}: {
  /** Итоговые значения (база + бонус предыстории). */
  abilities: Partial<Record<AbilityKey, number>>;
  method: AbilityGenMethod;
  bonuses: AbilityBonuses;
  backgroundName?: string;
  /** Характеристики предыстории (пусто = предыстория не выбрана). */
  backgroundAbilities: AbilityKey[];
  /** Оптимальный расклад класса ({} если у класса не задан). */
  recommended: Partial<Record<AbilityKey, number>>;
  onSet: (key: AbilityKey, value: number | undefined) => void;
  onSetAll: (abilities: Partial<Record<AbilityKey, number>>) => void;
  onMethodChange: (m: AbilityGenMethod) => void;
  onBonusesChange: (b: AbilityBonuses) => void;
}) {
  const pointBuy = method === 'point_buy';
  const remaining = pointsRemaining(abilities, bonuses);

  const setBase = (k: AbilityKey, base: number) => {
    const clamped = Math.min(POINT_BUY_MAX, Math.max(POINT_BUY_MIN, base));
    onSet(k, clamped + bonusOf(bonuses, k));
  };

  const applyRecommended = () => {
    const next: Partial<Record<AbilityKey, number>> = {};
    for (const k of ABILITY_KEYS) {
      const base = recommended[k] ?? POINT_BUY_MIN;
      next[k] = base + bonusOf(bonuses, k);
    }
    onSetAll(next);
  };

  const resetBases = () => {
    const next: Partial<Record<AbilityKey, number>> = {};
    for (const k of ABILITY_KEYS) next[k] = POINT_BUY_MIN + bonusOf(bonuses, k);
    onSetAll(next);
  };

  const changeBonuses = (next: AbilityBonuses) => {
    onBonusesChange(next);
    onSetAll(reapplyBonuses(abilities, bonuses, next));
  };

  const allowedBonusAbilities: AbilityKey[] = bonuses.anyAbilities || !backgroundAbilities.length
    ? ABILITY_KEYS
    : backgroundAbilities;

  /** Клик по чипу бонуса: two_one цикл — нет → +2 → +1 → нет; one_one_one — toggle +1 (макс 3). */
  const cycleBonus = (k: AbilityKey) => {
    const a = { ...bonuses.assignments };
    const cur = a[k] ?? 0;
    if (bonuses.mode === 'two_one') {
      const hasTwo = Object.entries(a).some(([key, v]) => key !== k && v === 2);
      const hasOne = Object.entries(a).some(([key, v]) => key !== k && v === 1);
      if (cur === 0) a[k] = hasTwo ? (hasOne ? 0 : 1) : 2;
      else if (cur === 2) a[k] = hasOne ? 0 : 1;
      else delete a[k];
      if (a[k] === 0) delete a[k];
    } else {
      if (cur) delete a[k];
      else if (Object.values(a).filter(Boolean).length < 3) a[k] = 1;
    }
    changeBonuses({ ...bonuses, assignments: a });
  };

  const switchMode = (mode: AbilityBonuses['mode']) => {
    if (mode === bonuses.mode) return;
    changeBonuses({ ...bonuses, mode, assignments: {} });
  };

  return (
    <div>
      <div className="chips" style={{ marginBottom: 10 }}>
        <button type="button" className={`chip ${pointBuy ? 'on' : ''}`} onClick={() => onMethodChange('point_buy')}>
          Point-buy ({POINT_BUY_BUDGET} очков)
        </button>
        <button type="button" className={`chip ${!pointBuy ? 'on' : ''}`} onClick={() => onMethodChange('manual')}>
          Ручной ввод
        </button>
      </div>

      {pointBuy && (
        <>
          <div className="forge-note" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <span>
              Осталось очков: <b className={remaining < 0 ? 'pb-over' : ''}>{remaining}</b> из {POINT_BUY_BUDGET}
            </span>
            <button type="button" className="chip rec" onClick={applyRecommended}
              disabled={!Object.keys(recommended).length}
              aria-description={Object.keys(recommended).length ? 'Заполнить оптимальным раскладом класса' : 'Сначала выберите класс'}>
              Оптимально для класса
            </button>
            <button type="button" className="chip" onClick={resetBases}>Сбросить (все 8)</button>
          </div>

          {ABILITY_KEYS.map((k) => {
            const base = baseOf(abilities, bonuses, k);
            const bonus = bonusOf(bonuses, k);
            const final = abilities[k];
            const cost = typeof base === 'number' ? pointCost(base) : undefined;
            return (
              <div key={k} className="ab-row">
                <span className="name">{ABILITY_LABEL_RU[k]}</span>
                <span className="pb-ctrl">
                  <button type="button" className="pb-btn" disabled={(base ?? POINT_BUY_MIN) <= POINT_BUY_MIN}
                    onClick={() => setBase(k, (base ?? POINT_BUY_MIN) - 1)}>−</button>
                  <span className="pb-base">{typeof base === 'number' ? base : '—'}</span>
                  <button type="button" className="pb-btn"
                    disabled={(base ?? POINT_BUY_MIN) >= POINT_BUY_MAX
                      || (typeof base === 'number' && (pointCost(base + 1) ?? 99) - (cost ?? 0) > remaining)}
                    onClick={() => setBase(k, (base ?? POINT_BUY_MIN - 1) + 1)}>+</button>
                </span>
                {bonus > 0 && <span className="pb-bonus">+{bonus}</span>}
                <span className="pb-final">{typeof final === 'number' ? final : ''}</span>
                <span className="mod">{typeof final === 'number' ? fmtMod(abilityMod(final)) : ''}</span>
              </div>
            );
          })}
        </>
      )}

      {!pointBuy && ABILITY_KEYS.map((k) => {
        const cur = abilities[k];
        return (
          <div key={k} className="ab-row">
            <span className="name">{ABILITY_LABEL_RU[k]}</span>
            <input
              type="number" min={1} max={30}
              value={typeof cur === 'number' ? cur : ''}
              onChange={(e) => onSet(k, e.target.value === '' ? undefined : parseInt(e.target.value, 10))}
              style={{ width: 80 }}
            />
            <span className="mod">{typeof cur === 'number' ? fmtMod(abilityMod(cur)) : ''}</span>
          </div>
        );
      })}

      <div className="choice-box" style={{ marginTop: 14 }}>
        <div className="choice-title">
          Бонусы предыстории{backgroundName ? ` · ${backgroundName}` : ''}
        </div>
        <div className="chips" style={{ marginBottom: 6 }}>
          <button type="button" className={`chip ${bonuses.mode === 'two_one' ? 'on' : ''}`}
            onClick={() => switchMode('two_one')}>+2 / +1</button>
          <button type="button" className={`chip ${bonuses.mode === 'one_one_one' ? 'on' : ''}`}
            onClick={() => switchMode('one_one_one')}>+1 / +1 / +1</button>
        </div>
        <div className="chips">
          {allowedBonusAbilities.map((k) => {
            const v = bonuses.assignments[k] ?? 0;
            return (
              <button key={k} type="button" className={`chip ${v ? 'on' : ''}`} onClick={() => cycleBonus(k)}>
                {ABILITY_LABEL_RU[k]}{v ? ` +${v}` : ''}
              </button>
            );
          })}
        </div>
        <label className="forge-note" style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
          <input
            type="checkbox"
            checked={bonuses.anyAbilities}
            onChange={(e) => changeBonuses({ ...bonuses, anyAbilities: e.target.checked, assignments: {} })}
          />
          Разрешить любые характеристики (не только предыстории)
        </label>
      </div>
    </div>
  );
}

// ─── Живая сводка «Основное» ─────────────────────────────────────────────────

const skillLabel = (id: string) => labelOf(SKILLS, id);

export function SummaryPanel({
  draft, assembled, spells, lineageName: lineageNameProp, ruleState,
}: {
  draft: CharacterDraft;
  assembled: AssembledCharacter | null;
  spells: Spell[];
  lineageName?: string;
  /** Итоговые правила (с числовыми модификаторами эффектов) — приоритетны над derived. */
  ruleState?: CharacterRuleState;
}) {
  const race = assembled?.race;
  const klass = assembled?.klass;
  const background = assembled?.background;
  const feats = assembled?.feats || [];
  const lineageName = lineageNameProp
    ?? race?.lineages?.find(
      (l) => l.name === draft.lineageId || (l as { id?: string }).id === draft.lineageId,
    )?.name
    ?? (draft.lineageId && !/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(draft.lineageId) ? draft.lineageId : undefined);

  const effectsByOrigin = (kind: string) => (assembled?.effects || []).filter((e) => e.origin.kind === kind);
  const actionsByOrigin = (kind: string) => (assembled?.actions || []).filter((a) => a.origin.kind === kind);

  return (
    <div>
      <div className="sum-field">
        <span className="sum-label">Имя: </span>
        <span className="sum-value">{draft.name || '—'}</span>
      </div>

      <div className="sum-field">
        <span className="sum-label">Вид: </span>
        {race ? (
          <span className="sum-value-inline">
            <ForgeEntityIcon imageUrl={race.image_url} alt={race.name} />
            <span>{race.name}{lineageName ? ` · ${lineageName}` : ''}</span>
          </span>
        ) : (
          <span className="sum-value">—</span>
        )}
        {effectsByOrigin('race').map((e) => (
          <ForgeAbilityLine
            key={e.effect.id}
            name={e.effect.name}
            imageUrl={e.effect.image_url}
            fallbackImageUrl={race?.image_url}
            sourceLabel={`Способность вида · ${e.origin.name}`}
            effect={e.effect}
          />
        ))}
        {actionsByOrigin('race').map((a) => (
          <ForgeAbilityLine
            key={a.action.id}
            name={a.action.name}
            imageUrl={a.action.image_url}
            fallbackImageUrl={race?.image_url}
            sourceLabel={`Действие вида · ${a.origin.name}`}
            action={a.action}
          />
        ))}
      </div>

      <hr className="sum-divider" />

      <div className="sum-field">
        <span className="sum-label">Класс: </span>
        {klass ? (
          <span className="sum-value-inline">
            <ForgeEntityIcon imageUrl={klass.image_url} alt={klass.name} />
            <span>{klass.name}, {draft.level}</span>
          </span>
        ) : (
          <span className="sum-value">—</span>
        )}
        {effectsByOrigin('class').map((e) => (
          <ForgeAbilityLine
            key={e.effect.id}
            name={e.effect.name}
            imageUrl={e.effect.image_url}
            fallbackImageUrl={klass?.image_url}
            sourceLabel={`Способность класса · ${e.origin.name}`}
            effect={e.effect}
          />
        ))}
        {actionsByOrigin('class').map((a) => (
          <ForgeAbilityLine
            key={a.action.id}
            name={a.action.name}
            imageUrl={a.action.image_url}
            fallbackImageUrl={klass?.image_url}
            sourceLabel={`Действие класса · ${a.origin.name}`}
            action={a.action}
          />
        ))}
      </div>

      <hr className="sum-divider" />

      <div className="sum-field">
        <span className="sum-label">Предыстория: </span>
        <span className="sum-value">{background ? background.name : '—'}</span>
      </div>

      <hr className="sum-divider" />

      {feats.map((f) => {
        const featEffects = (assembled?.effects || []).filter((e) => e.origin.kind === 'feat' && e.origin.id === f.id);
        const featActions = (assembled?.actions || []).filter((a) => a.origin.kind === 'feat' && a.origin.id === f.id);
        return (
          <div key={f.id} className="sum-field">
            <span className="sum-label">Черта: </span>
            <span className="sum-value-inline">
              <ForgeEntityIcon imageUrl={f.image_url} alt={f.name} />
              <span>{f.name}</span>
            </span>
            {featEffects.map((e) => {
              const p = effectAbilityPresentation(e.effect, e.origin, [f]);
              return (
              <ForgeAbilityLine
                key={e.effect.id}
                name={p.name}
                imageUrl={e.effect.image_url}
                fallbackImageUrl={p.fallbackImageUrl ?? f.image_url}
                sourceLabel={p.sourceLabel}
                effect={p.effect}
              />
              );
            })}
            {featActions.map((a) => (
              <ForgeAbilityLine
                key={a.action.id}
                name={a.action.name}
                imageUrl={a.action.image_url}
                fallbackImageUrl={f.image_url}
                sourceLabel={`Действие черты · ${a.origin.name}`}
                action={a.action}
              />
            ))}
          </div>
        );
      })}

      <hr className="sum-divider" />

      <div className="sum-abilities">
        {ABILITY_KEYS.map((k) => {
          // Показываем ИТОГОВОЕ значение из ruleState (с приростом ASI/вида/предыстории),
          // а не базу draft; но не назначенную характеристику оставляем «—».
          const base = draft.abilities[k];
          const v = typeof base === 'number' ? (ruleState?.abilities?.[k] ?? base) : undefined;
          const m = typeof v === 'number' ? abilityMod(v) : null;
          const boosted = typeof v === 'number' && typeof base === 'number' && v !== base;
          return (
            <div key={k} className="sum-ab">
              <div className="k">{ABILITY_LABEL_RU[k].slice(0, 3).toUpperCase()}</div>
              <div className="v" aria-description={boosted ? `База ${base}` : undefined} style={boosted ? { color: 'var(--forge-gold, #c9a227)' } : undefined}>{typeof v === 'number' ? v : '—'}</div>
              <div className="m">{m === null ? '' : m >= 0 ? `+${m}` : m}</div>
            </div>
          );
        })}
      </div>

      {assembled && (
        <div className="sum-field" style={{ marginTop: 14 }}>
          <span className="sum-label" style={{ fontSize: 15 }}>HP </span>
          <span className="sum-value" style={{ fontSize: 15 }}>{ruleState?.maxHP ?? assembled.derived.maxHP}</span>
          <span className="sum-label" style={{ fontSize: 15, marginLeft: 12 }}>КД </span>
          <span className="sum-value" style={{ fontSize: 15 }}>{ruleState?.armorClass ?? assembled.derived.ac}</span>
          <span className="sum-label" style={{ fontSize: 15, marginLeft: 12 }}>Мастерство </span>
          <span className="sum-value" style={{ fontSize: 15 }}>+{ruleState?.proficiencyBonus ?? assembled.derived.proficiencyBonus}</span>
        </div>
      )}

      {(draft.classSkillChoices.length > 0 || (background?.skill_proficiencies?.length ?? 0) > 0) && (
        <div className="sum-field" style={{ marginTop: 10 }}>
          <span className="sum-label" style={{ fontSize: 15 }}>Навыки: </span>
          <span className="sum-value" style={{ fontSize: 14 }}>
            {[...new Set([...draft.classSkillChoices, ...(background?.skill_proficiencies || [])])].map(skillLabel).join(', ')}
          </span>
        </div>
      )}

      {spells.length > 0 && (
        <div className="sum-field" style={{ marginTop: 10 }}>
          <span className="sum-label" style={{ fontSize: 15, display: 'block', marginBottom: 6 }}>Заклинания</span>
          <ForgeSpellIconGrid spells={spells} className="forge-spell-icon-grid sum-spell-grid" />
        </div>
      )}
    </div>
  );
}
