import type {LibraryContentType} from '../../utils/libraryUrlParams';
export type LibraryEntityFilters = Record<string, string>;
type Filter = {key: string; parameter: string; label: string; options: readonly (readonly [string,string])[]};
export const ENTITY_FILTERS: Partial<Record<LibraryContentType, readonly Filter[]>> = {
  spells:[{key:'narrative',parameter:'is_narrative',label:'Назначение заклинания',options:[['false','Боевые и механические'],['true','Нарративные в бою']]}],
  actions: [
    {key:'actionType',parameter:'action_type',label:'Источник действия',options:[['base_action','Базовые'],['class_feature','Класс'],['species_ability','Вид'],['item_property','Предмет']]},
    {key:'actionMode',parameter:'activation_mode',label:'Активация',options:[['active','Активное действие'],['reaction','Реакция'],['triggered','После события'],['rest_decision','После отдыха']]},
    {key:'narrative',parameter:'is_narrative',label:'Назначение действия',options:[['false','Механические'],['true','Нарративные']]},
  ],
  effects: [{key:'technical',parameter:'is_technical',label:'Назначение способности',options:[['false','Игровые способности'],['true','Технические']]}],
  races: [
    {key:'raceKind',parameter:'is_subrace',label:'Вид или подвид',options:[['false','Виды'],['true','Подвиды']]},
    {key:'raceSize',parameter:'size',label:'Размер',options:[['Маленький','Маленький'],['Средний','Средний']]},
  ],
  classes: [
    {key:'classKind',parameter:'is_subclass',label:'Класс или подкласс',options:[['false','Классы'],['true','Подклассы']]},
    {key:'hitDie',parameter:'hit_die',label:'Кость хитов',options:[['d6','к6'],['d8','к8'],['d10','к10'],['d12','к12']]},
  ],
  variables: [{key:'variableType',parameter:'var_type',label:'Тип значения',options:[['number','Число'],['dice','Кость']]}],
};
export const ENTITY_FILTER_KEYS = [...new Set(Object.values(ENTITY_FILTERS).flatMap(filters => filters.map(filter => filter.key)))];
export function relevantEntityFilters(type: LibraryContentType, values: LibraryEntityFilters): LibraryEntityFilters {
  return Object.fromEntries((ENTITY_FILTERS[type] ?? []).flatMap(filter => filter.options.some(([id])=>id===values[filter.key]) ? [[filter.key, values[filter.key]]] : []));
}
export function entityFilterQuery(type: LibraryContentType, values: LibraryEntityFilters): LibraryEntityFilters {
  const relevant = relevantEntityFilters(type, values);
  return Object.fromEntries((ENTITY_FILTERS[type] ?? []).flatMap(filter => relevant[filter.key] ? [[filter.parameter,relevant[filter.key]]] : []));
}
