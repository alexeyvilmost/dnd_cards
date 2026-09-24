import type { Card, PassiveEffect } from '../types';
import type { AssembledCharacter } from '../character/assemblyFactory';
import { collectEffectGrantRefs, expandItemGrantedEffects } from '../character/assemble';
import { emptyDraft, type AbilityKey } from '../character/types';
import { ABILITY_IDS, SKILL_IDS, abilityMod } from '../character/rules/foundation';
import { resolveCharacterRules } from '../character/rules/resolveCharacterRules';
import { collectItemMechanics, MAX_ATTUNED } from '../character/attunement';
import { buildCharacterContext } from '../character/runtime';
import { EQUIPMENT_SLOTS, isWearingArmor } from '../engine/equipment';
import { armorClassValue, computeAC } from '../engine/ac';
import { breakdownValue } from '../engine/breakdown';
import { collectModifiers, foldModifiers } from '../engine/modifiers';
import type { CharacterContext, RuntimeState, ValueBreakdown } from '../mvp/contracts';
import { calculateSheet, type PaperEquipmentProjection, type PaperSheetDocument } from './model';
import { parsePaperEntityToken } from './references';

type Dict = Record<string, unknown>;
const cardId = (text: string | undefined): string | undefined => {
  const entity = parsePaperEntityToken(text ?? '');
  return entity?.type === 'card' ? entity.id : undefined;
};

function paperEquipment(document: PaperSheetDocument) {
  const equipment: RuntimeState['equipment'] = {};
  for (const slot of EQUIPMENT_SLOTS) equipment[slot] = cardId(document.fields[`equipment.${slot}`]) ?? null;
  const inventory: RuntimeState['inventory'] = [];
  const attuned: Array<{ index: number; id: string }> = [];
  for (const [key, value] of Object.entries(document.fields)) {
    const row = /^inventory\.(\d+)\.item$/.exec(key);
    if (row) {
      const id = cardId(value);
      const raw = document.fields[`inventory.${row[1]}.quantity`];
      const quantity = raw === undefined ? 1 : Number(raw);
      if (id && Number.isSafeInteger(quantity) && quantity > 0) inventory.push({ cardId: id, qty: quantity });
    }
    const attunement = /^attunementName(\d+)$/.exec(key);
    const id = attunement && document.checks[`attunement${attunement[1]}`] === true ? cardId(value) : undefined;
    if (id) attuned.push({ index: Number(attunement![1]), id });
  }
  return { equipment, inventory, attuned: [...new Set(attuned.sort((a, b) => a.index - b.index).map(entry => entry.id))].slice(0, MAX_ATTUNED) };
}

/** Only structured, present items are hydrated; prose and attack-row references do not imply ownership. */
export function referencedPaperItemIds(document: PaperSheetDocument): string[] {
  const { equipment, inventory, attuned } = paperEquipment(document);
  return [...new Set([...Object.values(equipment), ...inventory.map(row => row.cardId), ...attuned]
    .filter((id): id is string => Boolean(id)))];
}

function passiveMechanics(mechanics: Dict): boolean {
  const activation = mechanics.activation as Dict | undefined;
  return activation?.mode == null || activation.mode === 'passive';
}

function paperEffectInput(document: PaperSheetDocument, cards: Map<string, Card>) {
  const state = paperEquipment(document);
  const values = calculateSheet(document).values;
  const valid = ABILITY_IDS.every(ability => Number.isFinite(values[ability])) && Number.isFinite(values.level);
  const draft = { ...emptyDraft(), abilityMethod: 'manual' as const, level: values.level,
    abilities: Object.fromEntries(ABILITY_IDS.map(ability => [ability, values[ability]])) };
  const items = valid ? collectItemMechanics(state.equipment, cards, { attuned_ids: state.attuned }, state.inventory)
    .filter(item => passiveMechanics(item.mechanics))
    .map(item => ({ id: item.card.id, name: item.card.name, mechanics: item.mechanics }))
    .sort((first, second) => first.id.localeCompare(second.id)) : [];
  const key = JSON.stringify({ level: draft.level, abilities: draft.abilities, items });
  return { draft, items, key };
}

