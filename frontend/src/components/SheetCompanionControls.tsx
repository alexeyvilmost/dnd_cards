import { useMemo, useState } from 'react';
import type { Relation } from '../rules-core/domain';
import type { SheetCompanionControlModel } from '../character/sheetCompanionActions';
import { SHEET_COMPANION_CONTINUATION_REASON } from '../character/sheetCompanionInteraction';

export interface SheetCompanionTouchDeclaration {
  spellActionId: string;
  castOptionId: string;
  targetActorId: string;
  ownerDistanceFt: number;
  ownerLineOfSight: boolean;
  targetDistanceFt: number;
  targetLineOfSight: boolean;
  cover: 'none' | 'half' | 'three_quarters' | 'total';
  relation: Exclude<Relation, 'self'>;
  willing: boolean;
}
interface Props {
  model: SheetCompanionControlModel;
  targets: Array<{ id: string; name: string; disabledReason?: string }>;
  busy?: boolean;
  onDismiss: (mode: 'temporary' | 'forever') => void;
  onReappear: (facts: { distanceFt: number; lineOfSight: boolean; unoccupiedSpace: true }) => void;
  onReplaceTome: (rest: 'short' | 'long') => void;
  onTouchPactBlade: (weaponObjectId: string) => void;
  onDeliverTouch: (declaration: SheetCompanionTouchDeclaration) => void;
}

