import { ABILITY_IDS, SKILL_IDS, SKILL_ABILITY } from '../character/rules/foundation';
import { calculateSheet, createPaperSheet, exportPaperSheet, importPaperSheet, type PaperSheetDocument, type SheetCalculation } from './model';
import type { Spell } from '../types';

type Obj = Record<string, any>;
const object = (v: unknown): Obj => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Obj : {};
const array = (v: unknown): any[] => Array.isArray(v) ? v : [];
const str = (v: unknown): string => typeof v === 'string' || typeof v === 'number' ? String(v) : '';
const val = (v: unknown): string => str(object(v).value);
const formula = (v: unknown) => { const text = str(v); return text && !/^[+-]?\d+(\.\d+)?$/.test(text) ? `=${text.replace(/^=/, '')}` : text; };
const skillLss = (id: string) => ({ animal_handling: 'animal handling', sleight_of_hand: 'sleight of hand' }[id] ?? id);
const plain = (text: string) => text.replace(/\[\[([^\]|]+)\|(?:card|spell):[\w-]+\]\]/g, '$1');
const specified = (v: unknown) => v !== null && v !== undefined && v !== '';

/** All external data stays inert. Bound depth/size before traversing nested editor documents. */
export function parseExchangeJSON(text: string): any {
  if (new TextEncoder().encode(text).length > 10_000_000) throw new Error('Файл больше 10 МБ.');
  let value: unknown;
  try { value = JSON.parse(text.replace(/^\uFEFF/, '')); } catch { throw new Error('Не удалось прочитать JSON.'); }
  let nodes = 0;
  const check = (v: unknown, depth: number) => {
    if (++nodes > 200_000 || depth > 60) throw new Error('Слишком сложная структура JSON.');
    if (!v || typeof v !== 'object') return;
    for (const [key, child] of Object.entries(v)) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error('Недопустимое имя поля JSON.');
      check(child, depth + 1);
    }
  };
  check(value, 0);
  return value;
}

export function lssText(value: unknown): string {
  if (typeof value === 'string') return value;
  const node = object(value);
  if (node.type === 'text') return str(node.text);
  if (node.type === 'hardBreak' || node.type === 'divider') return '\n';
  if (node.type === 'resource') return `[Ресурс LSS: ${str(node.attrs?.name || node.attrs?.id || node.attrs?.resourceId)}]`;
  if (node.type === 'formula' || node.type === 'roller') return str(node.attrs?.formula || node.attrs?.expression || node.attrs?.value || node.text);
  const content = array(node.content).map(lssText).join('');
  return content + (['paragraph', 'heading', 'listItem', 'taskItem', 'spoilerSummary'].includes(node.type) ? '\n' : '');
}
const rich = (text: string) => ({ value: { data: { type: 'doc', content: plain(text).split('\n').map(line => ({ type: 'paragraph', ...(line ? { content: [{ type: 'text', text: line }] } : {}) })) } } });

const INFO: Record<string, string> = { class: 'charClass', subclass: 'charSubclass', species: 'race', background: 'background', alignment: 'alignment', level: 'level', xp: 'experience', size: 'size', playerName: 'playerName' };
const VITAL: Record<string, string> = { ac: 'ac', speed: 'speed', initiative: 'initiative', hpCurrent: 'hp-current', hpMax: 'hp-max', hpTemp: 'hp-temp', hitDie: 'hit-die', hitDiceCurrent: 'hp-dice-current', hitDiceMax: 'hp-dice-max' };
const TEXT: Record<string, string> = { prof: 'proficiencies', features: 'features', attacks: 'attacks', feats: 'traits', equipment: 'equipment', background: 'backstory', appearance: 'appearance', quests: 'goals', allies: 'allies', traits: 'additional', treasure: 'treasure', 'notes-1': 'notes1', 'notes-2': 'notes2', 'notes-3': 'notes3', 'notes-4': 'notes4', 'notes-5': 'notes5', 'notes-6': 'notes6' };
const PROF: Record<string, string> = { 'armor-light': 'lightArmor', 'armor-medium': 'mediumArmor', 'armor-heavy': 'heavyArmor', 'armor-label': 'shield', 'weapon-simple': 'simpleWeapons', 'weapon-martial': 'martialWeapons', 'weapon-other': 'otherWeapons' };

