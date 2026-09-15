import { useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Dices } from 'lucide-react';
import type { RollLog } from '../mvp/contracts';
import CombatPresentationDialog from './CombatPresentationDialog';
import { useCombatDialogFocus } from './useCombatDialogFocus';
import type {RollInfluence} from '../engine/rollInfluence';

export interface CompactCheckRequest { kind: 'save' | 'check'; roll: () => RollLog;
  influences?: (roll: RollLog) => RollInfluence[]; influence?: (id: string) => RollLog }

export default function SheetCheckRollDialog({ title, preview, request, onComplete, onCancel }: {
  title: string; preview?: ReactNode; request: CompactCheckRequest; onComplete: (roll: RollLog) => void; onCancel: () => void;
}) {
  const [roll, setRoll] = useState<RollLog>();
  const started = useRef(false);
  const [inspired,setInspired] = useState(false);
  const ref = useCombatDialogFocus(!roll);
  if (roll) return <CombatPresentationDialog key={inspired?'inspired':'original'} modeOverride="standard" beat={{ id: 'sheet-check', sourceId: 'sheet', sourceName: '', actionName: title, rollKind: request.kind, roll, cues: [] }} onClose={() => onComplete(roll)}
    provisional={!inspired && Boolean(request.influences?.(roll).length)}
    influences={!inspired ? request.influences?.(roll) : []}
    onInfluence={id => {if (request.influence) {setRoll(request.influence(id));setInspired(true);}}} />;
  return createPortal(<div className="combat-presentation-backdrop"><section ref={ref} tabIndex={-1} className="combat-presentation-dialog" role="dialog" aria-modal="true" aria-label={title}>
    <p className="combat-presentation-kicker">{request.kind === 'save' ? 'СПАСБРОСОК' : 'ПРОВЕРКА'}</p><h2>{title}</h2>
    <Dices size={72} color="#d8b978" aria-hidden="true" />
    {preview}<p className="combat-presentation-muted">Нажмите «Бросить», чтобы запустить кубик.</p>
    <div className="combat-presentation-actions"><button type="button" className="combat-presentation-continue" onClick={() => { if (started.current) return; started.current = true; setRoll(request.roll()); }}>Бросить</button><button type="button" className="combat-presentation-settings" onClick={onCancel}>Отмена</button></div>
  </section></div>, document.body);
}