export interface PaperGrantedEffectSnapshot {
  /** Identifies the exact eligible items and draft used by the asynchronous assembler. */
  key: string;
  effects: PassiveEffect[];
}

/** Unrelated paper edits do not restart loading; gates, mechanics, level, and abilities do. */
export function paperEquipmentEffectsKey(document: PaperSheetDocument, cards: Map<string, Card>): string {
  return paperEffectInput(document, cards).key;
}

/** The same recursive/deduplicating effect expansion used by CharacterSheetMVP. */
export async function loadPaperEquipmentEffects(document: PaperSheetDocument, cards: Map<string, Card>): Promise<PaperGrantedEffectSnapshot> {
  const { draft, items, key } = paperEffectInput(document, cards);
  const hasGrants = items.some(item => collectEffectGrantRefs(item.mechanics, item.id,
    { kind: 'other', id: item.id, name: item.name }, draft).length > 0);
  const effects = hasGrants ? await expandItemGrantedEffects(items, draft) : [];
  return { key, effects };
}

/** Return this cleanup from a React effect so late success/error callbacks cannot replace newer state. */
export function startPaperEquipmentEffectLoad(
  document: PaperSheetDocument,
  cards: Map<string, Card>,
  onLoaded: (snapshot: PaperGrantedEffectSnapshot) => void,
  onError?: (error: unknown) => void,
): () => void {
  let current = true;
  void loadPaperEquipmentEffects(document, cards).then(
    snapshot => { if (current) onLoaded(snapshot); },
    error => { if (current) onError?.(error); },
  );
  return () => { current = false; };
}

function baseAssembly(): AssembledCharacter {
  // A paper document declares its own base, not a fictitious class or species.
  // resolveCharacterRules does not consume assembled.derived; it is only required by the shared type.
  return {
    race: null, klass: null, background: null, feats: [], effects: [], actions: [], spells: [],
    resources: [], variables: {}, pendingChoices: [], featAbilityIncreases: [],
    derived: { proficiencyBonus: 0, maxHP: 0, initiative: 0, ac: 0, speed: 0,
      abilityMods: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 }, spellcasting: null },
  };
}

function manualTraining(document: PaperSheetDocument): Dict {
  const result: Dict[] = [];
  for (const skill of SKILL_IDS) {
    const rank = document.training[skill] ?? 0;
    if (rank) result.push({ kind: 'grant_proficiency', prof: 'skill', value: skill });
    if (rank === 2) result.push({ kind: 'grant_expertise', prof: 'skill', value: skill });
  }
  for (const ability of ABILITY_IDS) {
    if (document.training[`save.${ability}`]) result.push({ kind: 'grant_proficiency', prof: 'saving_throw', value: ability });
  }
  return { effects: [{ resolution: 'auto', result }] };
}

function changedSources(before: ValueBreakdown, after: ValueBreakdown): string[] {
  const key = (part: ValueBreakdown['parts'][number]) => `${part.source}|${part.reason ?? ''}|${part.value}`;
  const existing = new Set(before.parts.map(key));
  return [...new Set([
    ...after.parts.filter(part => !existing.has(key(part))).map(part => part.source),
    ...(after.selectedMethod?.name !== before.selectedMethod?.name && after.selectedMethod ? [after.selectedMethod.name] : []),
  ])];
}

