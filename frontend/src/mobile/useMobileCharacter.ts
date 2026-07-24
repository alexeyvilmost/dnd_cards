import { useCallback, useEffect, useMemo, useState } from 'react';
import { cardsApi } from '../api/client';
import { charactersV3Api, type CharacterEventRow } from '../character/api';
import { loadAssembly, type AssembledCharacter } from '../character/assemble';
import { collectItemMechanics } from '../character/attunement';
import { characterToDraft } from '../character/forgeHelpers';
import { collectEquippedCards } from '../character/inventory';
import { collectPassiveMechanics } from '../character/resourceInit';
import { resolveCharacterRules } from '../character/rules/resolveCharacterRules';
import type { CharacterRuleState, RuntimeRuleSource } from '../character/rules/types';
import { buildCharacterContext, forgeToRuntimeState } from '../character/runtime';
import type { ForgeCharacter } from '../character/types';
import { breakdownValue } from '../engine/breakdown';
import type { EngineEvent, RuntimeState, ValueBreakdown } from '../mvp/contracts';
import type { Card } from '../types';

export interface MobileCharacterData {
  character: ForgeCharacter | null;
  assembled: AssembledCharacter | null;
  ruleState: CharacterRuleState | null;
  runtimeState: RuntimeState | null;
  equipCards: Map<string, Card>;
  passives: Record<string, unknown>[];
  sheetCtx: ReturnType<typeof buildCharacterContext> | null;
  acBreakdown: ValueBreakdown | null;
  maxHpBreakdown: ValueBreakdown | null;
  initiativeBreakdown: ValueBreakdown | null;
  speedBreakdown: ValueBreakdown | null;
  sizeBreakdown: ValueBreakdown | null;
  journal: CharacterEventRow[];
  loading: boolean;
  error: string | null;
  updateCharacter: (next: ForgeCharacter) => void;
  appendEvents: (events: EngineEvent[]) => Promise<void>;
  reloadJournal: () => Promise<void>;
}

/**
 * Общий data/controller-слой отдельного мобильного листа.
 *
 * UI мобильного листа независим, но правила, live-предметы, breakdown и
 * runtime остаются теми же, что у /characters-v3. Так мобильная версия не
 * превращается во второй несовместимый движок персонажа.
 */
export function useMobileCharacter(id: string | undefined): MobileCharacterData {
  const [character, setCharacter] = useState<ForgeCharacter | null>(null);
  const [assembled, setAssembled] = useState<AssembledCharacter | null>(null);
  const [equipCards, setEquipCards] = useState<Map<string, Card>>(new Map());
  const [journal, setJournal] = useState<CharacterEventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reloadJournal = useCallback(async () => {
    if (!id) return;
    try {
      setJournal(await charactersV3Api.getEvents(id));
    } catch {
      // Журнал — вспомогательная часть листа; ошибка не должна блокировать лист.
    }
  }, [id]);

  useEffect(() => {
    if (!id) {
      setLoading(false);
      setError('Персонаж не найден');
      return;
    }
    let stale = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const next = await charactersV3Api.get(id);
        const nextAssembly = await loadAssembly(characterToDraft(next));
        if (stale) return;
        setCharacter(next);
        setAssembled(nextAssembly);
        void reloadJournal();
      } catch (e) {
        console.error(e);
        if (!stale) setError('Не удалось загрузить лист персонажа');
      } finally {
        if (!stale) setLoading(false);
      }
    })();
    return () => { stale = true; };
  }, [id, reloadJournal]);

  const draft = useMemo(
    () => (character ? characterToDraft(character) : null),
    [character],
  );

  const equipCardIds = useMemo(() => {
    if (!character) return [];
    const ids = new Set<string>();
    for (const row of character.inventory_items ?? []) ids.add(row.card_id);
    for (const cardId of Object.values(character.equipment ?? {})) {
      if (cardId) ids.add(cardId);
    }
    return [...ids];
  }, [character]);

  useEffect(() => {
    if (!equipCardIds.length) {
      setEquipCards(new Map());
      return;
    }
    let stale = false;
    Promise.all(
      equipCardIds.map((cardId) =>
        cardsApi.getCard(cardId)
          .then((card) => [cardId, card] as const)
          .catch(() => null),
      ),
    ).then((entries) => {
      if (!stale) {
        setEquipCards(new Map(entries.filter((entry): entry is readonly [string, Card] => !!entry)));
      }
    });
    return () => { stale = true; };
  }, [equipCardIds.join('|')]);

  const runtimeState = useMemo(
    () => (character ? forgeToRuntimeState(character) : null),
    [character],
  );

  const itemMechanics = useMemo(
    () => (
      character
        ? collectItemMechanics(
          character.equipment ?? {},
          equipCards,
          character.turn_state,
          runtimeState?.inventory ?? [],
        )
        : []
    ),
    [character, equipCards, runtimeState],
  );

  const itemRuntimeSources = useMemo<RuntimeRuleSource[]>(
    () => itemMechanics.map((item) => ({
      source: { type: 'item', id: item.card.id, name: item.card.name },
      mechanics: item.mechanics,
    })),
    [itemMechanics],
  );

  const ruleState = useMemo(
    () => (
      draft && assembled
        ? resolveCharacterRules({ draft, assembled, runtimeSources: itemRuntimeSources })
        : null
    ),
    [draft, assembled, itemRuntimeSources],
  );

  const passives = useMemo<Record<string, unknown>[]>(
    () => {
      const base = assembled
        ? collectPassiveMechanics(assembled, character?.resolved_choices ?? {})
        : [];
      return [...base, ...itemMechanics.map((item) => item.mechanics)];
    },
    [assembled, character?.resolved_choices, itemMechanics],
  );

  const sheetCtx = useMemo(
    () => {
      if (!ruleState || !draft || !runtimeState) return null;
      const equipped = collectEquippedCards(runtimeState.equipment, equipCards);
      return buildCharacterContext(ruleState, draft, equipped, assembled?.klass ?? null);
    },
    [ruleState, draft, runtimeState, equipCards, assembled?.klass],
  );

  const valueBreakdown = useCallback(
    (key: Parameters<typeof breakdownValue>[0]): ValueBreakdown | null => {
      if (!sheetCtx || !runtimeState) return null;
      return breakdownValue(key, sheetCtx, runtimeState, passives);
    },
    [sheetCtx, runtimeState, passives],
  );

  const appendEvents = useCallback(async (events: EngineEvent[]) => {
    if (!id || !events.length) return;
    try {
      const rows = await charactersV3Api.postEvents(
        id,
        events.map((event) => ({ type: event.type, payload: event })),
      );
      setJournal((prev) => [...prev, ...rows]);
    } catch (e) {
      console.error(e);
    }
  }, [id]);

  return {
    character,
    assembled,
    ruleState,
    runtimeState,
    equipCards,
    passives,
    sheetCtx,
    acBreakdown: valueBreakdown('ac'),
    maxHpBreakdown: valueBreakdown('max_hp'),
    initiativeBreakdown: valueBreakdown('initiative'),
    speedBreakdown: valueBreakdown('speed'),
    sizeBreakdown: valueBreakdown('size'),
    journal,
    loading,
    error,
    updateCharacter: setCharacter,
    appendEvents,
    reloadJournal,
  };
}
