import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Search, Sparkles, Trash2 } from 'lucide-react';
import { MAX_ATTUNED, attunementUnlocked, readAttunedIds, toggleAttuned } from '../character/attunement';
import { cardsApi } from '../api/client';
import { charactersV3Api } from '../character/api';
import {
  addToInventory,
  buildCharacterContext,
  carryingCapacity,
  forgeToRuntimeState,
  removeFromInventory,
  runtimeInventoryPayload,
} from '../character/runtime';
import { characterCurrency, collectEquippedCards, equipFromInventory, unequipToInventory } from '../character/inventory';
import type { ForgeCharacter } from '../character/types';
import type { CharacterRuleState } from '../character/rules/types';
import { breakdownValue } from '../engine/breakdown';
import { currencyIconStyle, getCurrencyIconPath, getCurrencyInfo } from '../utils/currencies';
import { registerCard } from '../engine/cardRegistry';
import { totalWeight } from '../engine/equipment';
import { weaponContext } from '../engine/weapon';
import type { Card } from '../types';
import type { RuntimeState } from '../mvp/contracts';
import { useSiteSettings } from '../settings';
import CardPreview from './CardPreview';

interface Props {
  character: ForgeCharacter;
  ruleState: CharacterRuleState;
  onUpdated: (c: ForgeCharacter) => void;
  embedded?: boolean;
  /** Пассивные механики персонажа — чтобы «КД (расчёт)» совпадал с шапкой. */
  passives?: Record<string, unknown>[];
}

const SLOT_LABELS: Record<string, string> = {
  body: 'Тело',
  main_hand: 'Осн. рука',
  off_hand: 'Вторая рука',
  head: 'Голова',
  gloves: 'Перчатки',
  boots: 'Сапоги',
  cloak: 'Плащ',
  necklace: 'Ожерелье',
  ring_1: 'Кольцо I',
  ring_2: 'Кольцо II',
};

