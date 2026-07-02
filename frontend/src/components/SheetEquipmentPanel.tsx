import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Search, Trash2 } from 'lucide-react';
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
import type { ForgeCharacter } from '../character/types';
import type { CharacterRuleState } from '../character/rules/types';
import { computeAC } from '../engine/ac';
import { registerCard } from '../engine/cardRegistry';
import { equipItem, totalWeight, unequipSlot } from '../engine/equipment';
import { weaponContext } from '../engine/weapon';
import type { Card } from '../types';
import type { RuntimeState } from '../mvp/contracts';

interface Props {
  character: ForgeCharacter;
  ruleState: CharacterRuleState;
  onUpdated: (c: ForgeCharacter) => void;
}

const SLOT_LABELS: Record<string, string> = {
  body: 'Тело',
  main_hand: 'Осн. рука',
  off_hand: 'Вторая рука',
  head: 'Голова',
};

export default function SheetEquipmentPanel({ character, ruleState, onUpdated }: Props) {
  const [cards, setCards] = useState<Map<string, Card>>(new Map());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<Card[]>([]);
  const [searching, setSearching] = useState(false);

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
  const weight = totalWeight(runtime, cardMap);
  const strScore = character.abilities?.str ?? 10;
  const capacity = carryingCapacity(strScore);

  const equippedCards = useMemo(() => {
    const out: Card[] = [];
    for (const id of Object.values(runtime.equipment)) {
      if (id && cardMap.has(id)) out.push(cardMap.get(id)!);
    }
    return out;
  }, [runtime.equipment, cardMap]);

  const ctx = buildCharacterContext(ruleState, { level: character.level, abilities: character.abilities ?? {} }, equippedCards);
  const acBreakdown = computeAC(ctx, runtime, []);
  const mainWeapon = weaponContext(ctx, 'main');

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
    const res = equipItem(runtime, card);
    if (res.error) { setError(res.error); return; }
    await persist(res.state);
  };

  const handleUnequip = async (slot: string) => {
    await persist(unequipSlot(runtime, slot));
  };

  const handleAdd = async (card: Card) => {
    registerCard(card);
    setCards((prev) => new Map(prev).set(card.id, card));
    await persist(addToInventory(runtime, card.id, 1));
  };

  const handleRemove = async (cardId: string) => {
    await persist(removeFromInventory(runtime, cardId, 1));
  };

  return (
    <section className="sheet-panel sheet-panel-wide">
      <h2 className="sheet-h2">Инвентарь и экипировка</h2>
      {error && <p className="issues">{error}</p>}
      <div className="sheet-stats" style={{ marginBottom: 12 }}>
        <div className="sheet-stat" title={acBreakdown.parts.map((p) => `${p.source}: ${p.value}`).join('\n')}>
          <span>КД (расчёт)</span><strong>{acBreakdown.value}</strong>
        </div>
        <div className="sheet-stat"><span>Вес</span><strong>{weight.toFixed(1)} / {capacity} фн</strong></div>
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
            return (
              <li key={slot}>
                <span>{label}</span>
                <span>
                  {card ? card.name : '—'}
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
      </div>
    </section>
  );
}
