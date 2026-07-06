/**
 * Регрессия бага «Оборона не даёт +1 КЗ» на живом персонаже Морячок-воин
 * (ab78d857). Гейт MVP_CONTENT=1, ходит в прод.
 *
 * Цепочка загрузки сохранённого персонажа (characterToDraft → loadBundle →
 * assemble → resolveCharacterRules → breakdownValue) должна давать +1 КЗ от
 * стиля и в шапке листа, и в «КД (расчёт)» панели экипировки (раньше панель
 * считала голым computeAC и теряла modifier-пассивки).
 */
import { describe, expect, it } from 'vitest';

// apiClient (axios) читает localStorage в интерсепторе токена — в node его нет.
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => store.clear(),
    key: () => null,
    get length() { return store.size; },
  } as Storage;
}
import { assemble, loadBundle } from '../character/assemble';
import { characterToDraft } from '../character/forgeHelpers';
import { charactersV3Api } from '../character/api';
import { resolveCharacterRules } from '../character/rules/resolveCharacterRules';
import { collectPassiveMechanics } from '../character/resourceInit';
import { collectItemMechanics } from '../character/attunement';
import { collectEquippedCards } from '../character/inventory';
import { buildCharacterContext, forgeToRuntimeState } from '../character/runtime';
import { breakdownValue } from '../engine/breakdown';
import { cardsApi } from '../api/client';
import type { Card } from '../types';

const RUN = !!process.env.MVP_CONTENT;
const CHAR_ID = 'ab78d857-dc94-4081-a949-562e808c5e9c';

describe.skipIf(!RUN)('Репро: Морячок-воин, стиль «Оборона» (+1 КЗ)', () => {
  it('цепочка загрузка → сборка → правила → КЗ листа', async () => {
    const c = await charactersV3Api.get(CHAR_ID);
    console.log('[repro] class_id =', c.class_id, 'race_id =', c.race_id, 'armor_class(db) =', c.armor_class);
    console.log('[repro] abilities =', JSON.stringify(c.abilities));
    console.log('[repro] resolved_choices keys:');
    for (const [k, v] of Object.entries(c.resolved_choices || {})) {
      console.log('   ', k, '=>', JSON.stringify(v));
    }

    const draft = characterToDraft(c);
    console.log('[repro] draft.resolvedChoices keys:', Object.keys(draft.resolvedChoices));

    const bundle = await loadBundle(draft);
    console.log('[repro] bundle.feats =', bundle.feats.map((f) => `${f.name} (${f.id})`));
    console.log('[repro] bundle.effects =', bundle.effects.map((e) => `${e.effect.card_number || e.effect.id} <- ${e.origin.kind}:${e.origin.id}`));

    const assembled = assemble({ ...bundle, spells: [] }, draft);
    const styleEffect = assembled.effects.find((e) => e.effect.card_number === 'fs_defense');
    console.log('[repro] fs_defense в сборке:', !!styleEffect);

    // Эффект(ы), содержащие choice(source:"feat") — печатаем, какой instance id получится.
    for (const { effect, origin } of assembled.effects) {
      const effs = (effect.mechanics as { effects?: Record<string, unknown>[] } | null)?.effects;
      if (!Array.isArray(effs)) continue;
      const scanChoice = (p: Record<string, unknown>) => {
        if (p?.kind !== 'choice') return;
        const opts = (p.options || {}) as Record<string, unknown>;
        if (String(opts.source) !== 'feat') return;
        const instanceId = `${origin.kind}:${origin.id}:${effect.id}:${String(p.id ?? 'choice')}`;
        console.log('[repro] choice(source:feat) instanceId =', instanceId,
          '| в draft.resolvedChoices?', instanceId in draft.resolvedChoices);
      };
      for (const it of effs) {
        if ((it as Record<string, unknown>)?.kind) scanChoice(it as Record<string, unknown>);
        else if ((it as Record<string, unknown>)?.resolution === 'auto' && Array.isArray((it as Record<string, unknown>).result)) {
          for (const p of (it as Record<string, unknown>).result as Record<string, unknown>[]) scanChoice(p);
        }
      }
    }

    const ruleState = resolveCharacterRules({ draft, assembled });
    console.log('[repro] appliedGrants(feat) =', ruleState.appliedGrants.filter((g) => g.kind === 'feat').map((g) => g.value));
    console.log('[repro] ruleState.armorClass =', ruleState.armorClass);

    // КЗ листа — как в CharacterSheetMVP: пассивки (эффекты + предметы),
    // надетые карты в контексте, breakdownValue.
    const runtimeState = forgeToRuntimeState(c);
    const equipIds = new Set<string>();
    for (const row of c.inventory_items ?? []) equipIds.add(row.card_id);
    for (const cid of Object.values(c.equipment ?? {})) if (cid) equipIds.add(cid);
    const equipCards = new Map<string, Card>();
    for (const cid of equipIds) {
      try { equipCards.set(cid, await cardsApi.getCard(cid)); } catch { /* skip */ }
    }
    const passives = [
      ...collectPassiveMechanics(assembled),
      ...collectItemMechanics(c.equipment ?? {}, equipCards, c.turn_state).map((im) => im.mechanics),
    ];
    const equipped = collectEquippedCards(runtimeState.equipment, equipCards);
    const ctx = buildCharacterContext(ruleState, draft, equipped, assembled.klass);
    const ac = breakdownValue('ac', ctx, runtimeState, passives);
    console.log('[repro] КЗ шапки листа =', ac.value, 'части:', JSON.stringify(ac.parts));

    // «КД (расчёт)» — как SheetEquipmentPanel (после фикса: breakdownValue).
    const panelCtx = buildCharacterContext(
      ruleState,
      { level: c.level, abilities: c.abilities ?? {} },
      equipped,
      null,
    );
    const panelAc = breakdownValue('ac', panelCtx, runtimeState, passives);
    console.log('[repro] КД (расчёт) панели =', panelAc.value);

    // Без доспеха (пустая экипировка): 10 + ЛВК(1) + Оборона(1) = 12.
    const nakedState = { ...runtimeState, equipment: {} };
    const nakedAc = breakdownValue('ac', ctx, nakedState, passives);
    console.log('[repro] КЗ без доспеха =', nakedAc.value);

    expect(styleEffect, 'эффект fs_defense должен быть в сборке').toBeTruthy();
    expect(ac.parts.some((p) => p.value === 1 && p.reason === 'эффект'), '+1 от «Обороны» в шапке').toBe(true);
    expect(nakedAc.value, 'КЗ без доспеха: 10 + ЛВК + Оборона').toBe(ruleState.armorClass + 1); // = 12
    expect(panelAc.value, '«КД (расчёт)» совпадает с шапкой').toBe(ac.value);
  }, 120_000);
});
