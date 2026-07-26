import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, Package, Swords, X } from 'lucide-react';
import type { ForgeCharacter } from '../character/types';
import type { PendingChoice } from '../mechanics/collectChoices';
import type { Card } from '../types';
import { findMastery, useMasteryEffects } from '../utils/mastery';
import {
  useWeaponTemplatesByType,
  weaponTypeGroups,
  type WeaponTypeOption,
} from '../utils/weaponTypeCatalog';
import SheetEntityRow from './SheetEntityRow';

interface Props {
  choices: PendingChoice[];
  resolved: Record<string, string[]>;
  character: ForgeCharacter;
  /** Карты инвентаря/экипировки — для фильтра «есть у персонажа» и иконок. */
  equipCards?: Map<string, Card>;
  busy?: boolean;
  error?: string | null;
  onChange: (choiceId: string, values: string[]) => void;
  onClose: () => void;
}

/** Виды оружия, которые сейчас есть в инвентаре или надеты. */
function ownedWeaponTypeIds(character: ForgeCharacter, equipCards?: Map<string, Card>): Set<string> {
  const out = new Set<string>();
  if (!equipCards?.size) return out;
  const consider = (cardId: string | null | undefined) => {
    if (!cardId) return;
    const card = equipCards.get(cardId);
    if (card?.type === 'weapon' && card.weapon_type) out.add(card.weapon_type);
  };
  for (const row of character.inventory_items ?? []) consider(row.card_id);
  for (const id of Object.values(character.equipment ?? {})) consider(id);
  return out;
}

/** Предпочесть картинку из инвентаря, иначе шаблон библиотеки. */
function imageForWeaponType(
  weaponType: string,
  character: ForgeCharacter,
  equipCards: Map<string, Card> | undefined,
  templates: Map<string, Card>,
): string | null | undefined {
  if (equipCards?.size) {
    for (const row of character.inventory_items ?? []) {
      const card = equipCards.get(row.card_id);
      if (card?.type === 'weapon' && card.weapon_type === weaponType && card.image_url?.trim()) {
        return card.image_url;
      }
    }
    for (const id of Object.values(character.equipment ?? {})) {
      if (!id) continue;
      const card = equipCards.get(id);
      if (card?.type === 'weapon' && card.weapon_type === weaponType && card.image_url?.trim()) {
        return card.image_url;
      }
    }
  }
  return templates.get(weaponType)?.image_url;
}

/**
 * Диалог выбора искусности оружия: карточки видов с иконками шаблонов библиотеки.
 * Сначала — виды из инвентаря; полный каталог — по кнопке.
 */
export default function SheetWeaponMasteryDialog({
  choices, resolved, character, equipCards, busy, error, onChange, onClose,
}: Props) {
  const templates = useWeaponTemplatesByType();
  const masteryEffects = useMasteryEffects();
  const groups = useMemo(() => weaponTypeGroups(), []);
  const ownedTypes = useMemo(
    () => ownedWeaponTypeIds(character, equipCards),
    [character, equipCards],
  );
  const [activeChoiceId, setActiveChoiceId] = useState(choices[0]?.id ?? '');
  const [showAll, setShowAll] = useState(false);

  const active = useMemo(
    () => choices.find((c) => c.id === activeChoiceId) ?? choices[0],
    [choices, activeChoiceId],
  );
  const value = active ? (resolved[active.id] || []) : [];
  const done = active ? value.length >= active.count : false;

  const allowedIds = useMemo(() => new Set(
    Array.isArray(active?.filter)
      ? (active.filter as string[])
      : groups.flatMap((g) => g.weapons.map((w) => w.id)),
  ), [active?.filter, groups]);

  const allWeapons = useMemo(
    () => groups.flatMap((g) => g.weapons.filter((w) => allowedIds.has(w.id))),
    [groups, allowedIds],
  );

  const prioritized = useMemo(() => {
    const prefer = new Set<string>([...ownedTypes, ...value]);
    return allWeapons.filter((w) => prefer.has(w.id));
  }, [allWeapons, ownedTypes, value]);

  const visibleGroups = useMemo(() => {
    const source = showAll ? allWeapons : prioritized;
    const byGroup = new Map<string, WeaponTypeOption[]>();
    for (const w of source) {
      const list = byGroup.get(w.groupId) ?? [];
      list.push(w);
      byGroup.set(w.groupId, list);
    }
    return groups
      .map((g) => ({ ...g, weapons: byGroup.get(g.id) ?? [] }))
      .filter((g) => g.weapons.length > 0);
  }, [showAll, allWeapons, prioritized, groups]);

  const hiddenCount = Math.max(0, allWeapons.length - prioritized.length);
  const canExpand = !showAll && hiddenCount > 0;

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

  useEffect(() => { setShowAll(false); }, [activeChoiceId]);

  if (!choices.length || !active) return null;

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

  const renderWeapon = (w: WeaponTypeOption) => {
    const card = templates.get(w.id);
    const selected = value.includes(w.id);
    const mastery = findMastery(masteryEffects, card?.mastery);
    const inBag = ownedTypes.has(w.id);
    return (
      <SheetEntityRow
        key={w.id}
        imageUrl={imageForWeaponType(w.id, character, equipCards, templates)}
        name={w.label}
        detail={[w.groupLabel, mastery?.name, inBag ? 'в инвентаре' : null].filter(Boolean).join(' · ')}
        selected={selected}
        title={mastery?.description || w.label}
        onClick={() => toggle(w.id)}
        right={selected ? <Check size={16} className="sheet-mastery-check" /> : undefined}
      />
    );
  };

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
          {!showAll && (
            <section className="sheet-mastery-group">
              <h3 className="sheet-mastery-group-title">
                <Package size={12} style={{ verticalAlign: '-1px', marginRight: 5 }} />
                В инвентаре
              </h3>
              {prioritized.length > 0 ? (
                <div className="sheet-mastery-grid">
                  {prioritized.map(renderWeapon)}
                </div>
              ) : (
                <p className="sheet-settings-hint" style={{ margin: '0 0 4px' }}>
                  В инвентаре пока нет оружия с видом — откройте полный список ниже.
                </p>
              )}
            </section>
          )}

          {showAll && visibleGroups.map((group) => (
            <section key={group.id} className="sheet-mastery-group">
              <h3 className="sheet-mastery-group-title">{group.label}</h3>
              <div className="sheet-mastery-grid">
                {group.weapons.map(renderWeapon)}
              </div>
            </section>
          ))}

          {canExpand && (
            <button
              type="button"
              className="sheet-mastery-expand"
              onClick={() => setShowAll(true)}
            >
              <ChevronDown size={16} />
              Выбрать из всех видов
              {hiddenCount > 0 && (
                <span className="sheet-mastery-expand-count">+{hiddenCount}</span>
              )}
            </button>
          )}
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
