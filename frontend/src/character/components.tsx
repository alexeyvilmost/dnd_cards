import type { ReactNode } from 'react';
import { optionsForChoiceSource, labelOf, SKILLS, type RegistryItem } from '../mechanics/registries';
import type { PendingChoice } from '../mechanics/collectChoices';
import type { AssembledCharacter } from './assemble';
import { ABILITY_KEYS, ABILITY_LABEL_RU, type AbilityKey, type CharacterDraft } from './types';
import type { Spell } from '../types';
import { abilityMod } from './derive';
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
  return (
    <nav className="forge-rail">
      {sections.map((s) => (
        <button
          key={s.id}
          className={`rail-step ${active === s.id ? 'active' : ''} ${s.status === 'todo' ? 'todo' : ''}`}
          onClick={() => onSelect(s.id)}
          type="button"
        >
          <span className={`rail-medal ${s.status === 'ok' ? 'ok' : ''}`}>{s.icon}</span>
          <span className="rail-txt">
            <span className="rail-label">{s.label}</span>
            {s.sub && <span className="rail-sub">{s.sub}</span>}
          </span>
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
  // subfeature (подвиды/наследия), explicit (боевой стиль, дар договора,
  // «навык А или Б») и effect (выбор эффектов-бусин) несут варианты прямо в
  // options.items — берём их оттуда.
  if (choice.source === 'subfeature' || choice.source === 'explicit' || choice.source === 'effect') {
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
  choice, value, onChange, unavailableOptions = {},
}: {
  choice: PendingChoice;
  value: string[];
  onChange: (v: string[]) => void;
  unavailableOptions?: Record<string, string>;
}) {
  const options = optionsForChoice(choice);
  const toggle = (id: string) => {
    if (unavailableOptions[id] && !value.includes(id)) return;
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
            disabled={!!unavailableOptions[o.id] && !value.includes(o.id)}
            title={unavailableOptions[o.id]}
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
            {featEffects.map((e) => (
              <ForgeAbilityLine
                key={e.effect.id}
                name={e.effect.name}
                imageUrl={e.effect.image_url}
                fallbackImageUrl={f.image_url}
                sourceLabel={`Способность черты · ${e.origin.name}`}
                effect={e.effect}
              />
            ))}
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
          <span className="sum-label" style={{ fontSize: 15, display: 'block', marginBottom: 6 }}>Заклинания</span>
          <ForgeSpellIconGrid spells={spells} className="forge-spell-icon-grid sum-spell-grid" />
        </div>
      )}
    </div>
  );
}