function envelope(input: unknown): { root: Obj; data: Obj } {
  const root = object(input);
  if (root.jsonType !== 'character') throw new Error('Это не JSON персонажа Long Story Short.');
  if ('data' in root) {
    if (root.version !== '2' && root.version !== 2) throw new Error('Неизвестная версия экспорта LSS.');
    const data = object(typeof root.data === 'string' ? parseExchangeJSON(root.data) : root.data);
    if (!data.stats || !data.info || !data.name) throw new Error('В JSON LSS отсутствуют основные поля персонажа.');
    return { root, data };
  }
  if (!root.stats || !root.info || !root.name) throw new Error('В JSON LSS отсутствуют основные поля персонажа.');
  return { root: { jsonType: 'character', version: '2', edition: '2014', sheetEdition: '2014', data: JSON.stringify(root) }, data: root };
}

export interface PaperImportResult { document: PaperSheetDocument; warnings: string[]; format: 'boh' | 'lss' }
export function importSheetJSON(text: string): PaperImportResult {
  const parsed = parseExchangeJSON(text);
  if (object(parsed).version === 1 && object(parsed).fields) return { document: importPaperSheet(text), warnings: [], format: 'boh' };
  const { root, data } = envelope(parsed);
  const doc = createPaperSheet();
  const warnings: string[] = [];
  doc.fields.name = val(data.name);
  for (const [field, key] of Object.entries(INFO)) if (data.info?.[key]) doc.fields[field] = val(data.info[key]);
  for (const [field, key] of Object.entries(VITAL)) if (data.vitality?.[key]) doc.fields[field] = ['ac', 'speed', 'initiative'].includes(field) ? formula(val(data.vitality[key])) : val(data.vitality[key]);
  doc.fields.proficiency = str(data.proficiencyCustom || data.proficiency || '');
  for (const id of ABILITY_IDS) {
    if (data.stats?.[id]?.score !== undefined) doc.fields[id] = str(data.stats[id].score);
    doc.training[`save.${id}`] = Math.min(2, Number(data.saves?.[id]?.isProf) || 0) as 0 | 1 | 2;
    const save = object(data.saves?.[id]);
    if (specified(save.customModifier)) doc.fields[`save.${id}`] = formula(save.customModifier);
    else if (save.bonusExpr || save.bonus) doc.fields[`save.${id}`] = `=[${id.toUpperCase()}]+[PROF]*${doc.training[`save.${id}`]}+(${save.bonusExpr || save.bonus})`;
  }
  for (const id of SKILL_IDS) {
    const skill = object(data.skills?.[skillLss(id)]);
    doc.training[id] = Math.min(2, Number(skill.isProf) || 0) as 0 | 1 | 2;
    const base = ABILITY_IDS.includes(skill.baseStat) ? skill.baseStat : SKILL_ABILITY[id];
    if (specified(skill.customModifier)) doc.fields[`skill.${id}`] = formula(skill.customModifier);
    else if (skill.bonusExpr || skill.bonus || base !== SKILL_ABILITY[id]) doc.fields[`skill.${id}`] = `=[${base.toUpperCase()}]+[PROF]*${doc.training[id]}+(${skill.bonusExpr || skill.bonus || 0})`;
  }
  if (data.skills?.perception?.customPassive !== undefined) doc.fields.passive = str(data.skills.perception.customPassive);
  for (const [key, field] of Object.entries(PROF)) doc.checks[`proficiency.${field}`] = !!data.prof?.[key]?.value;
  doc.checks.shield = !!data.vitality?.shield?.value;
  if (doc.checks.shield) doc.fields.ac = `=(${doc.fields.ac?.replace(/^=/, '') || '10+[DEX]'})+(${data.vitality.shield.mod || 2})`;
  doc.checks.inspiration = !!data.inspiration;
  for (let n = 1; n <= 6; n++) doc.checks[`exhaustion.${n}`] = n <= Number(data.exhaustion || 0);
  for (let n = 1; n <= 3; n++) {
    doc.checks[`death.success.${n}`] = n <= Number(data.vitality?.deathSuccesses || 0);
    doc.checks[`death.failure.${n}`] = n <= Number(data.vitality?.deathFails || 0);
  }
  doc.fields.conditions = array(data.conditions).map(str).join(', ');
  for (const coin of ['cp', 'sp', 'gp', 'ep', 'pp']) if (data.coins?.[coin]) doc.fields[`coin${coin[0].toUpperCase()}p`] = val(data.coins[coin]);
  for (const [key, raw] of Object.entries(object(data.text))) {
    if (key.startsWith('spells-level-')) continue;
    const block = object(raw);
    const field = TEXT[key] || `lss.${key}`;
    doc.sections[field] = { text: lssText(block.value?.data ?? block.value).trimEnd(), fontSize: 11 };
    if (block.customLabel) doc.fields[`heading.${field}`] = str(block.customLabel);
  }
  const weapons = array(data.weaponsList);
  if (weapons.length > 30) throw new Error('В листе больше 30 строк оружия. Исходный файл не изменён.');
  doc.weaponRows = Math.max(1, weapons.length);
  weapons.forEach((weapon, i) => {
    const key = `weapon.${i}`;
    doc.fields[`${key}.name`] = val(weapon.name);
    doc.fields[`${key}.damage`] = [val(weapon.dmg), val(weapon.dmgType)].filter(Boolean).join(' ');
    doc.fields[`${key}.notes`] = val(weapon.notes);
    const ability = weapon.ability || 'str';
    doc.fields[`${key}.bonus`] = `=${ability === 'none' ? str(weapon.modCustom?.value || 0) : `[${ability.toUpperCase()}]`}+${weapon.isProf ? '[PROF]' : '0'}+${weapon.modBonus?.value || 0}`;
  });
  array(data.attunementsList).forEach((item, i) => {
    doc.fields[`attunementName${i}`] = str(item.value);
    doc.checks[`attunement${i}`] = !!item.checked;
  });
  doc.fields.attunementSlots = String(Math.max(1, array(data.attunementsList).length));
  doc.fields.spellAbility = str(data.spellsInfo?.base?.code);
  doc.fields.spellDC = formula(data.spellsInfo?.save?.customModifier);
  doc.fields.spellAttack = formula(data.spellsInfo?.mod?.customModifier);
  for (let level = 1; level <= 9; level++) {
    const slots = object(data.spells?.[`slots-${level}`]);
    doc.fields[`slot${level}Max`] = str(slots.value || 0);
    doc.fields[`slot${level}Used`] = str(slots.filled || 0);
  }
  let row = 0;
  for (let level = 0; level <= 9; level++) {
    const text = lssText(data.text?.[`spells-level-${level}`]?.value?.data).trim();
    for (const name of text ? text.split('\n').filter(Boolean) : []) {
      if (row >= 100) throw new Error('В файле больше 100 строк заклинаний. Разделите файл; ничего не удалено.');
      doc.fields[`spellRow${row}Name`] = name;
      doc.fields[`spellRow${row}Level`] = str(level);
      row++;
    }
  }
  // Never substitute foreign IDs with our library IDs, nor invent missing spell content.
  const spellIds = [...new Set([...array(root.spells?.prepared), ...array(root.spells?.granted).map(s => s.id)])].filter(id => typeof id === 'string');
  for (const id of spellIds) {
    if (row >= 100) throw new Error('В файле больше 100 подготовленных заклинаний. Исходный файл не изменён.');
    doc.fields[`spellRow${row}Name`] = `Заклинание LSS (${id})`;
    doc.fields[`spellRow${row}LssId`] = id;
    row++;
  }
  doc.spellRows = Math.max(38, row);
  if (spellIds.length || array(root.spells?.book).length) warnings.push('LSS хранит библиотечные заклинания только по ID. Ссылки и статусы сохранены для обратного экспорта. Загрузите также JSON гримуара для собственных заклинаний; неизвестные записи можно сопоставить через кнопку библиотеки, не меняя исходный ID.');
  if (array(data.bonuses).length || Object.keys(object(data.spellsPact)).length) warnings.push('В LSS есть дополнительные бонусы или ячейки договора. Они сохранены в оригинале; проверьте итоговые значения перед игрой.');
  if (Object.keys(object(data.resources)).length) warnings.push('Счётчики ресурсов LSS сохранены в оригинале и приложении к листу.');
  const portrait = str(data.avatar?.webp || data.avatar?.jpeg);
  if (/^(https:\/\/|data:image\/(png|jpeg|webp|gif);base64,)/.test(portrait)) doc.portrait = portrait;
  doc.exchange = { format: 'lss', source: JSON.stringify(root), baseline: exportPaperSheet(doc) };
  // Run the same validation as native files and server persistence before replacing any sheet.
  return { document: importPaperSheet(exportPaperSheet(doc)), warnings, format: 'lss' };
}

