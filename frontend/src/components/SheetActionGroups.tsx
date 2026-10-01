import type {CSSProperties,ReactNode} from 'react';
import type {SheetAction} from '../character/actionSheet';
import {ACTION_PRESENTATION_GROUPS,actionPresentationGroup} from '../character/actionPresentationGroups';
import './SheetActionGroups.css';

export interface SheetActionGroup {key:string;label:string;items:readonly SheetAction[]}

export function sheetActionGroups(actions:readonly SheetAction[]):SheetActionGroup[] {
  return ACTION_PRESENTATION_GROUPS.map(group=>({key:group.id,label:group.label,
    items:actions.filter(action=>actionPresentationGroup(action.group,action.mechanics)===group.id)}));
}

/** Layout only: each entity still comes from the panel's canonical renderer. */
export default function SheetActionGroups({groups,icons,bySpellLevel=false,renderAction}:{
  groups:readonly SheetActionGroup[];icons:boolean;bySpellLevel?:boolean;renderAction:(action:SheetAction)=>ReactNode;
}) {
  return <div className="sheet-actions-frame"><div className={`sheet-actions-layout${icons?' is-icon-view':' is-row-view'}${bySpellLevel?' is-spell-catalog':''}`}>
    {groups.filter(group=>group.items.length>0).map(({key,label,items})=><div key={key}
      className={`sheet-action-group${bySpellLevel?' sheet-group':''}`} role="group" aria-label={label} data-action-group={key}
      style={!bySpellLevel&&icons?{'--sheet-action-group-width':`${Math.max(112,Math.min(320,Math.ceil(items.length/2)*60-8))}px`} as CSSProperties:undefined}>
      {bySpellLevel&&<h3 className="sheet-h3">{label}</h3>}
      <div className={icons?'cs-action-tiles':'sheet-item-cols'}>{items.map(renderAction)}</div>
    </div>)}
  </div></div>;
}
