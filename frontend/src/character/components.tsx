export { ChoiceResolver } from './ChoiceResolver';
export { optionsForChoice, choiceOptionIdByReference, featForChoiceOption } from './choiceOptions';
export type { ChoiceOption } from './choiceOptions';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {useSiteSettings} from '../settings';
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
import ForgeAbilityDisplay from '../components/forge/ForgeAbilityDisplay';
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

function AbilityBaseInput({value, label, onCommit}: {value:number; label:string; onCommit:(value:number)=>boolean}) {
  const [text,setText]=useState(String(value));
  const [error,setError]=useState('');
  useEffect(()=>{setText(String(value));setError('');},[value]);
  const commit=()=>{
    const parsed=/^\d+$/.test(text.trim())?Number(text):NaN;
    if (!Number.isInteger(parsed)||parsed<POINT_BUY_MIN||parsed>POINT_BUY_MAX) {
      setText(String(value));setError('Введите число от 8 до 15.');
    } else if (!onCommit(parsed)) {
      setText(String(value));setError('Не хватает очков.');
    } else setError('');
  };
  return <span className="forge-base-input-wrap">
    <input type="text" inputMode="numeric" className="forge-base-input" aria-label={`База: ${label}`}
      aria-description="Число от 8 до 15. Нажмите, чтобы изменить." value={text}
      onFocus={e=>{setError('');e.currentTarget.select();}} onChange={e=>setText(e.target.value)} onBlur={commit}
      onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();e.currentTarget.blur();} if(e.key==='Escape'){setText(String(value));setError('');}}}/>
    {error&&<span role="status" className="forge-base-input-error">{error}</span>}
  </span>;
}

