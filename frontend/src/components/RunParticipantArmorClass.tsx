import { useEffect, useState } from 'react';
import { loadSheetCanonicalParticipant } from '../character/sheetCombatTargetRuntime';
import type { ForgeCharacter } from '../character/types';
import { effectiveArmorClass } from '../rules-core/actorArmorClass';

/** Camp uses the sheet's equipped canonical actor, not the forge's saved
 * unequipped armor_class. This projection is read-only. */
export default function RunParticipantArmorClass({ character }: { character: ForgeCharacter }) {
  const [projection, setProjection] = useState<{ character: ForgeCharacter; value?: number; error?: string }>();
  useEffect(() => {
    let active = true;
    void loadSheetCanonicalParticipant({ character, cards: new Map() }).then(participant => {
      const actor = participant.canonical.world.actors[character.id];
      if (!actor) throw new Error('В собранном листе отсутствует участник');
      const value = effectiveArmorClass(actor);
      if (active) setProjection({ character, value });
    }).catch(cause => {
      if (active) setProjection({ character, error: cause instanceof Error ? cause.message : 'Не удалось собрать лист' });
    });
    return () => { active = false; };
  }, [character]);
  const current = projection?.character === character ? projection : undefined;
  return <span aria-live="polite" aria-description={current?.error}>КД {current?.error ? 'недоступна' : current?.value ?? '…'}</span>;
}
