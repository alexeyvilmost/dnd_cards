#!/usr/bin/env node
import { apiRequest, fetchAll, login } from './api.mjs';

const APPLY = process.argv.includes('--apply');
const SOURCE = 'https://next.dnd.su/class/pugilist';

const baseFeatures = [
  [1, 'PUG-F01', 'Кулачный бой', 'Без щита и в лёгких доспехах или без доспехов вы можете бонусным действием совершить безоружный удар. Урон безоружных ударов и кулачного оружия использует Кость кулачного боя: 1к8 на уровнях 1–4, 1к10 на 5–10, 1к12 на 11–16 и 2к6 на 17–20. Простое рукопашное и импровизированное оружие считается кулачным; импровизированное оружие получает мастерство «Ослабляющее».'],
  [1, 'PUG-F02', 'Железная челюсть', 'Без щита и в лёгких доспехах или без доспехов ваша базовая КЗ равна 12 + модификатор Телосложения.'],
  [2, 'PUG-F03', 'Удаль', 'Вы получаете Очки удали по таблице класса и восстанавливаете их после короткого или долгого отдыха. За 1 очко можно бонусным действием получить временные хиты (Кость кулачного боя + Телосложение + уровень), нанести два безоружных удара либо нанести один удар и совершить Рывок или Отход.'],
  [2, 'PUG-F04', 'Окровавлен, но не сломлен', 'Реакцией после получения урона восстановите все Очки удали. Если вы окровавлены, получите временные хиты, равные четырём уровням Кулачника. Использование восстанавливается после короткого или долгого отдыха.'],
  [2, 'PUG-F05', 'На кураже', 'После провала проверки Силы, Ловкости, Телосложения или Харизмы потратьте 1 Очко удали и добавьте Кость кулачного боя. Если проверка всё равно провалена, очко возвращается, а умение блокируется до отдыха.'],
  [3, 'PUG-F06', 'Тяжёлая рука', 'При попадании безоружным ударом можно одновременно нанести урон и применить Захват либо Толчок.'],
  [3, 'PUG-F07', 'Подкласс кулачника', 'На 3-м уровне выберите подкласс Кулачника. Новые умения подкласса открываются на 3, 6, 11 и 17 уровнях.'],
  [4, 'PUG-F08', 'Глубокий резерв', 'Бонусным действием на 10 минут получите сопротивление дробящему, колющему и рубящему урону и игнорируйте эффекты Истощения ниже 6. Восстановление — долгий отдых либо добровольный уровень Истощения.'],
  [5, 'PUG-F09', 'Дополнительная атака', 'Действием Атака вы совершаете две атаки вместо одной.'],
  [5, 'PUG-F10', 'Размашистый удар', 'Перед безоружной атакой или атакой кулачным оружием можно потратить 1 Очко удали. При попадании очко возвращается, а атака наносит максимальный урон.'],
  [6, 'PUG-F11', 'Удалые кулаки', 'Урон безоружных ударов и импровизированного оружия может стать силовым вместо обычного типа.'],
  [7, 'PUG-F12', 'Побит, но не выбит', 'Если вы окровавлены при применении «Окровавлен, но не сломлен», на 1 минуту добавляйте к урону безоружных ударов и кулачного оружия модификатор Телосложения + уровни Истощения. Раз за долгий отдых.'],
  [9, 'PUG-F13', 'Школа суровых затрещин', 'Раз за ход при попадании нанесите ещё 1к12 урона того же типа либо замените его эффектом: следующая попавшая атака наносит максимум урона, или цель получает помеху на атаки не по вам до конца вашего следующего хода.'],
  [10, 'PUG-F14', 'Геркулес', 'Сила удваивается при расчёте грузоподъёмности, дальность прыжков удваивается, а безоружные попадания по объектам становятся критическими.'],
  [10, 'PUG-F15', 'Встал — встряхнулся', 'В начале хода снимите 1 уровень Истощения либо одно состояние: Испуганный, Оглохший, Опутанный, Отравленный, Ослеплённый, Очарованный, Ошеломлённый или Парализованный. Восстановление — долгий отдых либо добровольный уровень Истощения.'],
  [13, 'PUG-F16', 'Глубочайший резерв', 'Бонусным действием на 1 минуту получите преимущества Глубокого резерва и применяйте Школу суровых затрещин дважды за ход. Раз за долгий отдых; с 20-го уровня — дважды.'],
  [14, 'PUG-F17', 'Несокрушимый', 'Спасброски Силы, Ловкости и Телосложения совершаются с преимуществом. Проваленный спасбросок можно перебросить за 1 Очко удали.'],
  [15, 'PUG-F18', 'Напористый', 'При броске инициативы снимите 1 уровень Истощения и восстановите использования умений «Побит, но не выбит», «Глубокий резерв» и «Встал — встряхнулся». Раз за долгий отдых.'],
  [18, 'PUG-F19', 'Боевой дух', 'Когда вы тратите Очко удали, бросьте к6; при 4–6 очко не тратится.'],
  [20, 'PUG-F20', 'Пик физической формы', 'Телосложение увеличивается на 4, максимум становится 24. При броске инициативы восстанавливаются все Очки удали.'],
];