/** Readable preservation of sections that have no fixed rectangle on the four-page sheet. */
export function paperExtraSections(doc: PaperSheetDocument): { title: string; text: string }[] {
  const result = Object.entries(doc.sections).filter(([key, value]) => (key.startsWith('lss.') || key.startsWith('lssSpell.')) && value.text).map(([key, value]) => ({ title: doc.fields[`heading.${key}`] || (key.startsWith('lssSpell.') ? 'Заклинание LSS' : key.slice(4)), text: value.text }));
  if (doc.exchange) {
    let saved;
    try { saved = envelope(parseExchangeJSON(doc.exchange.source)); } catch { return [...result, { title: 'Данные LSS', text: 'Повреждён исходный JSON LSS. Загрузите исходный файл заново.' }]; }
    const { data, root } = saved;
    for (const resource of Object.values(object(data.resources))) {
      const r = object(resource);
      result.push({ title: str(r.name || 'Ресурс LSS'), text: `${str(r.current)} / ${str(r.max ?? r.maxExpr)}\n${str(r.notes)}` });
    }
    if (array(root.spells?.book).length) {
      const names = new Map(paperLssSpells(doc).map(spell => [spell.id, spell.name]));
      result.push({ title: 'Книга заклинаний LSS — известные', text: array(root.spells.book).map(id => names.get(id) || str(id)).join('\n') });
    }
  }
  return result;
}

