import { useEffect, useMemo, useState } from 'react';
import { Check, Swords, X } from 'lucide-react';
import type { PendingChoice } from '../mechanics/collectChoices';
import { findMastery, useMasteryEffects } from '../utils/mastery';
import { useWeaponTemplatesByType, weaponTypeGroups } from '../utils/weaponTypeCatalog';
import SheetEntityRow from './SheetEntityRow';

interface Props {
  choices: PendingChoice[];
  resolved: Record<string, string[]>;
  busy?: boolean;
  error?: string | null;
  onChange: (choiceId: string, values: string[]) => void;
  onClose: () => void;
}

/**
 * Диалог выбора искусности оружия: карточки видов с иконками шаблонов библиотеки.
 */
export default function SheetWeaponMasteryDialog({
  choices, resolved, busy, error, onChange, onClose,
}: Props) {
  const templates = useWeaponTemplatesByType();
  const masteryEffects = useMasteryEffects();
  const groups = useMemo(() => weaponTypeGroups(), []);
  const [activeChoiceId, setActiveChoiceId] = useState(choices[0]?.id ?? '');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    if (!choices.some((c) => c.id === activeChoiceId)) {
      setActiveChoiceId(choices[0]?.id ?? '');
    }
  }, [choices, activeChoiceId]);

  if (!choices.length) return null;

  const active = choices.find((c) => c.id === activeChoiceId) ?? choices[0];
  const value = resolved[active.id] || [];
  const done = value.length >= active.count;

  const toggle = (weaponId: string) => {
    if (busy) return;
    if (value.includes(weaponId)) {
      onChange(active.id, value.filter((x) => x !== weaponId));
      return;
    }
    if (value.length >= active.count) {
      onChange(active.id, [...value.slice(1), weaponId]);
    } else {
      onChange(active.id, [...value, weaponId]);
    }
  };

  const allowedIds = new Set(
    // Если у choice есть items/filter-список — сужаем; иначе все виды из реестра.
    Array.isArray(active.filter)
      ? (active.filter as string[])
      : groups.flatMap((g) => g.weapons.map((w) => w.id)),
  );

  return (
    <div className="sheet-equip-overlay" onClick={onClose}>
      <div
        className="sheet-settings-dialog sheet-mastery-dialog"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Искусность оружия"
      >
        <button type="button" className="sheet-equip-close" onClick={onClose} title="Закрыть (Esc)">
          <X size={18} />
        </button>

        <h2 className="sheet-settings-title">
          <Swords size={17} style={{ verticalAlign: '-3px', marginRight: 6 }} />
          Мастерство оружия
        </h2>
        <p className="sheet-settings-hint">
          Выберите виды оружия, с чьими свойствами искусности вы умеете обращаться.
          {' '}
          <span className={done ? 'sheet-mastery-count is-done' : 'sheet-mastery-count'}>
            Выбрано {value.length} из {active.count}
          </span>
        </p>

        {choices.length > 1 && (
          <div className="sheet-mastery-tabs">
            {choices.map((c) => {
              const n = (resolved[c.id] || []).length;
              const ok = n >= c.count;
              return (
                <button
                  key={c.id}
                  type="button"
                  className={`sheet-mastery-tab${c.id === active.id ? ' is-on' : ''}`}
                  onClick={() => setActiveChoiceId(c.id)}
                >
                  {c.origin.name || c.prompt}
                  <small className={ok ? 'is-done' : ''}>{n}/{c.count}</small>
                </button>
              );
            })}
          </div>
        )}

        <div className="sheet-mastery-prompt">
          {active.prompt}
          <span className="origin"> · {active.origin.name}</span>
        </div>

        {error && <p className="issues">{error}</p>}

        <div className={`sheet-mastery-body${busy ? ' is-busy' : ''}`}>
          {groups.map((group) => {
            const weapons = group.weapons.filter((w) => allowedIds.has(w.id));
            if (!weapons.length) return null;
            return (
              <section key={group.id} className="sheet-mastery-group">
                <h3 className="sheet-mastery-group-title">{group.label}</h3>
                <div className="sheet-mastery-grid">
                  {weapons.map((w) => {
                    const card = templates.get(w.id);
                    const selected = value.includes(w.id);
                    const mastery = findMastery(masteryEffects, card?.mastery);
                    return (
                      <SheetEntityRow
                        key={w.id}
                        imageUrl={card?.image_url}
                        name={w.label}
                        detail={[group.label, mastery?.name].filter(Boolean).join(' · ')}
                        selected={selected}
                        title={mastery?.description || w.label}
                        onClick={() => toggle(w.id)}
                        right={selected ? <Check size={16} className="sheet-mastery-check" /> : undefined}
                      />
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>

        <div className="sheet-equip-actions">
          <button type="button" className="forge-btn sheet-equip-primary" onClick={onClose}>
            {done ? 'Готово' : 'Закрыть'}
          </button>
        </div>
      </div>
    </div>
  );
}