const subclassFeatures = [
  [3, 'PUG-SS01', 'Набитые кулаки', 'Безоружные атаки становятся критическими при результате 19 или 20 на к20.'],
  [3, 'PUG-SS02', 'Перекрёстный удар', 'Получив урон от рукопашной атаки, реакцией потратьте 1 Очко удали и уменьшите урон на 1к10 + модификатор Силы + уровень Кулачника. Если урон снижен до 0, той же реакцией атакуйте существо в досягаемости.'],
  [6, 'PUG-SS03', 'Серия ударов', 'Нанеся урон безоружным ударом, вместо Захвата или Толчка от Тяжёлой руки получите преимущество на атаки по этой цели до начала вашего следующего хода.'],
  [11, 'PUG-SS04', 'Прерванная серия', 'Если Перекрёстный удар уменьшил получаемый урон до 0, восстановите 1 Очко удали.'],
  [17, 'PUG-SS05', 'Нокаут', 'При критическом попадании цель спасается Телосложением (Сл 8 + Сила + бонус владения), иначе становится Бессознательной на 1 минуту или до получения урона. Раз за долгий отдых при попадании безоружным ударом можно реакцией и за 1 Очко удали превратить его в критическое.'],
];

async function all(path, key) { return fetchAll(path, key, { limit: 100 }); }
async function main() {
  const [classes, effects] = await Promise.all([all('/api/classes', 'classes'), all('/api/effects', 'effects')]);
  const token = APPLY ? await login() : null;
  const byCard = new Map(effects.map((x) => [x.card_number, x]));
  const stats = { createdEffects: 0, updatedEffects: 0, createdClasses: 0, updatedClasses: 0 };

  async function upsertEffect([level, card_number, name, description]) {
    const payload = { name, description, rarity: 'common', card_number, effect_type: 'class_ability', author: 'Admin', source: SOURCE };
    const old = byCard.get(card_number);
    if (!APPLY) return { id: `<dry:${card_number}>`, level };
    const saved = old
      ? await apiRequest(token, 'PUT', `/api/effects/${old.id}`, { ...payload, image_url: old.image_url || '' })
      : await apiRequest(token, 'POST', '/api/effects', payload);
    stats[old ? 'updatedEffects' : 'createdEffects']++;
    byCard.set(card_number, saved);
    return { id: saved.id, level };
  }

  const baseRefs = await Promise.all(baseFeatures.map(upsertEffect));
  const subRefs = await Promise.all(subclassFeatures.map(upsertEffect));
  const progression = (refs) => refs.reduce((out, x) => { (out[String(x.level)] ||= { effects: [], actions: [] }).effects.push(x.id); return out; }, {});
  const baseProgression = progression(baseRefs);
  const sharedAdvancement = {
    4: '5dbd9afb-b125-4038-9d51-54819757c777', 8: '55689cd6-f67f-4368-8a96-53bc134fd78b',
    12: '6ec4b5ab-4abc-47af-b45a-560ca2a1bb07', 16: 'f3a0400f-579f-4a68-8105-cfad1d862357',
    19: 'f5694b06-f2f8-40a7-8521-cc6bfe1e93c6',
  };
  for (const [level, id] of Object.entries(sharedAdvancement)) (baseProgression[level] ||= { effects: [], actions: [] }).effects.push(id);
  const moxie = { by_level: { 2: 2, 4: 3, 6: 4, 8: 5, 10: 6, 12: 7, 14: 8, 16: 9, 18: 10, 19: 11, 20: 12 }, per: 'short_rest' };
  const classBody = {
    name: 'Кулачник', name_en: 'Pugilist', description: 'Уличный боец, который полагается на кулаки, выносливость и безграничный кураж.',
    detailed_description: 'Кость хитов: к10. Основная характеристика: Сила. Спасброски: Сила и Телосложение. Подкласс выбирается на 3-м уровне. Кость кулачного боя: к8 (1–4), к10 (5–10), к12 (11–16), 2к6 (17–20).',
    rarity: 'common', card_number: 'CLASS-pugilist', hit_die: 'd10', primary_abilities: ['str'], recommended_abilities: { str: 15, con: 15, dex: 13, cha: 10, wis: 10, int: 8 },
    saving_throws: ['str', 'con'], armor_training: ['light'], weapon_proficiencies: ['simple', 'improvised'], tool_proficiencies: ['gaming_set'],
    skill_choices: { count: 2, options: ['acrobatics', 'athletics', 'perception', 'intimidation', 'sleight_of_hand', 'deception', 'stealth'] },
    level_progression: baseProgression, resources: { moxie }, source: SOURCE, author: 'Admin', tags: ['Кулачник', 'Немагический класс'], is_extended: true,
  };
  let parent = classes.find((x) => x.card_number === 'CLASS-pugilist');
  if (APPLY) {
    parent = parent ? await apiRequest(token, 'PUT', `/api/classes/${parent.id}`, classBody) : await apiRequest(token, 'POST', '/api/classes', classBody);
    stats[parent && classes.some((x) => x.id === parent.id) ? 'updatedClasses' : 'createdClasses']++;
  } else parent = parent || { id: '<dry:pugilist>' };

  const subBody = { name: 'Знаток науки тумаков', name_en: 'The Sweet Science', description: 'Боксёр, который превращает точную защиту, серии ударов и критические попадания в искусство.', rarity: 'common', card_number: 'SUB-pugilist-sweet-science', is_subclass: true, parent_class_id: parent.id, subclass_level: 3, level_progression: progression(subRefs), source: SOURCE, author: 'Admin', tags: ['Кулачник', 'Подкласс', 'Бокс'], is_extended: true };
  const oldSub = classes.find((x) => x.card_number === subBody.card_number || x.name === subBody.name);
  if (APPLY) {
    const saved = oldSub ? await apiRequest(token, 'PUT', `/api/classes/${oldSub.id}`, subBody) : await apiRequest(token, 'POST', '/api/classes', subBody);
    stats[oldSub ? 'updatedClasses' : 'createdClasses']++;
    console.log(JSON.stringify({ stats, class: { id: parent.id, card_number: parent.card_number }, subclass: { id: saved.id, card_number: saved.card_number } }, null, 2));
  } else console.log(JSON.stringify({ dryRun: true, effects: baseFeatures.length + subclassFeatures.length, classes: 2 }, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