export function AbilityAssigner({
  abilities, method, bonuses, backgroundAbilities,
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

  useEffect(() => {
    if (!pointBuy || ABILITY_KEYS.every(key => typeof abilities[key] === 'number')) return;
    const initial = {...abilities};
    for (const key of ABILITY_KEYS) initial[key] ??= POINT_BUY_MIN + bonusOf(bonuses,key);
    onSetAll(initial);
  }, [pointBuy, abilities, bonuses, onSetAll]);

  const setBase = (k: AbilityKey, base: number) => {
    if (!Number.isInteger(base)||base<POINT_BUY_MIN||base>POINT_BUY_MAX) return false;
    const current=baseOf(abilities,bonuses,k)??POINT_BUY_MIN;
    if ((pointCost(base)??0)-(pointCost(current)??0)>remaining) return false;
    const next = {...abilities};
    for (const ability of ABILITY_KEYS) next[ability] ??= POINT_BUY_MIN + bonusOf(bonuses, ability);
    next[k] = base + bonusOf(bonuses, k);
    onSetAll(next);
    return true;
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

  const allowedBonusAbilities: AbilityKey[] = bonuses.anyAbilities
    ? ABILITY_KEYS
    : backgroundAbilities;
  const nextBonus=(key:AbilityKey,value:number):AbilityBonuses=>{
    const assignments = {...bonuses.assignments};
    if(assignments[key]===value) delete assignments[key];
    else assignments[key]=value;
    return {...bonuses,assignments,mode:Object.values(assignments).includes(2)?'two_one':'one_one_one'};
  };
  const bonusAvailable=(key:AbilityKey,value:number)=>{
    if (!allowedBonusAbilities.includes(key)) return false;
    const values=Object.values(nextBonus(key,value).assignments).filter(Boolean);
    const twos=values.filter(v=>v===2).length;
    const ones=values.filter(v=>v===1).length;
    return twos<=1 && ones<=(twos?1:3);
  };
  const hints: Record<AbilityKey,string> = {
    str:'Сила удара и атлетика', dex:'Ловкость, защита и инициатива', con:'Здоровье и выносливость',
    int:'Знания и рассуждение', wis:'Восприятие и интуиция', cha:'Общение и влияние',
  };
  return <div className="forge-ability-workbench">
    <div className="forge-ability-methods" role="group" aria-label="Способ распределения характеристик">
      <button type="button" className={`chip ${pointBuy?'on':''}`} aria-pressed={pointBuy} onClick={() => onMethodChange('point_buy')}>Покупка очков</button>
      <button type="button" className={`chip ${!pointBuy?'on':''}`} aria-pressed={!pointBuy} onClick={() => onMethodChange('manual')}>Ручной ввод</button>
    </div>
    {pointBuy && <>
      <div className="forge-points-budget">
        <div><small>Осталось очков</small><strong className={remaining<0?'pb-over':''} aria-live="polite">{remaining}<span> / {POINT_BUY_BUDGET}</span></strong></div>
        <div className="forge-points-budget__actions">
          <button type="button" className="chip rec" onClick={applyRecommended} disabled={!Object.keys(recommended).length}
            aria-description={Object.keys(recommended).length?'Распределить очки по рекомендациям выбранного класса':'Сначала выберите класс'}>Рекомендация класса</button>
          <button type="button" className="chip" onClick={resetBases}>Начать с 8</button>
        </div>
      </div>
      <div className="forge-point-meter" role="progressbar" aria-label="Потрачено очков" aria-valuemin={0} aria-valuemax={POINT_BUY_BUDGET} aria-valuenow={Math.min(POINT_BUY_BUDGET,Math.max(0,POINT_BUY_BUDGET-remaining))}>
        <span style={{width:`${Math.min(100,Math.max(0,(POINT_BUY_BUDGET-remaining)/POINT_BUY_BUDGET*100))}%`}} />
      </div>
      <p className="forge-note">Каждая характеристика начинается с 8. Покупайте базу до 15. Шаги 13 → 14 и 14 → 15 стоят по 2 очка. Бонусы предыстории не тратят очки: выберите +2 и +1 или три бонуса по +1. Повторное нажатие снимает бонус.</p>
    </>}
    <div className="forge-ability-table">
      <div className="forge-ability-heading" aria-hidden="true"><span>Характеристика</span><span>{pointBuy?'База':'Значение'}</span><span>Бонус</span><span>Итог</span><span>Модификатор</span></div>
      {ABILITY_KEYS.map(k => {
        const base = baseOf(abilities,bonuses,k) ?? POINT_BUY_MIN;
        const bonus = bonusOf(bonuses,k);
        const final = pointBuy ? (abilities[k] ?? base+bonus) : abilities[k];
        const cost = pointCost(base) ?? 0;
        const increaseCost = (pointCost(base+1) ?? 99)-cost;
        return <div key={k} className="forge-ability-row">
          <div className="forge-ability-name"><strong>{ABILITY_LABEL_RU[k]}</strong><small>{hints[k]}</small></div>
          {pointBuy ? <div className="forge-ability-stepper">
            <button type="button" aria-label={`Уменьшить: ${ABILITY_LABEL_RU[k]}`} disabled={base<=POINT_BUY_MIN} onClick={()=>setBase(k,base-1)}>−</button>
            <AbilityBaseInput value={base} label={ABILITY_LABEL_RU[k]} onCommit={value=>setBase(k,value)}/>
            <button type="button" aria-label={`Увеличить: ${ABILITY_LABEL_RU[k]}`} disabled={base>=POINT_BUY_MAX||increaseCost>remaining} aria-description={`Стоимость следующего шага: ${increaseCost} очк.`} onClick={()=>setBase(k,base+1)}>+</button>
          </div> : <input aria-label={ABILITY_LABEL_RU[k]} type="number" min={1} max={30} value={abilities[k]??''} onChange={e=>onSet(k,e.target.value===''?undefined:parseInt(e.target.value,10))} />}
          <div className="forge-ability-bonus"><small>Бонус</small><div className="forge-ability-bonus-buttons" role="group" aria-label={`Бонус предыстории: ${ABILITY_LABEL_RU[k]}`}>
            {[1,2].map(value=><button key={value} type="button" aria-label={`Бонус +${value}: ${ABILITY_LABEL_RU[k]}`} aria-pressed={bonus===value}
              className={bonus===value?'on':''} disabled={!bonusAvailable(k,value)} onClick={()=>changeBonuses(nextBonus(k,value))}>+{value}</button>)}
          </div></div>
          <strong className="forge-ability-total"><small>Итог</small>{final??'—'}</strong>
          <span className="forge-ability-mod"><small>Модификатор</small>{typeof final==='number'?fmtMod(abilityMod(final)):'—'}</span>
        </div>;
      })}
    </div>
    <label className="forge-check"><input type="checkbox" checked={bonuses.anyAbilities} onChange={e=>changeBonuses({...bonuses,anyAbilities:e.target.checked,assignments:{}})} />Разрешить любые характеристики (не только предыстории)</label>
  </div>;
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
  const {hideTechnicalAbilities, entityDisplay}=useSiteSettings();
  const race = draft.raceId===assembled?.race?.id ? assembled.race : null;
  const klass = draft.classId===assembled?.klass?.id ? assembled.klass : null;
  const background = draft.backgroundId === assembled?.background?.id ? assembled.background : null;
  const feats = (assembled?.feats || []).filter(feat => {
    const oldOriginFeat = assembled?.background?.origin_feat;
    return background || ![feat.id,feat.card_number].includes(oldOriginFeat ?? '') || draft.featIds.includes(feat.id);
  });
  const lineageName = lineageNameProp
    ?? race?.lineages?.find(
      (l) => l.name === draft.lineageId || (l as { id?: string }).id === draft.lineageId,
    )?.name
    ?? (draft.lineageId && !/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(draft.lineageId) ? draft.lineageId : undefined);

  const selectedOrigin=(kind:string,id:string)=>kind==='race'?[draft.raceId,draft.lineageId].includes(id):kind==='class'?[draft.classId,...Object.keys(draft.classLevels??{}),draft.subclassId,...Object.values(draft.subclassIds??{})].includes(id):true;
  const effectsByOrigin = (kind: string) => (assembled?.effects || []).filter((e) => e.origin.kind === kind && selectedOrigin(kind,e.origin.id) && (!hideTechnicalAbilities || !e.effect.is_technical));
  const actionsByOrigin = (kind: string) => (assembled?.actions || []).filter((a) => a.origin.kind === kind && selectedOrigin(kind,a.origin.id));

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
        <ForgeAbilityDisplay mode={entityDisplay.effects} entries={effectsByOrigin('race').map(e => ({
          key:e.effect.id, name:e.effect.name, imageUrl:e.effect.image_url, fallbackImageUrl:race?.image_url,
          sourceLabel:e.origin.name, effect:e.effect,
        }))} />
        <ForgeAbilityDisplay mode={entityDisplay.actions} entries={actionsByOrigin('race').map(a => ({
          key:a.action.id, name:a.action.name, imageUrl:a.action.image_url, fallbackImageUrl:race?.image_url,
          sourceLabel:a.origin.name, action:a.action,
        }))} />
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
        <ForgeAbilityDisplay mode={entityDisplay.effects} entries={effectsByOrigin('class').map(e => ({
          key:e.effect.id, name:e.effect.name, imageUrl:e.effect.image_url, fallbackImageUrl:klass?.image_url,
          sourceLabel:e.origin.name, effect:e.effect,
        }))} />
        <ForgeAbilityDisplay mode={entityDisplay.actions} entries={actionsByOrigin('class').map(a => ({
          key:a.action.id, name:a.action.name, imageUrl:a.action.image_url, fallbackImageUrl:klass?.image_url,
          sourceLabel:a.origin.name, action:a.action,
        }))} />
      </div>

      <hr className="sum-divider" />

      <div className="sum-field">
        <span className="sum-label">Предыстория: </span>
        <span className="sum-value">{background ? background.name : '—'}</span>
      </div>

      <hr className="sum-divider" />

      {feats.map((f) => {
        const featEffects = (assembled?.effects || []).filter((e) => e.origin.kind === 'feat' && e.origin.id === f.id && (!hideTechnicalAbilities || !e.effect.is_technical));
        const featActions = (assembled?.actions || []).filter((a) => a.origin.kind === 'feat' && a.origin.id === f.id);
        return (
          <div key={f.id} className="sum-field">
            <span className="sum-label">Черта: </span>
            <span className="sum-value-inline">
              <ForgeEntityIcon imageUrl={f.image_url} alt={f.name} />
              <span>{f.name}</span>
            </span>
            <ForgeAbilityDisplay mode={entityDisplay.effects} entries={featEffects.map(e => {
              const p = effectAbilityPresentation(e.effect,e.origin,[f]);
              return {key:e.effect.id, name:p.name, imageUrl:e.effect.image_url, fallbackImageUrl:p.fallbackImageUrl ?? f.image_url, sourceLabel:p.sourceLabel, effect:p.effect};
            })} />
            <ForgeAbilityDisplay mode={entityDisplay.actions} entries={featActions.map(a => ({
              key:a.action.id,name:a.action.name,imageUrl:a.action.image_url,fallbackImageUrl:f.image_url,sourceLabel:a.origin.name,action:a.action,
            }))} />
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
