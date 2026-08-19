import type { Action, Card } from '../types';
import { collectPassiveMechanics } from './resourceInit';
import { collectSheetActions } from './actionSheet';
import { loadAssembly } from './assemble';
import { characterToDraft } from './forgeHelpers';
import { buildCharacterContext, forgeToRuntimeState } from './runtime';
import { resolveCharacterRules } from './rules/resolveCharacterRules';
import { buildSheetCanonicalRuntime } from './sheetCanonicalWorld';
import type { SheetCombatParticipantSeed } from './sheetCombatSession';
import { isCharacterReadOnly, type ForgeCharacter } from './types';
import { projectRunnableSheetCanonicalActions } from './sheetCanonicalActionProjection';

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
  const collectedActions = collectSheetActions(
    assembled,
    [],
    [...(input.basicActions ?? [])],
    [],
    [],
    (id) => input.cards.get(id)?.name,
  );
  const actions = projectRunnableSheetCanonicalActions({
    actions: collectedActions,
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
    cards: [...input.cards.values()],
    ac: ruleState.armorClass,
  });
  return {
    character: input.character,
    // A spell's canonical rule action is identified by the immutable spell
    // entity, while its SheetAction id describes the grant row. Key the UI
    // projection by the executable id so combat renders the very same entity
    // icon and preview as the sheet instead of losing them at this boundary.
    actionPresentation: Object.fromEntries(actions.map((action) => [canonical.actionFor(action).id, {
      imageUrl: action.imageUrl,
      description: action.description,
      sourceLabel: action.sourceLabel,
      entityType: action.group === 'spell' ? 'spell' : 'action',
      entityId: action.spellRef?.id ?? action.actionRef?.id ?? action.effectRef?.id,
      actionRef: action.actionRef,
      spellRef: action.spellRef,
    }])),
    canonical,
  };
}
