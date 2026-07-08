import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Search, Sparkles } from 'lucide-react';
import { MAX_ATTUNED, attunementUnlocked, readAttunedIds, toggleAttuned } from '../character/attunement';
import { cardsApi } from '../api/client';
import { charactersV3Api } from '../character/api';
import {
  addToInventory,
  carryingCapacity,
  forgeToRuntimeState,
  removeFromInventory,
  runtimeInventoryPayload,
} from '../character/runtime';
import {
  characterCurrency,
  equipCardSwapping,
  unequipToInventory,
} from '../character/inventory';
import type { ForgeCharacter } from '../character/types';
import type { CharacterRuleState } from '../character/rules/types';
import { currencyIconStyle, getCurrencyIconPath, getCurrencyInfo } from '../utils/currencies';
import { registerCard } from '../engine/cardRegistry';
import { planEquip, totalWeight } from '../engine/equipment';
import type { Card } from '../types';
import type { RuntimeState } from '../mvp/contracts';
import { useSiteSettings } from '../settings';
import CardPreview from './CardPreview';
import SheetItemRow from './SheetItemRow';
import EquipItemDialog from './EquipItemDialog';
import SheetAttunementDialog from './SheetAttunementDialog';

interface Props {
  character: ForgeCharacter;
  ruleState: CharacterRuleState;
  onUpdated: (c: ForgeCharacter) => void;
  embedded?: boolean;
  /** Пассивные механики персонажа (для контекста; КД считается в шапке листа). */
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

// Лого слота на фоне пустой ячейки (иконки из /public/icons/slots).
const SLOT_ICON: Record<string, string> = {
  body: '/icons/slots/armor.png',
  main_hand: '/icons/slots/hand.png',
  off_hand: '/icons/slots/hand.png',
  head: '/icons/slots/helm.png',
  gloves: '/icons/slots/gloves.png',
  boots: '/icons/slots/boots.png',
  cloak: '/icons/slots/cloak.png',
  necklace: '/icons/slots/necklace.png',
  ring_1: '/icons/slots/ring.png',
  ring_2: '/icons/slots/ring.png',
};

type Dialog =
  | { card: Card; mode: 'inventory'; occupant: Card | null }
  | { card: Card; mode: 'equipped'; slot: string };

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
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [attuneOpen, setAttuneOpen] = useState(false);

  const runtime = useMemo(() => forgeToRuntimeState(character), [character]);
  void passives; void ruleState; // КД/оружие считаются в шапке листа

  const cardIds = useMemo(() => {
    const ids = new Set<string>();
    for (const row of character.inventory_items ?? []) ids.add(row.card_id);
    for (const id of Object.values(character.equipment ?? {})) if (id) ids.add(id);
    return [...ids];
  }, [character.inventory_items, character.equipment]);