const UNIT: Record<string, string> = { action: 'действие', bonus: 'бонусное действие', reaction: 'реакция', minute: 'мин.', hour: 'ч.', round: 'раунд', ft: 'фт.', self: 'на себя', touch: 'касание', sight: 'видимость', inst: 'мгновенно', spec: 'особая', perm: 'постоянно' };
const SCHOOL: Record<string, string> = { abj: 'abjuration', con: 'conjuration', div: 'divination', enc: 'enchantment', evo: 'evocation', ill: 'illusion', nec: 'necromancy', trs: 'transmutation' };
const measure = (v: Obj) => [v.value ?? v.cost ?? '', UNIT[v.units || v.type] ?? v.units ?? v.type ?? ''].filter(v => v !== '').join(' ');
function spellDefinition(raw: Obj): Spell {
  const system = object(raw.system ?? raw.data);
  const properties = new Set(array(system.properties));
  // Text from LSS is inert; strip actual HTML tags from Foundry descriptions, retaining line breaks.
  const description = str(system.description?.value).replace(/<\/(p|div|li)>|<br\s*\/?\s*>/gi, '\n').replace(/<\/?(?:p|div|li|ul|ol|strong|em|b|i|span|a|h[1-6])\b[^>]*>/gi, '').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  return { id: str(raw._id || raw.id), name: str(raw.name), level: Number(system.level) || 0, description, rarity: 'common', card_number: '', component_verbal: !!system.components?.vocal || properties.has('vocal'), component_somatic: !!system.components?.somatic || properties.has('somatic'), component_material: !!system.components?.material || properties.has('material'), material_text: str(system.materials?.value), concentration: !!system.components?.concentration || properties.has('concentration'), ritual: !!system.components?.ritual || properties.has('ritual'), school: SCHOOL[str(system.school)] || str(system.school), casting_time: measure(object(system.activation)), range: measure(object(system.range)), duration: measure(object(system.duration)), is_healing: system.actionType === 'heal', source: 'Long Story Short', created_at: '', updated_at: '' };
}
export function paperLssSpells(doc: PaperSheetDocument): Spell[] {
  try { return doc.exchange?.spells ? array(parseExchangeJSON(doc.exchange.spells)).map(spellDefinition) : []; } catch { return []; }
}
export function attachLssSpells(doc: PaperSheetDocument, text: string): PaperSheetDocument {
  if (!doc.exchange) throw new Error('Сначала импортируйте персонажа LSS.');
  const raw = parseExchangeJSON(text);
  if (!Array.isArray(raw) || raw.length > 2000 || raw.some(s => !object(s).name || !(object(s).system || object(s).data) || !(object(s)._id || object(s).id))) throw new Error('Выберите JSON гримуара, экспортированный из LSS.');
  const existing = array(doc.exchange.spells ? parseExchangeJSON(doc.exchange.spells) : []);
  const merged = [...new Map([...existing, ...raw].map(s => [s._id || s.id, s])).values()];
  const next: PaperSheetDocument = { ...doc, fields: { ...doc.fields }, checks: { ...doc.checks }, sections: { ...doc.sections }, exchange: { ...doc.exchange, spells: JSON.stringify(merged) } };
  const baseline = importPaperSheet(doc.exchange.baseline);
  for (const spell of merged.map(spellDefinition)) {
    for (let i = 0; i < doc.spellRows; i++) {
      if (doc.fields[`spellRow${i}LssId`] !== spell.id) continue;
      const values: Record<string, string> = { Name: spell.name, Level: str(spell.level), Time: spell.casting_time || '', Range: spell.range || '', Notes: [spell.duration, spell.material_text].filter(Boolean).join('; ') };
      for (const [key, value] of Object.entries(values)) {
        const field = `spellRow${i}${key}`;
        if ((doc.fields[field] ?? '') === (baseline.fields[field] ?? '')) next.fields[field] = value;
      }
      for (const [key, value] of [['Concentration', spell.concentration], ['Ritual', spell.ritual], ['Material', spell.component_material]] as const) {
        const field = `spellRow${i}${key}`;
        if (doc.checks[field] === baseline.checks[field]) next.checks[field] = value;
      }
    }
    next.sections[`lssSpell.${spell.id}`] = { text: `${spell.name}\n${spell.description}`, fontSize: 11 };
  }
  return importPaperSheet(exportPaperSheet(next));
}

