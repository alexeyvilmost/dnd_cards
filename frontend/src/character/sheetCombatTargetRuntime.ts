import type { Action, Card, PassiveEffect } from '../types';
import { actionsApi, effectsApi } from '../api/client';
import { collectPassiveMechanics } from './resourceInit';
import {
  collectGrantActionSlugs,
  collectGrantEffectSlugs,
  collectSheetActions,
  type GrantedAction,
  type SheetAction,
} from './actionSheet';
import { loadAssembly } from './assemble';
import type { AssembledCharacter } from './assemble';
import { collectItemMechanics } from './attunement';
import { characterToDraft } from './forgeHelpers';
import { buildCharacterContext, forgeToRuntimeState } from './runtime';
import { resolveCharacterRules } from './rules/resolveCharacterRules';
import { buildSheetCanonicalRuntime } from './sheetCanonicalWorld';
import type { SheetCombatParticipantSeed } from './sheetCombatSession';
import { isCharacterReadOnly, type ForgeCharacter } from './types';
import { projectRunnableSheetCanonicalActions } from './sheetCanonicalActionProjection';
import type { RuntimeState } from '../mvp/contracts';
import type { ActorState } from '../rules-core/domain';
import { loadMasteryEffectsStrict } from '../utils/mastery';

export interface SheetCombatActionInventory {
  actions: SheetAction[];
  grantedEffects: NonNullable<ActorState['grantedEffects']>;
  masteryEffects: NonNullable<ActorState['masteryEffects']>;
}

/**
 * Builds the same complete, data-owned action inventory used by the sheet.
 * Keeping this as an explicit adapter prevents solo combat from silently
 * dropping carried item actions, species/class grants, containers, or weapon
 * mastery catalogs at the sheet -> encounter boundary.
 */
export async function collectSheetCombatActionInventory(input: {
  assembled: AssembledCharacter;
  character: Pick<ForgeCharacter, 'level' | 'turn_state'>;
  runtime: RuntimeState;
  basicActions?: readonly Action[];
  cards: ReadonlyMap<string, Card>;
  resolveAction?: (reference: string) => Promise<Action>;
  resolveEffect?: (reference: string) => Promise<PassiveEffect>;
  masteryCatalog?: readonly PassiveEffect[];
  /** Only actors with an owned mastery choice require the authoritative catalog. */
  requiresMasteryCatalog?: boolean;
  loadMasteryCatalog?: () => Promise<readonly PassiveEffect[]>;
}): Promise<SheetCombatActionInventory> {
  const resolveAction = input.resolveAction ?? actionsApi.getAction;
  const resolveEffect = input.resolveEffect ?? effectsApi.getEffect;
  const cards = new Map(input.cards);
  // Load this authority boundary before projecting the rest of the inventory.
  // A character that owns masteries must never silently enter combat with an
  // empty catalog merely because some unrelated sheet projection failed first.
  const masteryRows = input.masteryCatalog
    ?? (input.requiresMasteryCatalog
      ? await (input.loadMasteryCatalog ?? loadMasteryEffectsStrict)()
      : []);
  const itemMechanics = collectItemMechanics(
    input.runtime.equipment,
    cards,
    input.character.turn_state,
    input.runtime.inventory,
  );

  const grantRefs = new Map<string, Omit<GrantedAction, 'action'>>();
  const collectActionGrants = (
    mechanics: Record<string, unknown> | null | undefined,
    sourceLabel: string,
    group: SheetAction['group'],
  ) => {
    for (const reference of collectGrantActionSlugs(mechanics, input.character.level)) {
      if (!grantRefs.has(reference)) grantRefs.set(reference, { sourceLabel, group });
    }
  };
  for (const item of itemMechanics) {
    collectActionGrants(item.mechanics, item.card.name, 'item');
  }
  for (const { effect, origin } of input.assembled.effects) {
    collectActionGrants(
      effect.mechanics as Record<string, unknown> | null | undefined,
      effect.name,
      origin.kind === 'race' ? 'race' : 'class',
    );
  }
  const grantedActions = await Promise.all([...grantRefs].map(async ([reference, grant]) => ({
    ...grant,
    action: await resolveAction(reference),
  })));

  const inventoryCardIds = new Set([
    ...input.runtime.inventory.map(({ cardId }) => cardId),
    ...Object.values(input.runtime.equipment).filter((id): id is string => Boolean(id)),
  ]);
  const containers = [...inventoryCardIds].flatMap((id) => {
    const card = cards.get(id);
    return card
      && (card.container_mode === 'all' || card.container_mode === 'choice')
      && Array.isArray(card.contents)
      && card.contents.length
      ? [card]
      : [];
  });
  const actions = collectSheetActions(
    input.assembled,
    itemMechanics,
    [...(input.basicActions ?? [])],
    grantedActions,
    containers,
    (id) => cards.get(id)?.name,
  );

  const effectReferences = [...new Set(actions.flatMap((action) => (
    collectGrantEffectSlugs(action.mechanics)
  )))];
  const grantedEffectRows = await Promise.all(effectReferences.map(async (reference) => (
    [reference, await resolveEffect(reference)] as const
  )));
  const grantedEffects: NonNullable<ActorState['grantedEffects']> = Object.fromEntries(
    grantedEffectRows.map(([reference, effect]) => [reference, {
      name: effect.name,
      mechanics: effect.mechanics,
      repeatable: effect.repeatable,
    }]),
  );

  const masteryEffects: NonNullable<ActorState['masteryEffects']> = {};
  for (const effect of masteryRows) {
    const projected = { name: effect.name, mechanics: effect.mechanics };
    masteryEffects[effect.id] = projected;
    // Weapon data may reference either immutable id or card number. Both keys
    // point to the same declaration; no mastery name is interpreted here.
    if (effect.card_number) masteryEffects[effect.card_number] = projected;
  }
  return { actions, grantedEffects, masteryEffects };
}