  useEffect(() => {
    let stale = false;
    (async () => {
      // B5: карты грузим параллельно (раньше — for-await по одной).
      const entries = await Promise.all(
        cardIds.map((id) =>
          cardsApi.getCard(id).then((card) => [id, card] as const).catch(() => null),
        ),
      );
      if (!stale) setCards(new Map(entries.filter((e): e is readonly [string, Card] => !!e)));
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
        const res = await cardsApi.getCards({ search: q, limit: 12, exclude_template_only: true });
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
  const asIcons = entityDisplay.items === 'icon';

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

  const attuned = readAttunedIds(character.turn_state);
  const canChangeAttunement = attunementUnlocked(character.turn_state);
  // Списки для окна настройки: настроенные предметы и те, на что можно настроиться.
  const presentCards = cardIds.map((id) => cardMap.get(id)).filter((c): c is Card => !!c);
  const attunedCards = attuned.map((id) => cardMap.get(id)).filter((c): c is Card => !!c);
  const attunableCards = presentCards.filter((c) => c.requires_attunement && !attuned.includes(c.id));

  const handleEquip = async (card: Card) => {
    registerCard(card);
    setCards((prev) => new Map(prev).set(card.id, card));
    const res = equipCardSwapping(runtime, card);
    if (res.error) { setError(res.error); return; }
    await persist(res.state);
    setDialog(null);
  };

  const handleUnequip = async (slot: string) => {
    await persist(unequipToInventory(runtime, slot));
    setDialog(null);
  };

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
    setDialog(null);
  };

  // Открыть диалог для предмета инвентаря (с расчётом вытесняемого из слота).
  const openInventoryItem = (card: Card) => {
    const plan = planEquip(runtime, card);
    const occupant = plan.occupantId ? cardMap.get(plan.occupantId) ?? null : null;
    setDialog({ card, mode: 'inventory', occupant });
  };
  const openEquipped = (slot: string, card: Card) => setDialog({ card, mode: 'equipped', slot });

  const hoverHandlers = (card?: Card | null) => ({
    onMouseEnter: (e: React.MouseEvent) => { if (card) { setHoveredItem(card); setItemMouse({ x: e.clientX, y: e.clientY }); } },
    onMouseMove: (e: React.MouseEvent) => setItemMouse({ x: e.clientX, y: e.clientY }),
    onMouseLeave: () => setHoveredItem(null),
  });

  // ── Слот-ячейка ──
  const renderSlots = () => {
    const entries = Object.entries(SLOT_LABELS);
    if (asIcons) {
      return (
        <div className="sheet-slot-grid">
          {entries.map(([slot, label]) => {
            const id = runtime.equipment[slot];
            const card = id ? cardMap.get(id) : null;
            return (
              <button
                key={slot}
                type="button"
                className={`sheet-slot-tile${card ? ' filled' : ''}`}
                title={card ? `${label}: ${card.name}` : label}
                onClick={() => { if (card) openEquipped(slot, card); }}
                {...hoverHandlers(card)}
              >
                <img className="sheet-slot-bg" src={SLOT_ICON[slot]} alt={label} />
                {card && (
                  <img
                    className="sheet-slot-item"
                    src={card.image_url?.trim() || '/default_image.png'}
                    alt={card.name}
                    onError={(e) => { (e.currentTarget as HTMLImageElement).src = '/default_image.png'; }}
                  />
                )}
                {card?.requires_attunement && <span className="sheet-slot-attune"><Sparkles size={11} /></span>}
                <span className="sheet-slot-tile-label">{label}</span>
              </button>
            );
          })}
        </div>
      );
    }
    return (
      <div className="sheet-item-cols">
        {entries.map(([slot, label]) => {
          const id = runtime.equipment[slot];
          const card = id ? cardMap.get(id) : null;
          return card ? (
            <SheetItemRow
              key={slot}
              card={card}
              onClick={() => openEquipped(slot, card)}
              stamp={SLOT_ICON[slot]}
              {...hoverHandlers(card)}
            />
          ) : (
            <div key={slot} className="sheet-item-row is-empty" title={label}>
              <span className="sheet-item-row-thumb is-slot">
                <img src={SLOT_ICON[slot]} alt={label} />
              </span>
              <span className="sheet-item-row-body">
                <span className="sheet-item-row-name sheet-slot-empty">Пусто</span>
              </span>
            </div>
          );
        })}
      </div>
    );
  };

  // ── Инвентарь ──
  const renderInventory = () => {
    const rows = character.inventory_items ?? [];
    if (asIcons) {
      return (
        <div className="forge-spell-icon-grid sheet-inv-icon-grid">
          {rows.map((row) => {
            const card = cardMap.get(row.card_id);
            return (
              <button
                key={row.card_id}
                type="button"
                className="forge-spell-icon ready sheet-inv-tile-icon"
                title={card?.name ?? row.card_id}
                onClick={() => { if (card) openInventoryItem(card); }}
                {...hoverHandlers(card)}
              >
                <img
                  src={card?.image_url?.trim() || '/default_image.png'}
                  alt={card?.name ?? row.card_id}
                  onError={(e) => { (e.target as HTMLImageElement).src = '/default_image.png'; }}
                />
                {row.qty > 1 && <span className="forge-spell-badge">×{row.qty}</span>}
              </button>
            );
          })}
        </div>
      );
    }
    return (
      <div className="sheet-item-cols">
        {rows.map((row) => {
          const card = cardMap.get(row.card_id);
          if (!card) return null;
          return (
            <SheetItemRow
              key={row.card_id}
              card={card}
              qty={row.qty}
              onClick={() => openInventoryItem(card)}
              {...hoverHandlers(card)}
            />
          );
        })}
      </div>
    );
  };

  // ── Результаты поиска (в том же виде, что инвентарь; клик — добавить) ──
  const renderSearchResults = () => {
    if (asIcons) {
      return (
        <div className="forge-spell-icon-grid sheet-inv-icon-grid">
          {searchResults.map((card) => (
            <button
              key={card.id}
              type="button"
              className="forge-spell-icon ready sheet-inv-tile-icon"
              title={`${card.name} — добавить`}
              disabled={busy}
              onClick={() => handleAdd(card)}
              {...hoverHandlers(card)}
            >
              <img
                src={card.image_url?.trim() || '/default_image.png'}
                alt={card.name}
                onError={(e) => { (e.target as HTMLImageElement).src = '/default_image.png'; }}
              />
              <span className="sheet-add-badge"><Plus size={12} /></span>
            </button>
          ))}
        </div>
      );
    }
    return (
      <div className="sheet-item-cols">
        {searchResults.map((card) => (
          <SheetItemRow
            key={card.id}
            card={card}
            onClick={() => handleAdd(card)}
            right={<span className="sheet-add-chip"><Plus size={14} /></span>}
            {...hoverHandlers(card)}
          />
        ))}
      </div>
    );
  };

  const dialogCardAttuned = dialog ? attuned.includes(dialog.card.id) : false;

  const body = (
    <>
      {error && <p className="issues">{error}</p>}

      <div className="sheet-equip-topbar">
        <div className="sheet-stat"><span>Вес</span><strong>{weight.toFixed(1)} / {capacity} фн</strong></div>
        <button
          type="button"
          className="sheet-stat sheet-attune-open"
          onClick={() => setAttuneOpen(true)}
          title="Управление настройкой на предметы"
        >
          <span><Sparkles size={12} /> Настройка</span>
          <strong>{attuned.length} / {MAX_ATTUNED}</strong>
        </button>
        <div className="sheet-stat sheet-stat-wallet" title="Кошелёк (золото / серебро / медь)">
          <span>Кошелёк</span>
          <strong className="sheet-wallet">
            {(['gold', 'silver', 'copper'] as const).map((cur) => (
              <span key={cur} className="sheet-wallet-coin">
                {wallet[cur] || 0}
                <img
                  src={getCurrencyIconPath(cur)}
                  alt={getCurrencyInfo(cur).short}
                  title={getCurrencyInfo(cur).label}
                  style={currencyIconStyle}
                />
              </span>
            ))}
          </strong>
        </div>
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
        {searchResults.length > 0 && renderSearchResults()}
      </div>

      <div className="sheet-group">
        <h3 className="sheet-h3">Слоты</h3>
        {renderSlots()}
      </div>

      <div className="sheet-group">
        <h3 className="sheet-h3">Инвентарь</h3>
        {!character.inventory_items?.length && <p className="forge-note">Пусто — найдите предмет выше и нажмите «Добавить».</p>}
        {renderInventory()}
      </div>

      {hoveredItem && !dialog && (
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

      {dialog && (
        <EquipItemDialog
          card={dialog.card}
          occupant={dialog.mode === 'inventory' ? dialog.occupant : null}
          mode={dialog.mode}
          busy={busy}
          needsAttunement={!!dialog.card.requires_attunement}
          attuned={dialogCardAttuned}
          canChangeAttunement={canChangeAttunement}
          onEquip={() => handleEquip(dialog.card)}
          onUnequip={() => { if (dialog.mode === 'equipped') handleUnequip(dialog.slot); }}
          onRemove={() => handleRemove(dialog.card.id)}
          onToggleAttune={() => handleToggleAttune(dialog.card.id)}
          onClose={() => setDialog(null)}
        />
      )}

      {attuneOpen && (
        <SheetAttunementDialog
          attunedCards={attunedCards}
          attunableCards={attunableCards}
          max={MAX_ATTUNED}
          canChange={canChangeAttunement}
          busy={busy}
          onToggle={handleToggleAttune}
          onClose={() => setAttuneOpen(false)}
        />
      )}
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
