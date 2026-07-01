import type { ReactNode } from 'react';
import { optionsForChoiceSource, labelOf, SKILLS, type RegistryItem } from '../mechanics/registries';
import type { PendingChoice } from '../mechanics/collectChoices';
import type { AssembledCharacter } from './assemble';
import { ABILITY_KEYS, ABILITY_LABEL_RU, type AbilityKey, type CharacterDraft } from './types';
import type { Spell } from '../types';
import { abilityMod } from './derive';

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
  return (
    <nav className="forge-nav">
      {sections.map((s) => (
        <button
          key={s.id}
          className={`forge-nav-item ${active === s.id ? 'active' : ''}`}
          onClick={() => onSelect(s.id)}
          type="button"
        >
          {s.status && <span className={`dot ${s.status === 'ok' ? 'dot-ok' : 'dot-todo'}`} />}
          <span className="forge-nav-label">{s.label}</span>
          <span style={{ height: 22, display: 'flex', alignItems: 'center' }}>{s.icon}</span>
          {s.sub && <span className="forge-nav-sub">{s.sub}</span>}
        </button>
      ))}
    </nav>
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

function optionsForChoice(choice: PendingChoice): RegistryItem[] {
  if (choice.source === 'subfeature') {
    return (choice.items || []).map((it) => ({ id: it.id, label: it.name }));
  }
  const opts = optionsForChoiceSource(choice.source);
  if (opts.length) {
    // сузить по фильтру, если он список
    if (Array.isArray(choice.filter)) return opts.filter((o) => (choice.filter as string[]).includes(o.id));
    return opts;
  }
  return [];
}

export function ChoiceResolver({
  choice, value, onChange,
}: { choice: PendingChoice; value: string[]; onChange: (v: string[]) => void }) {
  const options = optionsForChoice(choice);
  const toggle = (id: string) => {
    if (value.includes(id)) {
      onChange(value.filter((x) => x !== id));
    } else {
      if (value.length >= choice.count) {
        // заменяем самый старый выбор при переполнении
        onChange([...value.slice(1), id]);
      } else {
        onChange([...value, id]);
      }
    }
  };
  const done = value.length >= choice.count;
  return (
    <div className="choice-box">
      <div className="choice-title">
        {choice.prompt} <span className="origin">· {choice.origin.name}</span>
      </div>
      <div className="chips">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            className={`chip ${value.includes(o.id) ? 'on' : ''} ${choice.recommended?.includes(o.id) ? 'rec' : ''}`}
            onClick={() => toggle(o.id)}
          >
            {o.label}
          </button>
        ))}
        {options.length === 0 && <span className="ec-sub">Нет вариантов для источника «{choice.source}»</span>}
      </div>
      <div className={`choice-count ${done ? 'done' : ''}`}>
        Выбрано {value.length} из {choice.count}
      </div>
    </div>
  );
}

// ─── Раскладка характеристик ─────────────────────────────────────────────────

