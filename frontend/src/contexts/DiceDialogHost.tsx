import type { Dispatch, SetStateAction } from 'react';
import { Dices } from 'lucide-react';
import { summarizeDice } from '../engine/dicePlan';
import Dice3DOverlay from '../dice/Dice3DOverlay';
import SheetCheckRollDialog from '../components/SheetCheckRollDialog';
import type { DiceDialogState, DiceDecision } from './DiceDialogContext';

export default function DiceDialogHost({ dialog, values, setValues, targetId, setTargetId, show3dScene, setShow3dScene, finish }: {
  dialog: DiceDialogState; values: string[]; setValues: Dispatch<SetStateAction<string[]>>;
  targetId: string; setTargetId: Dispatch<SetStateAction<string>>;
  show3dScene: boolean; setShow3dScene: Dispatch<SetStateAction<boolean>>; finish: (decision: DiceDecision) => void;
}) {
  // Цель обязательна, только если есть из кого выбирать.
  const mustPickTarget = !!dialog?.needsTarget && !!dialog.targets?.length && !targetId;
  const withTarget = (d: DiceDecision): DiceDecision =>
    d.mode === 'cancel' ? d : { ...d, targetId: targetId || undefined };

  const parsed = dialog ? values.map((v, i) => {
    const n = parseInt(v, 10);
    const sides = dialog.plan[i].sides;
    return Number.isFinite(n) && n >= 1 && n <= sides ? n : null;
  }) : [];
  const manualReady = dialog ? parsed.every((v) => v !== null) : false;
  const show3d = !!dialog && !dialog.compactCheck && !dialog.confirmOnly && dialog.use3d && show3dScene;


  return <>
      {dialog?.compactCheck && <SheetCheckRollDialog key={dialog.id} title={dialog.title} preview={dialog.preview} request={dialog.compactCheck} onCancel={() => finish({ mode: 'cancel' })} onComplete={roll => finish({ mode: 'manual', values: roll.dice.map(die => die.result), roll })} />}
      <Dice3DOverlay
        active={show3d}
        requestKey={dialog?.id ?? ''}
        plan={dialog?.plan ?? []}
        title={dialog?.title ?? ''}
        preview={dialog?.preview}
        targets={dialog?.targets}
        needsTarget={dialog?.needsTarget}
        autoThrow={dialog?.autoThrow3d ?? false}
        targetId={targetId}
        onTargetChange={setTargetId}
        onComplete={(rolledValues) => finish(withTarget({ mode: 'manual', values: rolledValues }))}
        onCancel={() => finish({ mode: 'cancel' })}
        onFallback={() => setShow3dScene(false)}
      />
      {dialog && !dialog.compactCheck && !show3d && (
        <div className="dice-dialog-backdrop" onClick={() => finish({ mode: 'cancel' })}>
          <div className="dice-dialog-wrap" onClick={(e) => e.stopPropagation()}>
            {dialog.preview && <div className="dice-dialog-preview">{dialog.preview}</div>}
          <div className="dice-dialog" role="dialog" aria-label={dialog.confirmOnly ? 'Подтверждение действия' : 'Бросок кубов'}>
            <div className="dice-dialog-title">{dialog.title}</div>
            {!!dialog.targets?.length && (
              <div className="dice-dialog-target" style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '4px 0 10px' }}>
                <span style={{ fontSize: 13, color: '#d8b978', whiteSpace: 'nowrap' }}>Цель:</span>
                <select
                  value={targetId}
                  onChange={(e) => setTargetId(e.target.value)}
                  style={{ flex: 1, padding: '5px 8px', borderRadius: 6, border: '1px solid #6b5836', background: '#1c1813', color: '#e8e0d0', fontSize: 13 }}
                >
                  <option value="">— выберите цель —</option>
                  {dialog.targets.map((t) => (
                    <option key={t.id} value={t.id} disabled={t.disabled} aria-description={t.reason}>
                      {t.name}{t.disabled && t.reason ? ` — ${t.reason}` : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {dialog.confirmOnly ? (
              // Действие тратит ресурсы, но кубов нет — подтверждение расхода.
              <>
                <div className="dice-dialog-summary">Потратить ресурсы и применить действие?</div>
                <div className="dice-dialog-actions">
                  <button type="button" className="dice-dialog-btn primary" disabled={mustPickTarget} aria-description={mustPickTarget ? 'Выберите цель' : undefined} onClick={() => finish(withTarget({ mode: 'auto' }))}>
                    Применить
                  </button>
                  <button type="button" className="dice-dialog-btn ghost" onClick={() => finish({ mode: 'cancel' })}>
                    Отмена
                  </button>
                </div>
                <p className="dice-dialog-note">Окно можно отключить в настройках сайта.</p>
              </>
            ) : (
              <>
                <div className="dice-dialog-summary">
                  Бросьте: <b>{summarizeDice(dialog.plan)}</b> — или доверьте бросок системе.
                </div>
                <div className="dice-dialog-list">
                  {dialog.plan.map((d, i) => (
                    <label key={i} className="dice-dialog-row">
                      <span className="dice-dialog-die">к{d.sides}</span>
                      <span className="dice-dialog-label">{d.label}</span>
                      <input
                        className="dice-dialog-input"
                        type="number"
                        min={1}
                        max={d.sides}
                        placeholder={`1–${d.sides}`}
                        value={values[i]}
                        onChange={(e) => setValues((prev) => prev.map((v, j) => (j === i ? e.target.value : v)))}
                      />
                    </label>
                  ))}
                </div>
                <div className="dice-dialog-actions">
                  <button type="button" className="dice-dialog-btn primary" disabled={mustPickTarget} aria-description={mustPickTarget ? 'Выберите цель' : undefined} onClick={() => finish(withTarget({ mode: 'auto' }))}>
                    Автобросок
                  </button>
                  {dialog.use3d && (
                    <button
                      type="button"
                      className="dice-dialog-btn dice-dialog-btn--3d"
                      onClick={() => setShow3dScene(true)}
                    >
                      <Dices size={16} /> Бросить на сайте
                    </button>
                  )}
                  <button
                    type="button"
                    className="dice-dialog-btn"
                    disabled={!manualReady || mustPickTarget}
                    aria-description={mustPickTarget ? 'Выберите цель' : manualReady ? undefined : 'Заполните значения всех кубов'}
                    onClick={() => finish(withTarget({ mode: 'manual', values: parsed as number[] }))}
                  >
                    Использовать мои кубы
                  </button>
                  <button type="button" className="dice-dialog-btn ghost" onClick={() => finish({ mode: 'cancel' })}>
                    Отмена
                  </button>
                </div>
                <p className="dice-dialog-note">
                  Окно можно отключить в настройках сайта.
                </p>
              </>
            )}
          </div>
          </div>
        </div>
      )}
  </>;
}
