import {useEffect, useMemo, useState} from 'react';
import {useBasicActions} from '../character/basicActions';
import {collectSheetCombatActionInventory} from '../character/sheetCombatTargetRuntime';
import type {SheetCombatActionInventory} from '../character/sheetCombatRuntimeFactory';
import {buildSheetCanonicalRuntime} from '../character/sheetCanonicalWorld';
import {projectRunnableSheetCanonicalActions} from '../character/sheetCanonicalActionProjection';
import {actorPassiveToggles} from '../character/actorPassiveToggles';
import {usePassivePreferences} from '../character/passivePreferences';
import SheetPassiveToggle from './SheetPassiveToggle';

type Input = Parameters<typeof buildSheetCanonicalRuntime>[0];
export default function SheetTogglePassives({character, assembled, ruleState, runtime, characterContext, passives, cards, readOnly = false}: {
  character: Input['character'] & Parameters<typeof collectSheetCombatActionInventory>[0]['character'];
  assembled: Input['assembled']; ruleState: Input['ruleState']; runtime: Input['runtime'] | null;
  characterContext: Input['characterContext'] | null; passives: NonNullable<Input['passives']>;
  cards: ReadonlyMap<string, NonNullable<Input['cards']>[number]>; readOnly?: boolean;
}) {
  const basics = useBasicActions();
  const [preferences, setPreference] = usePassivePreferences();
  const [inventory, setInventory] = useState<SheetCombatActionInventory | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let current = true;
    setInventory(null); setError('');
    if (runtime && characterContext) void collectSheetCombatActionInventory({character, assembled, runtime, cards,
      basicActions: basics, requiresMasteryCatalog: Boolean(characterContext.weaponMasteries?.length)})
      .then(value => { if (current) setInventory(value); })
      .catch(() => { if (current) setError('Не удалось загрузить переключаемые пассивы. Обновите лист.'); });
    return () => { current = false; };
  }, [character, assembled, runtime, cards, basics, characterContext]);
  const display = useMemo(() => {
    if (!inventory || !runtime || !characterContext) return {toggles: [], error: ''};
    try {
      const projection = projectRunnableSheetCanonicalActions({actions: inventory.actions, equipment: runtime.equipment,
        cards, passives, variables: characterContext.variables, abilityMods: characterContext.abilityMods});
      const canonical = buildSheetCanonicalRuntime({character, assembled, ruleState, runtime, characterContext, passives,
        sheetActions: projection.actions, grantedEffects: inventory.grantedEffects, masteryEffects: inventory.masteryEffects, cards: [...cards.values()]});
      const presentation = Object.fromEntries(projection.actions.flatMap(action => (canonical.actionsFor?.(action) ?? [canonical.actionFor(action)])
        .map(rule => [rule.id, {imageUrl: action.imageUrl, actionRef: action.actionRef, spellRef: action.spellRef}])));
      return {toggles: actorPassiveToggles(canonical.world.actors[canonical.actorId], canonical.actions, presentation), error: ''};
    } catch { return {toggles: [], error: 'Не удалось собрать переключаемые пассивы из правил персонажа.'}; }
  }, [inventory, runtime, characterContext, character, assembled, ruleState, passives, cards]);
  return <section className="sheet-feature-section" aria-label="Переключаемые пассивы">
    <h3>Переключаемые пассивы</h3><div className="sheet-feature-section__entities">
      {error || display.error ? <p role="status">{error || display.error}</p> : !inventory ? <small>Загрузка…</small>
        : display.toggles.map(toggle => <SheetPassiveToggle key={toggle.id} toggle={toggle}
          enabled={preferences[toggle.id] ?? toggle.defaultEnabled} disabled={readOnly} onChange={setPreference}/>)}
    </div>
  </section>;
}