export function AbilityAssigner({
  abilities, standardArray, manual, onSet, onToggleManual,
}: {
  abilities: Partial<Record<AbilityKey, number>>;
  standardArray: number[];
  manual: boolean;
  onSet: (key: AbilityKey, value: number | undefined) => void;
  onToggleManual: (v: boolean) => void;
}) {
  const used = ABILITY_KEYS.map((k) => abilities[k]).filter((v): v is number => typeof v === 'number');
  const remainingPool = [...standardArray];
  for (const v of used) {
    const i = remainingPool.indexOf(v);
    if (i >= 0) remainingPool.splice(i, 1);
  }

  return (
    <div>
      <label className="forge-note" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input type="checkbox" checked={manual} onChange={(e) => onToggleManual(e.target.checked)} />
        Ручной ввод (иначе — стандартный набор {standardArray.join('/')})
      </label>

      {!manual && (
        <div className="pool">
          {standardArray.map((v, i) => (
            <span key={i} className={`p ${remainingPool.includes(v) ? '' : 'used'}`}>{v}</span>
          ))}
        </div>
      )}

      {ABILITY_KEYS.map((k) => {
        const cur = abilities[k];
        return (
          <div key={k} className="ab-row">
            <span className="name">{ABILITY_LABEL_RU[k]}</span>
            {manual ? (
              <input
                type="number" min={1} max={30}
                value={typeof cur === 'number' ? cur : ''}
                onChange={(e) => onSet(k, e.target.value === '' ? undefined : parseInt(e.target.value, 10))}
                style={{ width: 80 }}
              />
            ) : (
              <select
                value={typeof cur === 'number' ? cur : ''}
                onChange={(e) => onSet(k, e.target.value === '' ? undefined : parseInt(e.target.value, 10))}
              >
                <option value="">—</option>
                {[...new Set([...(typeof cur === 'number' ? [cur] : []), ...remainingPool])]
                  .sort((a, b) => b - a)
                  .map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            )}
            <span className="mod">{typeof cur === 'number' ? (abilityMod(cur) >= 0 ? `+${abilityMod(cur)}` : abilityMod(cur)) : ''}</span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Живая сводка «Основное» ─────────────────────────────────────────────────

const skillLabel = (id: string) => labelOf(SKILLS, id);

export function SummaryPanel({
  draft, assembled, spells,
}: { draft: CharacterDraft; assembled: AssembledCharacter | null; spells: Spell[] }) {
  const race = assembled?.race;
  const klass = assembled?.klass;
  const background = assembled?.background;
  const feats = assembled?.feats || [];
  const lineageName = race?.lineages?.find((l) => (l as { id?: string }).id === draft.lineageId)?.name
    || (draft.lineageId ?? undefined);

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
        <span className="sum-value">{race ? race.name : '—'}{lineageName ? ` · ${lineageName}` : ''}</span>
        {effectsByOrigin('race').map((e) => (
          <div key={e.effect.id} className="sum-sub">{e.effect.name}</div>
        ))}
        {actionsByOrigin('race').map((a) => (
          <div key={a.action.id} className="sum-sub">{a.action.name}</div>
        ))}
      </div>

      <hr className="sum-divider" />

      <div className="sum-field">
        <span className="sum-label">Класс: </span>
        <span className="sum-value">{klass ? `${klass.name}, ${draft.level}` : '—'}</span>
        {effectsByOrigin('class').map((e) => (
          <div key={e.effect.id} className="sum-sub">{e.effect.name}</div>
        ))}
        {actionsByOrigin('class').map((a) => (
          <div key={a.action.id} className="sum-sub">{a.action.name}</div>
        ))}
      </div>

      <hr className="sum-divider" />

      <div className="sum-field">
        <span className="sum-label">Предыстория: </span>
        <span className="sum-value">{background ? background.name : '—'}</span>
      </div>

      <hr className="sum-divider" />

      {feats.map((f) => (
        <div key={f.id} className="sum-field">
          <span className="sum-label">Черта: </span>
          <span className="sum-value">{f.name}</span>
        </div>
      ))}

      <hr className="sum-divider" />

      <div className="sum-abilities">
        {ABILITY_KEYS.map((k) => {
          const v = draft.abilities[k];
          const m = typeof v === 'number' ? abilityMod(v) : null;
          return (
            <div key={k} className="sum-ab">
              <div className="k">{ABILITY_LABEL_RU[k].slice(0, 3).toUpperCase()}</div>
              <div className="v">{typeof v === 'number' ? v : '—'}</div>
              <div className="m">{m === null ? '' : m >= 0 ? `+${m}` : m}</div>
            </div>
          );
        })}
      </div>

      {assembled && (
        <div className="sum-field" style={{ marginTop: 14 }}>
          <span className="sum-label" style={{ fontSize: 15 }}>HP </span>
          <span className="sum-value" style={{ fontSize: 15 }}>{assembled.derived.maxHP}</span>
          <span className="sum-label" style={{ fontSize: 15, marginLeft: 12 }}>КД </span>
          <span className="sum-value" style={{ fontSize: 15 }}>{assembled.derived.ac}</span>
          <span className="sum-label" style={{ fontSize: 15, marginLeft: 12 }}>Мастерство </span>
          <span className="sum-value" style={{ fontSize: 15 }}>+{assembled.derived.proficiencyBonus}</span>
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
          <span className="sum-label" style={{ fontSize: 15 }}>Заклинания: </span>
          <span className="sum-value" style={{ fontSize: 14 }}>{spells.map((s) => s.name).join(', ')}</span>
        </div>
      )}
    </div>
  );
}