function finiteNonNegative(value: string): number | null {
  if (!value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

export default function SheetCompanionControls({
  model,
  targets,
  busy = false,
  onDismiss,
  onReappear,
  onReplaceTome,
  onTouchPactBlade,
  onDeliverTouch,
}: Props) {
  const [reappearDistance, setReappearDistance] = useState('');
  const [reappearLos, setReappearLos] = useState('');
  const [unoccupied, setUnoccupied] = useState(false);
  const [bladeObjectId, setBladeObjectId] = useState('');
  const [spellActionId, setSpellActionId] = useState('');
  const [castOptionId, setCastOptionId] = useState('');
  const [targetActorId, setTargetActorId] = useState('');
  const [ownerDistance, setOwnerDistance] = useState('');
  const [ownerLos, setOwnerLos] = useState('');
  const [targetDistance, setTargetDistance] = useState('');
  const [targetLos, setTargetLos] = useState('');
  const [cover, setCover] = useState('');
  const [relation, setRelation] = useState('');
  const [willing, setWilling] = useState('');

  const selectedSpell = model.touchSpells.find(({ action }) => action.id === spellActionId);
  const castOptions = selectedSpell?.castOptions ?? [];
  const ownerDistanceFt = finiteNonNegative(ownerDistance);
  const targetDistanceFt = finiteNonNegative(targetDistance);
  const touchReady = !!selectedSpell
    && castOptions.some((option) => option.id === castOptionId)
    && targets.some((target) => target.id === targetActorId && !target.disabledReason)
    && ownerDistanceFt !== null
    && targetDistanceFt !== null
    && (ownerLos === 'yes' || ownerLos === 'no')
    && (targetLos === 'yes' || targetLos === 'no')
    && ['none', 'half', 'three_quarters', 'total'].includes(cover)
    && ['ally', 'enemy', 'neutral'].includes(relation)
    && (willing === 'yes' || willing === 'no');
  const reappearDistanceFt = finiteNonNegative(reappearDistance);
  const reappearReady = reappearDistanceFt !== null
    && (reappearLos === 'yes' || reappearLos === 'no')
    && unoccupied;
  const blocked = busy || !!model.blockedReason;
  const debt = useMemo(() => {
    const rows = [
      SHEET_COMPANION_CONTINUATION_REASON,
      'Атака Pact Chain отключена: реальный лист ещё не открывает отдельный data-owned Attack action для замены одной атаки.',
      'Произвольно разорвать Pact Blade нельзя: текущий rules-core завершает связь только заменой, явным фактом дистанции или смертью владельца.',
      'Смена пяти заклинаний Pact Tome требует отдельной перезаписи resolved_choices; здесь отдых заменяет книгу с уже выбранным mechanics-набором.',
    ];
    return rows;
  }, []);

  if (!model.familiar && !model.pactBlade && !model.pactTome) return null;
  return (
    <section className="sheet-group" data-testid="sheet-companion-controls" aria-labelledby="sheet-companion-title">
      <h3 id="sheet-companion-title" className="sheet-h3">Спутник и дары договора</h3>
      {model.blockedReason && <p className="issues" role="status">{model.blockedReason}</p>}

      {model.familiar && (
        <div className="sheet-item-cols" data-testid="sheet-familiar-controls">
          <p>
            {model.familiar.name}: {model.familiar.presence} · Реакция{' '}
            {model.familiar.reactionAvailable ? 'готова' : 'потрачена'}.
          </p>
          {model.familiar.presence === 'present' ? (
            <>
              <button type="button" className="forge-btn ghost" disabled={blocked} onClick={() => onDismiss('temporary')}>
                Убрать в карманное измерение
              </button>
              <button type="button" className="forge-btn ghost" disabled={blocked} onClick={() => onDismiss('forever')}>
                Отпустить навсегда
              </button>
            </>
          ) : model.familiar.presence === 'pocket_dimension' ? (
            <div>
              <label>Дистанция появления, фт <input aria-label="Дистанция появления фамильяра" type="number" min="0" value={reappearDistance} onChange={(event) => setReappearDistance(event.target.value)} /></label>
              <label>Линия видимости <select aria-label="Линия видимости появления" value={reappearLos} onChange={(event) => setReappearLos(event.target.value)}><option value="">Укажите</option><option value="yes">Есть</option><option value="no">Нет</option></select></label>
              <label><input type="checkbox" checked={unoccupied} onChange={(event) => setUnoccupied(event.target.checked)} /> Место свободно</label>
              <button type="button" className="forge-btn ghost" disabled={blocked || !reappearReady} onClick={() => onReappear({ distanceFt: reappearDistanceFt!, lineOfSight: reappearLos === 'yes', unoccupiedSpace: true })}>
                Вернуть фамильяра
              </button>
            </div>
          ) : <p>Фамильяр исчез при 0 HP; повторно сотворите Find Familiar.</p>}
        </div>
      )}

      {model.familiar?.presence === 'present' && model.touchSpells.length > 0 && (
        <div className="sheet-item-cols" data-testid="sheet-familiar-touch-controls">
          <h4>Доставить заклинание касанием</h4>
          <label>Заклинание <select aria-label="Touch-заклинание" value={spellActionId} onChange={(event) => { setSpellActionId(event.target.value); setCastOptionId(''); }}><option value="">Выберите</option>{model.touchSpells.map(({ action }) => <option key={action.id} value={action.id}>{action.name}</option>)}</select></label>
          <label>Источник <select aria-label="Источник Touch-заклинания" value={castOptionId} onChange={(event) => setCastOptionId(event.target.value)}><option value="">Выберите</option>{castOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
          <label>Цель <select aria-label="Цель Touch-заклинания" value={targetActorId} onChange={(event) => setTargetActorId(event.target.value)}><option value="">Выберите</option>{targets.map((target) => <option key={target.id} value={target.id} disabled={!!target.disabledReason}>{target.name}{target.disabledReason ? ` — ${target.disabledReason}` : ''}</option>)}</select></label>
          <label>Владелец → фамильяр, фт <input aria-label="Дистанция до фамильяра" type="number" min="0" value={ownerDistance} onChange={(event) => setOwnerDistance(event.target.value)} /></label>
          <label>Видимость фамильяра <select aria-label="Видимость фамильяра" value={ownerLos} onChange={(event) => setOwnerLos(event.target.value)}><option value="">Укажите</option><option value="yes">Есть</option><option value="no">Нет</option></select></label>
          <label>Фамильяр → цель, фт <input aria-label="Дистанция от фамильяра до цели" type="number" min="0" value={targetDistance} onChange={(event) => setTargetDistance(event.target.value)} /></label>
          <label>Видимость цели <select aria-label="Видимость цели фамильяром" value={targetLos} onChange={(event) => setTargetLos(event.target.value)}><option value="">Укажите</option><option value="yes">Есть</option><option value="no">Нет</option></select></label>
          <label>Укрытие <select aria-label="Укрытие цели" value={cover} onChange={(event) => setCover(event.target.value)}><option value="">Укажите</option><option value="none">Нет</option><option value="half">Половина</option><option value="three_quarters">Три четверти</option><option value="total">Полное</option></select></label>
          <label>Отношение <select aria-label="Отношение к цели" value={relation} onChange={(event) => setRelation(event.target.value)}><option value="">Укажите</option><option value="ally">Союзник</option><option value="enemy">Враг</option><option value="neutral">Нейтральный</option></select></label>
          <label>Цель согласна <select aria-label="Согласие цели" value={willing} onChange={(event) => setWilling(event.target.value)}><option value="">Укажите</option><option value="yes">Да</option><option value="no">Нет</option></select></label>
          <button type="button" className="forge-btn" disabled={blocked || !touchReady} onClick={() => onDeliverTouch({
            spellActionId, castOptionId, targetActorId,
            ownerDistanceFt: ownerDistanceFt!, ownerLineOfSight: ownerLos === 'yes',
            targetDistanceFt: targetDistanceFt!, targetLineOfSight: targetLos === 'yes',
            cover: cover as SheetCompanionTouchDeclaration['cover'],
            relation: relation as SheetCompanionTouchDeclaration['relation'],
            willing: willing === 'yes',
          })}>Доставить через фамильяра</button>
        </div>
      )}

      {model.pactBlade && (
        <div className="sheet-item-cols" data-testid="sheet-pact-blade-lifecycle">
          <h4>Pact Blade</h4>
          <p>{model.pactBlade.activeWeaponObjectId ? `Активный объект: ${model.pactBlade.activeWeaponObjectId}` : 'Активной связи нет.'}</p>
          {model.pactBlade.touchableWeaponObjectIds.length ? <>
            <select aria-label="Магическое оружие для Pact Blade" value={bladeObjectId} onChange={(event) => setBladeObjectId(event.target.value)}><option value="">Выберите объект</option>{model.pactBlade.touchableWeaponObjectIds.map((id) => <option key={id} value={id}>{id}</option>)}</select>
            <button type="button" className="forge-btn ghost" disabled={blocked || !bladeObjectId} onClick={() => onTouchPactBlade(bladeObjectId)}>Коснуться и связать</button>
          </> : <p>Нет удерживаемого world-item с immutable Card; режим touch_existing закрыт.</p>}
        </div>
      )}

      {model.pactTome && (
        <div className="sheet-item-cols" data-testid="sheet-pact-tome-lifecycle">
          <h4>Pact Tome</h4>
          <p>Книга: {model.pactTome.activeBookObjectId ?? 'ещё не создана'}.</p>
          <button type="button" className="forge-btn ghost" disabled={blocked} onClick={() => onReplaceTome('short')}>Короткий отдых: заменить книгу</button>
          <button type="button" className="forge-btn ghost" disabled={blocked} onClick={() => onReplaceTome('long')}>Долгий отдых: заменить книгу</button>
        </div>
      )}

      <details><summary>Пока недоступно</summary><ul>{debt.map((row) => <li key={row}>{row}</li>)}</ul></details>
    </section>
  );
}