export function exportLssSheet(doc: PaperSheetDocument, calculations?: SheetCalculation): string {
  // Preserve unknown fields, full rich text, IDs, statuses and custom mechanics unchanged.
  const saved = doc.exchange ? envelope(parseExchangeJSON(doc.exchange.source)) : null;
  const original = doc.exchange ? importPaperSheet(doc.exchange.baseline) : null;
  const baseCalc = calculateSheet(doc);
  const calc = calculations ?? baseCalc;
  const projected = (key: string) => calc.values[key] !== baseCalc.values[key];
  if (original && !Object.keys(calc.values).some(projected) && JSON.stringify({ ...doc, exchange: undefined }) === JSON.stringify({ ...original, exchange: undefined })) return JSON.stringify(saved!.root, null, 2);
  const root: Obj = saved?.root ?? { jsonType: 'character', version: '2', edition: '2024', sheetEdition: '2024', spells: { mode: 'text', prepared: [], book: [], granted: [], slotless: [] } };
  const data: Obj = saved?.data ?? { jsonType: 'character', template: 'default', name: { value: '' }, info: {}, stats: {}, saves: {}, skills: {}, vitality: {}, spellsInfo: {}, spells: {}, text: {}, coins: {}, bonuses: [] };
  const changed = (field: string) => !original || (doc.fields[field] ?? '') !== (original.fields[field] ?? '') || projected(field);
  const numeric = (key: string) => {
    const number = calc.values[key] ?? Number(doc.fields[key] || 0);
    if (calc.errors[key] || !Number.isFinite(number)) throw new Error(`Исправьте поле «${key}» перед экспортом LSS: ${calc.errors[key] || 'не число'}`);
    return number;
  };
  const set = (group: string, key: string, value: unknown) => { data[group] = object(data[group]); data[group][key] = { ...object(data[group][key]), ...(group === 'info' ? { name: key } : {}), value }; };
  if (changed('name')) data.name = { ...object(data.name), value: doc.fields.name || '' };
  for (const [field, key] of Object.entries(INFO)) if (changed(field)) set('info', key, field === 'level' ? numeric(field) : doc.fields[field] || '');
  for (const id of ABILITY_IDS) {
    data.stats = object(data.stats); data.saves = object(data.saves);
    if (changed(id)) data.stats[id] = { ...object(data.stats[id]), name: id, score: numeric(id) };
    if (!original || doc.training[`save.${id}`] !== original.training[`save.${id}`] || changed(`save.${id}`)) data.saves[id] = { ...object(data.saves[id]), name: id, isProf: doc.training[`save.${id}`] || false, ...(doc.fields[`save.${id}`] || projected(`save.${id}`) ? { customModifier: numeric(`save.${id}`) } : { customModifier: '' }) };
  }
  data.skills = object(data.skills);
  for (const id of SKILL_IDS) {
    const key = skillLss(id);
    if (!original || doc.training[id] !== original.training[id] || changed(`skill.${id}`)) data.skills[key] = { ...object(data.skills[key]), name: key, baseStat: SKILL_ABILITY[id], isProf: doc.training[id] || false, ...(doc.fields[`skill.${id}`] || projected(`skill.${id}`) ? { customModifier: numeric(`skill.${id}`) } : { customModifier: '' }) };
  }
  if (changed('proficiency')) { data.proficiency = numeric('proficiency'); data.proficiencyCustom = numeric('proficiency'); }
  if (changed('conditions')) data.conditions = (doc.fields.conditions || '').split(',').map(s => s.trim()).filter(Boolean);
  for (const [field, key] of Object.entries(VITAL)) if (changed(field) && field !== 'hitDiceMax') set('vitality', key, ['hpCurrent', 'hpMax', 'hpTemp', 'hitDiceCurrent'].includes(field) ? numeric(field) : field === 'hitDie' ? doc.fields[field] || '' : str(numeric(field)));
  // Our AC already includes equipment; do not apply LSS shield twice after an edit.
  if (changed('ac')) data.vitality.shield = { value: false, mod: '0' };
  for (const coin of ['cp', 'sp', 'gp', 'ep', 'pp']) { const key = `coin${coin[0].toUpperCase()}p`; if (changed(key)) set('coins', coin, numeric(key)); }
  data.vitality = object(data.vitality);
  for (const [key, target] of [['success', 'deathSuccesses'], ['failure', 'deathFails']]) if (!original || [1, 2, 3].some(n => doc.checks[`death.${key}.${n}`] !== original.checks[`death.${key}.${n}`])) data.vitality[target] = [1, 2, 3].filter(n => doc.checks[`death.${key}.${n}`]).length;
  if (!original || doc.checks.inspiration !== original.checks.inspiration) data.inspiration = !!doc.checks.inspiration;
  if (!original || [1, 2, 3, 4, 5, 6].some(n => doc.checks[`exhaustion.${n}`] !== original.checks[`exhaustion.${n}`])) data.exhaustion = [1, 2, 3, 4, 5, 6].filter(n => doc.checks[`exhaustion.${n}`]).length;
  data.prof = object(data.prof);
  for (const [key, field] of Object.entries(PROF)) if (!original || doc.checks[`proficiency.${field}`] !== original.checks[`proficiency.${field}`]) data.prof[key] = { value: !!doc.checks[`proficiency.${field}`] };
  if (!original || doc.portrait !== original.portrait) data.avatar = doc.portrait ? { jpeg: doc.portrait } : null;
  if (!original || changed('attunementSlots') || Object.keys({ ...doc.fields, ...doc.checks }).some(k => /^attunement/.test(k) && (changed(k) || doc.checks[k] !== original.checks[k]))) {
    const count = Number(doc.fields.attunementSlots) || 1;
    if (!Number.isInteger(count) || count < 1 || count > 100) throw new Error('Число предметов настройки должно быть от 1 до 100.');
    data.attunementsList = Array.from({ length: count }, (_, i) => ({ id: data.attunementsList?.[i]?.id || `boh-attunement-${i}`, checked: !!doc.checks[`attunement${i}`], value: plain(doc.fields[`attunementName${i}`] || '') }));
  }
  data.text = object(data.text);
  const reverseText = Object.fromEntries(Object.entries(TEXT).map(([a, b]) => [b, a]));
  for (const [key, block] of Object.entries(doc.sections)) {
    if (key.startsWith('lssSpell.')) continue;
    const target = reverseText[key] || key.replace(/^lss\./, '');
    if (!original || block.text !== original.sections[key]?.text) data.text[target] = { ...object(data.text[target]), ...rich(block.text) };
    if (changed(`heading.${key}`)) data.text[target] = { ...object(data.text[target]), customLabel: doc.fields[`heading.${key}`] || '' };
  }
  const inventoryText = Object.entries(doc.fields).filter(([key, v]) => /^inventory\.\d+\.item$/.test(key) && v).map(([key, v]) => `${plain(v)} × ${doc.fields[key.replace(/item$/, 'quantity')] || 1}`);
  const equippedText = Object.entries(doc.fields).filter(([key, v]) => key.startsWith('equipment.') && v).map(([key, v]) => `${key.slice(10)}: ${plain(v)}`);
  if (inventoryText.length || equippedText.length) data.text.equipment = { ...object(data.text.equipment), ...rich([doc.sections.equipment?.text || '', 'Снаряжение и инвентарь Bag of Holding', ...equippedText, ...inventoryText].filter(Boolean).join('\n')) };
  const oldWeapons = array(data.weaponsList);
  data.weaponsList = Array.from({ length: doc.weaponRows }, (_, i) => {
    const prefix = `weapon.${i}`;
    if (original && ['name', 'bonus', 'damage', 'notes'].every(k => !changed(`${prefix}.${k}`))) return oldWeapons[i] ?? { id: `boh-weapon-${i}` };
    const weapon: Obj = { ...object(oldWeapons[i]), id: oldWeapons[i]?.id || `boh-weapon-${i}` };
    if (changed(`${prefix}.name`)) weapon.name = { value: plain(doc.fields[`${prefix}.name`] || '') };
    if (changed(`${prefix}.bonus`)) Object.assign(weapon, { ability: 'none', isProf: false, modCustom: { value: numeric(`${prefix}.bonus`) }, modBonus: { value: 0 } });
    if (changed(`${prefix}.damage`)) {
      const damage = doc.fields[`${prefix}.damage`] || '';
      const match = /^(.*?)(?:\s+([а-яёА-ЯЁ][а-яёА-ЯЁ -]*|acid|bludgeoning|cold|fire|force|lightning|necrotic|piercing|poison|psychic|radiant|slashing|thunder))$/.exec(damage);
      weapon.dmg = { value: match?.[1]?.trim() || damage };
      weapon.dmgType = { value: match?.[2] || '' };
    }
    if (changed(`${prefix}.notes`)) weapon.notes = { value: doc.fields[`${prefix}.notes`] || '' };
    return weapon;
  });
  data.spellsInfo = object(data.spellsInfo);
  if (changed('spellAbility')) data.spellsInfo.base = { name: 'base', value: '', ...(doc.fields.spellAbility ? { code: doc.fields.spellAbility } : {}) };
  for (const [field, key] of [['spellDC', 'save'], ['spellAttack', 'mod']]) if (changed(field)) data.spellsInfo[key] = { ...object(data.spellsInfo[key]), name: key, value: '', customModifier: doc.fields.spellAbility || doc.fields[field] ? str(numeric(field)) : null };
  data.spells = object(data.spells);
  for (let level = 1; level <= 9; level++) if (changed(`slot${level}Max`) || changed(`slot${level}Used`)) data.spells[`slots-${level}`] = { value: numeric(`slot${level}Max`), filled: numeric(`slot${level}Used`) };
  const newSpells: string[][] = Array.from({ length: 10 }, () => []);
  for (let i = 0; i < doc.spellRows; i++) {
    const name = doc.fields[`spellRow${i}Name`];
    if (!name || doc.fields[`spellRow${i}LssId`]) continue;
    const level = Math.min(9, Math.max(0, Number(doc.fields[`spellRow${i}Level`]) || 0));
    const detail = ['Time', 'Range', 'Notes'].map(k => doc.fields[`spellRow${i}${k}`]).filter(Boolean).join('; ');
    const flags = [['Concentration', 'концентрация'], ['Ritual', 'ритуал'], ['Material', 'материальный компонент']].filter(([k]) => doc.checks[`spellRow${i}${k}`]).map(([, label]) => label).join(', ');
    newSpells[level].push([plain(name), detail, flags].filter(Boolean).join(' — '));
  }
  const spellsChanged = !original || doc.spellRows !== original.spellRows || Object.keys({ ...doc.fields, ...original.fields }).some(key => /^spellRow\d+/.test(key) && changed(key)) || Object.keys({ ...doc.checks, ...original.checks }).some(key => /^spellRow\d+/.test(key) && doc.checks[key] !== original.checks[key]);
  if (spellsChanged) {
    for (let level = 0; level <= 9; level++) data.text[`spells-level-${level}`] = rich(newSpells[level].join('\n'));
    // Foreign prepared/book/granted/slotless remain intact; new local spells are portable text.
    if (saved && root.spells?.mode === 'cards' && newSpells.some(list => list.length)) data.text['notes-6'] = rich([lssText(data.text['notes-6']?.value?.data).trimEnd(), 'Заклинания, добавленные в Bag of Holding', ...newSpells.flat()].filter(Boolean).join('\n'));
    if (saved && root.spells) {
      const retained = new Set(Array.from({ length: doc.spellRows }, (_, i) => doc.fields[`spellRow${i}Name`] ? doc.fields[`spellRow${i}LssId`] : '').filter(Boolean));
      root.spells.prepared = array(root.spells.prepared).filter(id => retained.has(id));
      root.spells.granted = array(root.spells.granted).filter(s => retained.has(s.id));
    }
  }
  root.data = JSON.stringify(data);
  const json = JSON.stringify(root, null, 2);
  parseExchangeJSON(json);
  return json;
}