/** An explicit paper AC is the unarmored base; armor replaces it. Modifier algebra remains shared. */
function paperArmorClass(context: CharacterContext, runtime: RuntimeState, passives: Dict[], manualAc?: number): ValueBreakdown {
  if (manualAc === undefined || isWearingArmor(runtime, context.knownCards)) return armorClassValue(context, runtime, passives);
  const empty = { ...runtime, equipment: {} };
  const bare = computeAC(context, empty, []);
  const equipment = computeAC(context, runtime, []);
  const shieldBonus = equipment.value - bare.value;
  const collected = collectModifiers(runtime, passives, {
    roll: 'ac', filter: { wearingArmor: false },
    formulaCtx: { abilityMods: context.abilityMods, profBonus: context.profBonus, selfLevel: context.level,
      classLevels: context.classLevels, spellcastingMod: context.spellcastingMod,
      characterSpeed: context.characterSpeed, variables: context.variables },
    evalCtx: { character: context, state: runtime },
  });
  const folded = foldModifiers(manualAc + shieldBonus, collected);
  return { value: folded.value, parts: [
    { value: manualAc, source: 'КД листа', reason: 'введённая база' },
    ...equipment.parts.filter(part => !bare.parts.some(other => other.source === part.source && other.reason === part.reason && other.value === part.value)),
    ...folded.parts,
  ] };
}

/**
 * Synchronous view of passive item mechanics and an optional asynchronously expanded grant_effect snapshot.
 * Does not execute active capabilities, mutate HP, or persist a character.
 * Item grants go through resolveCharacterRules; numeric bonuses go through breakdown only, once.
 */
