import type {RollInfluence} from '../engine/rollInfluence';
import SheetActionLine from './SheetActionLine';
import {useSiteSettings} from '../settings';
import {grantedActionPresentation} from '../character/actionPresentation';

export default function RollInfluenceActions({actions, onUse, disabled}: {
  actions: readonly Pick<RollInfluence,'id'|'name'|'description'|'imageUrl'|'mechanics'>[]; onUse: (id: string) => void; disabled?: boolean;
}) {
  const {entityDisplay} = useSiteSettings();
  if (!actions.length) return null;
  return <section className="combat-roll-influences" aria-label="Повлиять на бросок">
    <h3>Повлиять на бросок</h3>
    <div className={entityDisplay.actions === 'icon' ? 'cs-action-tiles' : 'combat-influence-rows'}>{actions.map(action => <SheetActionLine key={action.id}
      variant={entityDisplay.actions} name={action.name} imageUrl={action.imageUrl} actionRef={grantedActionPresentation(action)}
      sourceLabel="Влияние на бросок" disabled={disabled} disabledTitle="Дождитесь завершения броска"
      onActivate={() => onUse(action.id)} />)}</div>
  </section>;
}
