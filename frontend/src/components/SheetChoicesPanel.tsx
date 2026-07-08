import { useState } from 'react';
import { charactersV3Api } from '../character/api';
import type { ForgeCharacter } from '../character/types';
import type { PendingChoice } from '../mechanics/collectChoices';
import { ChoiceResolver } from '../character/components';

/**
 * Слайс 5: выборы способностей «в игре» (choice context:'in_play') — разрешаются на ЛИСТЕ,
 * а не в кузне. Значение хранится в turn_state.inPlayChoices (патчится runtime-эндпоинтом,
 * без изменений схемы БД) и подмешивается к resolvedChoices в characterToDraft → резолвер
 * применяет грант так же, как выбор кузни. Можно перевыбрать в любой момент (напр. после отдыха).
 */
export default function SheetChoicesPanel({ character, choices, resolved, onUpdated }: {
  character: ForgeCharacter;
  choices: PendingChoice[];
  resolved: Record<string, string[]>;
  onUpdated: (c: ForgeCharacter) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!choices.length) return null;

  const setResolved = async (choiceId: string, vals: string[]) => {
    setBusy(true);
    setError(null);
    try {
      const prev = (character.turn_state?.inPlayChoices as Record<string, string[]> | undefined) || {};
      const turn_state = { ...(character.turn_state || {}), inPlayChoices: { ...prev, [choiceId]: vals } };
      const updated = await charactersV3Api.patchRuntime(character.id, { turn_state });
      onUpdated(updated);
    } catch (e) {
      console.error('in-play choice', e);
      setError('Не удалось сохранить выбор');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="sheet-panel">
      <h2 className="sheet-h2">Выборы способностей</h2>
      {error && <p className="issues">{error}</p>}
      <div style={busy ? { opacity: 0.6, pointerEvents: 'none' } : undefined}>
        {choices.map((pc) => (
          <ChoiceResolver
            key={pc.id}
            choice={pc}
            value={resolved[pc.id] || []}
            onChange={(v) => setResolved(pc.id, v)}
          />
        ))}
      </div>
      <p className="forge-note" style={{ marginTop: 8 }}>
        Выбор применяется сразу и сохраняется. Переключить можно в любой момент (напр. после отдыха).
      </p>
    </section>
  );
}