/**
 * Builds the other sheet's immutable actor/action projection before opening a
 * two-character command. Shield and future reactions therefore come from that
 * character's actual spell grants rather than a UI checkbox or spell name.
 */
export async function loadSheetCombatParticipant(input: {
  character: ForgeCharacter;
  basicActions?: readonly Action[];
  cards: ReadonlyMap<string, Card>;
}): Promise<SheetCombatParticipantSeed> {
  if (isCharacterReadOnly(input.character)) {
    throw new Error(`Персонаж «${input.character.name}» доступен только для чтения`);
  }
  if (input.character.current_encounter_id) {
    throw new Error(`Персонаж «${input.character.name}» уже связан с онлайн-боем`);
  }
  if (!Number.isSafeInteger(input.character.runtime_revision)
    || Number(input.character.runtime_revision) < 0) {
    throw new Error(`У персонажа «${input.character.name}» нет runtime_revision`);
  }
  const draft = characterToDraft(input.character);
  const assembled = await loadAssembly(draft);
  const ruleState = resolveCharacterRules({ draft, assembled });
  const runtime = forgeToRuntimeState(input.character);
  const equippedCards = Object.values(runtime.equipment)
    .flatMap((id) => id && input.cards.get(id) ? [input.cards.get(id)!] : []);
  const passives = collectPassiveMechanics(
    assembled,
    input.character.resolved_choices ?? {},
  );
  const cardsById = new Map(input.cards);
  const inventory = await collectSheetCombatActionInventory({
    assembled,
    character: input.character,
    runtime,
    basicActions: input.basicActions,
    cards: cardsById,
    requiresMasteryCatalog: ruleState.weaponMasteries.length > 0,
  });
  const actions = projectRunnableSheetCanonicalActions({
    actions: inventory.actions,
    equipment: runtime.equipment,
    cards: cardsById,
  }).actions;
  const characterContext = {
    ...buildCharacterContext(
      ruleState,
      { level: input.character.level, abilities: input.character.abilities ?? {} },
      equippedCards,
      assembled.klass,
    ),
    passives,
  };
  const canonical = buildSheetCanonicalRuntime({
    character: input.character,
    assembled,
    ruleState,
    sheetActions: actions,
    runtime,
    characterContext,
    passives,
    grantedEffects: inventory.grantedEffects,
    masteryEffects: inventory.masteryEffects,
    cards: [...input.cards.values()],
    ac: ruleState.armorClass,
  });
  return {
    character: input.character,
    // A spell's canonical rule action is identified by the immutable spell
    // entity, while its SheetAction id describes the grant row. Key the UI
    // projection by the executable id so combat renders the very same entity
    // icon and preview as the sheet instead of losing them at this boundary.
    actionPresentation: Object.fromEntries(actions.flatMap((action) => (
      (canonical.actionsFor?.(action) ?? [canonical.actionFor(action)])
        .map((canonicalAction) => [canonicalAction.id, {
        imageUrl: action.imageUrl,
        description: action.description,
        sourceLabel: action.sourceLabel,
        entityType: action.group === 'spell' ? 'spell' as const : 'action' as const,
        entityId: action.spellRef?.id ?? action.actionRef?.id ?? action.effectRef?.id,
        actionRef: action.actionRef,
        spellRef: action.spellRef,
        }] as const)
    ))),
    canonical,
  };
}