export default function SheetEquipmentPanel({ character, ruleState, onUpdated, embedded, passives = [] }: Props) {
  const [cards, setCards] = useState<Map<string, Card>>(new Map());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<Card[]>([]);
  const [searching, setSearching] = useState(false);
  const { entityDisplay } = useSiteSettings();
  const [hoveredItem, setHoveredItem] = useState<Card | null>(null);
  const [itemMouse, setItemMouse] = useState({ x: 0, y: 0 });

  const runtime = useMemo(() => forgeToRuntimeState(character), [character]);

  const cardIds = useMemo(() => {
    const ids = new Set<string>();
    for (const row of character.inventory_items ?? []) ids.add(row.card_id);
    for (const id of Object.values(character.equipment ?? {})) if (id) ids.add(id);
    return [...ids];
  }, [character.inventory_items, character.equipment]);

  useEffect(() => {
    let stale = false;
    (async () => {
      const map = new Map<string, Card>();
      for (const id of cardIds) {
        try {
          map.set(id, await cardsApi.getCard(id));
        } catch {
          /* skip missing */
        }
      }
      if (!stale) setCards(map);
    })();
    return () => { stale = true; };
  }, [cardIds.join('|')]);

  useEffect(() => {
    const q = search.trim();
    if (q.length < 2) {
      setSearchResults([]);
      return;
    }
    let stale = false;
    const timer = window.setTimeout(async () => {
      setSearching(true);
      try {
        const res = await cardsApi.getCards({
          search: q,
          limit: 12,
          exclude_template_only: true,
        });
        if (!stale) setSearchResults(res.cards);
      } catch (e) {
        console.error(e);
        if (!stale) setSearchResults([]);
      } finally {
        if (!stale) setSearching(false);
      }
    }, 350);
    return () => { stale = true; window.clearTimeout(timer); };
  }, [search]);

  const cardMap = cards;
  const wallet = characterCurrency(character);
  const weight = totalWeight(runtime, cardMap);
  const strScore = character.abilities?.str ?? 10;
  const capacity = carryingCapacity(strScore);

  const equippedCards = useMemo(
    () => collectEquippedCards(runtime.equipment, cardMap),
    [runtime.equipment, cardMap],
  );

  const ctx = buildCharacterContext(
    ruleState,
    { level: character.level, abilities: character.abilities ?? {} },
    equippedCards,
    null,
  );
  // Как шапка листа: база (доспех/щит) + модификаторы эффектов (напр.
  // боевой стиль «Оборона» +1). Голый computeAC терял modifier-пассивки.
  const acBreakdown = breakdownValue('ac', ctx, runtime, passives);
  const mainWeapon = weaponContext(ctx, 'main', runtime.equipment);

  const persist = useCallback(async (next: RuntimeState) => {
    setBusy(true);
    setError(null);
    try {
      const updated = await charactersV3Api.patchRuntime(character.id, {
        equipment: next.equipment,
        inventory_items: runtimeInventoryPayload(next),
        current_hp: next.hp.current,
        max_hp: next.hp.max,
      });
      onUpdated(updated);
    } catch (e) {
      console.error(e);
      setError('Не удалось сохранить экипировку');
    } finally {
      setBusy(false);
    }
  }, [character.id, onUpdated]);

  const handleEquip = async (card: Card) => {
    registerCard(card);
    setCards((prev) => new Map(prev).set(card.id, card));
    // Из инвентаря: qty −1, вытесненные предметы возвращаются в сумку.
    const res = equipFromInventory(runtime, card);
    if (res.error) { setError(res.error); return; }
    await persist(res.state);
  };

  const handleUnequip = async (slot: string) => {
    const id = runtime.equipment[slot];
    // снятие предмета не разрывает настройку (по правилам она держится),
    // но его пассивки перестают действовать, т.к. предмет больше не надет
    await persist(unequipToInventory(runtime, slot));
    void id;
  };

  // ── Настройка (attunement): максимум 3, менять можно только после отдыха ──
  const attuned = readAttunedIds(character.turn_state);
  const canChangeAttunement = attunementUnlocked(character.turn_state);

  const handleToggleAttune = async (cardId: string) => {
    setBusy(true);
    setError(null);
    try {
      const next = toggleAttuned(attuned, cardId);
      if (next.length > MAX_ATTUNED) {
        setError(`Настроиться можно максимум на ${MAX_ATTUNED} предмета`);
        return;
      }
      const updated = await charactersV3Api.patchRuntime(character.id, {
        turn_state: { ...(character.turn_state ?? {}), attuned_ids: next },
      });
      onUpdated(updated);
    } catch (e) {
      console.error(e);
      setError('Не удалось изменить настройку');
    } finally {
      setBusy(false);
    }
  };

  const handleAdd = async (card: Card) => {
    registerCard(card);
    setCards((prev) => new Map(prev).set(card.id, card));
    await persist(addToInventory(runtime, card.id, 1));
  };

  const handleRemove = async (cardId: string) => {
    await persist(removeFromInventory(runtime, cardId, 1));
  };

  const body = (
    <>
      {error && <p className="issues">{error}</p>}
      <div className="sheet-stats" style={{ marginBottom: 12 }}>
        <div className="sheet-stat" title={acBreakdown.parts.map((p) => `${p.source}: ${p.value}`).join('\n')}>
          <span>КД (расчёт)</span><strong>{acBreakdown.value}</strong>
        </div>
        <div className="sheet-stat"><span>Вес</span><strong>{weight.toFixed(1)} / {capacity} фн</strong></div>
        <div className="sheet-stat" title="Кошелёк персонажа (золото / серебро / медь)">
          <span>Кошелёк</span>
          <strong style={{ display: 'inline-flex', alignItems: 'center', gap: 10, fontSize: '1.15rem' }}>
            {([['gold', wallet.gold], ['silver', wallet.silver], ['copper', wallet.copper]] as const)
              .filter(([, amount], i) => amount || (i === 0 && !wallet.gold && !wallet.silver && !wallet.copper))
              .map(([cur, amount]) => (
                <span key={cur} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  {amount || 0}
                  <img
                    src={getCurrencyIconPath(cur)}
                    alt={getCurrencyInfo(cur).short}
                    title={getCurrencyInfo(cur).label}
                    style={{ width: 22, height: 22, objectFit: 'contain', ...currencyIconStyle }}
                  />
                </span>
              ))}
          </strong>
        </div>
        {mainWeapon && (
          <div className="sheet-stat"><span>Оружие</span><strong>{mainWeapon.dice} {mainWeapon.ability.toUpperCase()}</strong></div>
        )}
      </div>

      <div className="sheet-group">
        <h3 className="sheet-h3">Добавить предмет</h3>
        <div className="sheet-inv-search">
          <Search size={16} className="sheet-inv-search-icon" />
          <input
            className="forge-input sheet-inv-search-input"
            placeholder="Поиск: «Длинный меч», «Щит» (MVP-LONGSWORD / MVP-SHIELD)…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {searching && <p className="forge-note">Поиск…</p>}
        {!searching && search.trim().length >= 2 && searchResults.length === 0 && (
          <p className="forge-note">Ничего не найдено.</p>
        )}
        {searchResults.length > 0 && (
          <ul className="sheet-list sheet-inv-search-results">
            {searchResults.map((card) => (
              <li key={card.id}>
                <span>
                  {card.name}
                  {card.weight != null && <span className="sheet-inv-meta"> · {card.weight} фн</span>}
                </span>
                <button
                  type="button"
                  className="forge-btn ghost sheet-roll-btn"
                  disabled={busy}
                  onClick={() => handleAdd(card)}
                  title="Добавить в инвентарь"
                >
                  <Plus size={14} />
                  Добавить
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="sheet-group">
        <h3 className="sheet-h3">Слоты</h3>
        <ul className="sheet-list">
          {Object.entries(SLOT_LABELS).map(([slot, label]) => {
            const id = runtime.equipment[slot];
            const card = id ? cardMap.get(id) : null;
            const needsAttunement = !!card?.requires_attunement;
            const cardAttuned = !!card && attuned.includes(card.id);
            return (
              <li key={slot}>
                <span>{label}</span>
                <span>
                  {card ? card.name : '—'}
                  {needsAttunement && card && (
                    <button
                      type="button"
                      className={`sheet-attune-btn${cardAttuned ? ' on' : ''}`}
                      disabled={busy || (!canChangeAttunement)}
                      title={cardAttuned
                        ? (canChangeAttunement ? 'Прервать настройку' : 'Настроен (сменить — на отдыхе)')
                        : (canChangeAttunement
                          ? `Настроиться (${attuned.length}/${MAX_ATTUNED})`
                          : 'Настройка меняется только на коротком/долгом отдыхе')}
                      onClick={() => handleToggleAttune(card.id)}
                    >
                      <Sparkles size={13} />
                      {cardAttuned ? 'Настроен' : 'Настроиться'}
                    </button>
                  )}
                  {card && (
                    <button type="button" className="forge-btn ghost sheet-roll-btn" disabled={busy} onClick={() => handleUnequip(slot)} style={{ marginLeft: 8 }}>
                      Снять
                    </button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="sheet-group">
        <h3 className="sheet-h3">Инвентарь</h3>
        {!character.inventory_items?.length && <p className="forge-note">Пусто — найдите предмет выше и нажмите «Добавить».</p>}
        {entityDisplay.items === 'icon' ? (
          <div className="forge-spell-icon-grid sheet-inv-icon-grid">
            {(character.inventory_items ?? []).map((row) => {
              const card = cardMap.get(row.card_id);
              return (
                <div key={row.card_id} className="sheet-inv-tile">
                  <div
                    className="forge-spell-icon ready"
                    title={card?.name ?? row.card_id}
                    onMouseEnter={(e) => { if (card) { setHoveredItem(card); setItemMouse({ x: e.clientX, y: e.clientY }); } }}
                    onMouseMove={(e) => setItemMouse({ x: e.clientX, y: e.clientY })}
                    onMouseLeave={() => setHoveredItem(null)}
                  >
                    <img
                      src={card?.image_url?.trim() || '/default_image.png'}
                      alt={card?.name ?? row.card_id}
                      onError={(e) => { (e.target as HTMLImageElement).src = '/default_image.png'; }}
                    />
                    {row.qty > 1 && <span className="forge-spell-badge">×{row.qty}</span>}
                  </div>
                  <div className="sheet-inv-tile-actions">
                    {card && (
                      <button type="button" className="forge-btn ghost sheet-roll-btn" disabled={busy} onClick={() => handleEquip(card)}>
                        Надеть
                      </button>
                    )}
                    <button
                      type="button"
                      className="forge-btn ghost sheet-roll-btn"
                      disabled={busy}
                      onClick={() => handleRemove(row.card_id)}
                      title="Убрать 1 шт."
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <ul className="sheet-list">
            {(character.inventory_items ?? []).map((row) => {
              const card = cardMap.get(row.card_id);
              return (
                <li key={row.card_id}>
                  <span>{card?.name ?? row.card_id} ×{row.qty}</span>
                  <span className="sheet-inv-actions">
                    {card && (
                      <button type="button" className="forge-btn ghost sheet-roll-btn" disabled={busy} onClick={() => handleEquip(card)}>
                        Надеть
                      </button>
                    )}
                    <button
                      type="button"
                      className="forge-btn ghost sheet-roll-btn"
                      disabled={busy}
                      onClick={() => handleRemove(row.card_id)}
                      title="Убрать 1 шт."
                    >
                      <Trash2 size={14} />
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {hoveredItem && (
          <div
            className="fixed z-50 pointer-events-none"
            style={{
              left: Math.min(itemMouse.x + 16, window.innerWidth - 220),
              top: Math.min(Math.max(itemMouse.y - 40, 10), window.innerHeight - 20),
              transform: itemMouse.y > window.innerHeight / 2 ? 'translateY(-100%)' : 'translateY(0)',
            }}
          >
            <CardPreview card={hoveredItem} disableHover />
          </div>
        )}
      </div>
    </>
  );

  if (embedded) return body;

  return (
    <section className="sheet-panel sheet-panel-wide">
      <h2 className="sheet-h2">Инвентарь и экипировка</h2>
      {body}
    </section>
  );
}