export function projectPaperEquipment(
  document: PaperSheetDocument,
  cards: Map<string, Card>,
  grantedSnapshot?: PaperGrantedEffectSnapshot | null,
): PaperEquipmentProjection {
  const itemState = paperEquipment(document);
  const base = calculateSheet(document);
  // Invalid user formulas keep their own errors; do not replace them with fabricated character values.
  if (ABILITY_IDS.some(ability => !Number.isFinite(base.values[ability])) || !Number.isFinite(base.values.level)) return {};
  const equipment = Object.fromEntries(Object.entries(itemState.equipment)
    .map(([slot, id]) => [slot, id && cards.has(id) ? id : null]));
  const runtime: RuntimeState = {
    equipment, inventory: itemState.inventory, activeEffects: [], resources: {}, maxResources: {},
    hp: { current: base.values.hpCurrent ?? 0, max: base.values.hpMax ?? 0, temp: base.values.hpTemp ?? 0 },
  };
  const items = collectItemMechanics(equipment, cards, { attuned_ids: itemState.attuned }, runtime.inventory)
    .filter(item => passiveMechanics(item.mechanics));
  if (!items.length && !Object.values(equipment).some(Boolean)) return {};
  // Reject old grants synchronously, even before the component's effect cleanup runs after unequipping.
  const grantedEffects = grantedSnapshot?.key === paperEquipmentEffectsKey(document, cards)
    ? grantedSnapshot.effects.filter(effect => effect.mechanics && passiveMechanics(effect.mechanics)) : [];
  const grantedMechanics = grantedEffects.map(effect => ({ ...effect.mechanics, id: effect.id, name: effect.name }));
  const passives = [...items.map(item => item.mechanics), ...grantedMechanics];
  const draft = { ...emptyDraft(), abilityMethod: 'manual' as const, level: base.values.level,
    abilities: Object.fromEntries(ABILITY_IDS.map(ability => [ability, base.values[ability]])) };
  const assembled = baseAssembly();
  const declared = { source: { type: 'character_base' as const, id: 'paper-manual', name: 'Лист' }, mechanics: manualTraining(document) };
  const baselineRules = resolveCharacterRules({ draft, assembled, runtimeSources: [declared] });
  const rules = resolveCharacterRules({ draft, assembled, runtimeSources: [
    declared,
    ...items.map(item => ({ source: { type: 'item' as const, id: item.card.id, name: item.card.name }, mechanics: item.mechanics })),
    // An item-granted effect keeps item semantics: stats/grants here, numeric modifiers in breakdown only.
    ...grantedEffects.map(effect => ({ source: { type: 'item' as const, id: effect.id, name: effect.name }, mechanics: effect.mechanics })),
  ] });
  const abilityScores: Partial<Record<AbilityKey, number>> = {};
  const sources: Record<string, string[]> = {};
  for (const ability of ABILITY_IDS) {
    if (rules.abilities[ability] !== base.values[ability]) {
      abilityScores[ability] = rules.abilities[ability];
      sources[ability] = [...new Set([
        ...(rules.abilitySources?.[ability] ?? []).filter(part => part.source !== 'Ручной ввод').map(part => part.source),
        ...(rules.abilityMethods?.[ability] ?? []).filter(method => method.value === rules.abilities[ability]).map(method => method.name),
      ])];
    }
  }
  // Formulas that depend on changed abilities are re-evaluated before adding item bonuses.
  const effective = calculateSheet(document, { abilityScores });
  const knownCards = [...cards.values()];
  const equippedCards = [...new Set(Object.values(equipment))].flatMap(id => id && cards.has(id) ? [cards.get(id)!] : []);
  const context: CharacterContext = {
    ...buildCharacterContext(rules, draft, equippedCards), knownCards, attunedIds: itemState.attuned,
    abilityScores: Object.fromEntries(ABILITY_IDS.map(ability => [ability, effective.values[ability]])),
    profBonus: effective.values.proficiency ?? rules.proficiencyBonus,
    abilityMods: Object.fromEntries(ABILITY_IDS.map(ability => [ability, effective.values[`${ability}Mod`] ?? abilityMod(rules.abilities[ability])])) as Record<AbilityKey, number>,
    baseSpeed: (effective.values.speed ?? 0) + rules.baseSpeed - baselineRules.baseSpeed,
    characterSpeed: effective.values.speed,
  };
  const neutral: CharacterContext = { ...context,
    saveProficiencies: baselineRules.proficiencies.savingThrows,
    skillProficiencies: baselineRules.proficiencies.skills, skillExpertise: baselineRules.expertise.skills,
    baseSpeed: effective.values.speed ?? 0,
  };
  const fieldOverrides: Record<string, number> = {};
  const projectDelta = (field: string, role: Parameters<typeof breakdownValue>[0]) => {
    const value = effective.values[field];
    if (!Number.isFinite(value) || effective.errors[field]) return;
    const before = breakdownValue(role, neutral, runtime, []);
    const after = breakdownValue(role, context, runtime, passives);
    if (before.value === after.value) return;
    fieldOverrides[field] = value + after.value - before.value;
    sources[field] = changedSources(before, after);
  };
  for (const ability of ABILITY_IDS) projectDelta(`save.${ability}`, `save:${ability}`);
  for (const skill of SKILL_IDS) projectDelta(`skill.${skill}`, `skill:${skill}`);
  projectDelta('initiative', 'initiative');
  projectDelta('passive', 'passive_perception');
  projectDelta('speed', 'speed');
  projectDelta('hpMax', 'max_hp');
  // Replacing a manual baseline by a delta is incorrect for multiply/set speed modifiers.
  if (fieldOverrides.speed !== undefined) fieldOverrides.speed = breakdownValue('speed', context, runtime, passives).value;
  const withoutEquipment = { ...runtime, equipment: {} };
  const originalContext: CharacterContext = { ...neutral, abilityScores: draft.abilities,
    abilityMods: Object.fromEntries(ABILITY_IDS.map(ability => [ability, base.values[`${ability}Mod`] ?? abilityMod(draft.abilities[ability])])) as Record<AbilityKey, number>,
  };
  const beforeAc = paperArmorClass(originalContext, withoutEquipment, [], base.values.ac);
  const afterAc = paperArmorClass(context, runtime, passives, effective.values.ac);
  if (!effective.errors.ac && afterAc.value !== beforeAc.value) {
    fieldOverrides.ac = afterAc.value;
    sources.ac = [...new Set([...changedSources(beforeAc, afterAc), ...(sources.dex ?? [])])];
  }
  // No blank AC is invented merely because an unrelated item is present.
  if (Object.keys(abilityScores).length === 0 && Object.keys(fieldOverrides).length === 0) return {};
  return { abilityScores, fieldOverrides, sources };
}
