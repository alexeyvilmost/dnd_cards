import {useEffect, useState} from 'react';
import {useBasicActions} from '../character/basicActions';
import {loadSheetCanonicalParticipant} from '../character/sheetCombatTargetRuntime';
import type {ForgeCharacter} from '../character/types';
import type {buildSheetCanonicalRuntime} from '../character/sheetCanonicalWorld';
import {actorPassiveToggles, type PresentedPassiveToggle} from '../character/actorPassiveToggles';
import {usePassivePreferences} from '../character/passivePreferences';
import SheetPassiveToggle from './SheetPassiveToggle';

type Input = Parameters<typeof buildSheetCanonicalRuntime>[0];
export default function SheetTogglePassives({character, cards, readOnly = false}: {
  character: ForgeCharacter;
  assembled: Input['assembled']; ruleState: Input['ruleState']; runtime: Input['runtime'] | null;
  characterContext: Input['characterContext'] | null; passives: NonNullable<Input['passives']>;
  cards: ReadonlyMap<string, NonNullable<Input['cards']>[number]>; readOnly?: boolean;
}) {
  const basics = useBasicActions();
  const [preferences, setPreference] = usePassivePreferences();
  const [toggles, setToggles] = useState<PresentedPassiveToggle[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let current = true;
    setToggles(null); setError('');
    void loadSheetCanonicalParticipant({character, cards, basicActions: basics})
      .then(participant => {
        if (!current) return;
        const canonical = participant.canonical;
        setToggles(actorPassiveToggles(canonical.world.actors[canonical.actorId], canonical.actions, participant.actionPresentation));
      })
      .catch(() => { if (current) setError('Не удалось загрузить переключаемые пассивы. Обновите лист.'); });
    return () => { current = false; };
  }, [character, cards, basics]);
  return <section className="sheet-feature-section" aria-label="Переключаемые пассивы">
    <h3>Переключаемые пассивы</h3><div className="sheet-feature-section__entities">
      {error ? <p role="status">{error}</p> : !toggles ? <small>Загрузка…</small>
        : toggles.map(toggle => <SheetPassiveToggle key={toggle.id} toggle={toggle}
          enabled={preferences[toggle.id] ?? toggle.defaultEnabled} disabled={readOnly} onChange={setPreference}/>)}
    </div>
  </section>;
}
