import type { Dispatch, SetStateAction } from 'react';
import ChoiceResolver from '../character/ChoiceResolver';
import DialogShell from '../components/DialogShell';
import type { ChoiceDialogState, ChoiceResult } from './ChoiceDialogContext';

export default function ChoiceDialogHost({ dialog, values, ready, setValues, finish }: {
  dialog: ChoiceDialogState; values: Record<string, string[]>; ready: boolean;
  setValues: Dispatch<SetStateAction<Record<string, string[]>>>; finish: (result: ChoiceResult) => void;
}) {
  return (<DialogShell label={dialog.title} onCancel={() => finish(null)} wrap
          initialFocus={dialog.options?.presentation === 'levelup' ? 'dialog' : 'first'}
          className={dialog.options?.presentation === 'levelup' ? 'forge-choice-dialog' : undefined}>
              <div className="dice-dialog-title">{dialog.title}</div>
              <div className="dice-dialog-summary">{dialog.options?.summary ?? 'Выберите вариант применения:'}</div>
              <div className="dice-dialog-list">
                {dialog.choices.map((c) => (
                  <ChoiceResolver
                    key={c.id}
                    choice={c}
                    value={values[c.id] || []}
                    feats={dialog.options?.feats}
                    groupSpellLevels={dialog.options?.presentation === 'levelup'}
                    unavailableOptions={dialog.options?.unavailableOptions?.(c, values[c.id] || [])}
                    onChange={(v) => setValues((prev) => ({ ...prev, [c.id]: v }))}
                  />
                ))}
              </div>
              <div className="dice-dialog-actions">
                <button
                  type="button"
                  className="dice-dialog-btn primary"
                  disabled={!ready}
                  aria-description={ready ? undefined : 'Сделайте выбор'}
                  onClick={() => finish(values)}
                >
                  Применить
                </button>
                <button type="button" className="dice-dialog-btn ghost" onClick={() => finish(null)}>
                  Отмена
                </button>
              </div>
        </DialogShell>);
}
