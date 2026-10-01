export type ActionPresentationGroup = 'basic' | 'features' | 'spells' | 'items';

export const ACTION_PRESENTATION_GROUPS = [
  {id:'basic',label:'Базовые действия'},
  {id:'features',label:'Действия вида и класса'},
  {id:'spells',label:'Заклинания'},
  {id:'items',label:'Действия предметов'},
] as const;

/** The source owns its group. Names, charge balance and current activation
 * availability never change where an entity is presented. */
export function actionPresentationGroup(
  origin: 'basic' | 'race' | 'class' | 'spell' | 'item',
  mechanics: Record<string,unknown>,
): ActionPresentationGroup {
  if(origin==='item' || mechanics.damage_source_kind==='item'
    || typeof mechanics.requires_item_source==='string'
    || Array.isArray(mechanics.requires_any_item_source) && mechanics.requires_any_item_source.length>0) return 'items';
  if(origin==='basic') return 'basic';
  if(origin==='spell') return 'spells';
  return 'features';
}
