/**
 * Боевые стили как черты (PHB 2024, глава 5 «Черты», категория fighting_style).
 *
 * Что делает (идемпотентно):
 *  1. Для каждого боевого стиля гарантирует эффект-«бусину» (POST/PUT /api/effects,
 *     card_number fs_*): Оборона — исполнимый modifier +1 к КЗ, остальные —
 *     narrative с точным текстом правила (движок не умеет фильтры по типу
 *     оружия/перебросы, поэтому не выдумываем исполнимые модификаторы).
 *  2. Гарантирует черту категории fighting_style (создаёт, если нет; чинит
 *     описание по тексту книги) и привязывает related_effects к эффекту стиля.
 *  3. Переключает choice-эффекты классов «Боевой стиль» (Воин, Паладин,
 *     Следопыт) с явного списка options.items на
 *     {"source":"feat","filter":"fighting_style"} + grant {kind:"grant_feat"}.
 *
 * Запуск: node scripts/content/seed-fighting-styles.mjs           (dry-run)
 *         node scripts/content/seed-fighting-styles.mjs --apply   (прод)
 */
import { apiRequest, fetchAll, login } from './api.mjs';

const APPLY = process.argv.includes('--apply');
const dryRun = !APPLY;

// Тексты — дословно из officials/kb/phb-2024-ru/pages/page-210..211.txt.
// Названия черт — как в книге и как уже заведено в проде (FEAT-0054..0063):
// «Оборона» = Defense (+1 КЗ в доспехе), «Защита» = Protection (реакция со щитом).
const STYLES = [
  {
    slug: 'fs_archery',
    feat: 'Стрельба',
    text: 'Вы получаете бонус +2 к броскам атаки Дальнобойным оружием.',
  },
  {
    slug: 'fs_defense',
    feat: 'Оборона',
    text: 'Пока вы носите Лёгкий, Средний или Тяжёлый доспех, вы получаете бонус +1 к Классу Защиты.',
    // Единственный стиль с исполнимой механикой: +1 КЗ (пока в доспехе — narrative-оговорка).
    result: [
      { kind: 'modifier', applies_to: { roll: 'ac' }, op: 'add', value: '+1', source: 'Боевой стиль: Оборона' },
      { kind: 'narrative', description: 'Бонус действует, только пока вы носите доспех.' },
    ],
  },
  {
    slug: 'fs_dueling',
    feat: 'Дуэлянт',
    text: 'Пока вы держите Рукопашное оружие в одной руке и не используете другого оружия, вы получаете бонус +2 к броскам урона этим оружием.',
  },
  {
    slug: 'fs_great_weapon',
    feat: 'Сражение большим оружием',
    text: 'Когда вы совершаете бросок урона атаки Рукопашным оружием, которое вы держите двумя руками, то можете считать все выпавшие на костях урона результаты «1» и «2» как «3». Чтобы использовать это преимущество, оружие должно иметь свойство Двуручное или Универсальное.',
  },
  {
    slug: 'fs_protection',
    feat: 'Защита',
    text: 'Когда видимое вами существо атакует другое существо, кроме вас, в пределах 5 футов от вас, вы можете Реакцией выставить Щит, если вы носите его. В этом случае инициирующая атака совершается с Помехой, и все остальные броски атак по цели до начала вашего следующего хода тоже совершаются с Помехой, если вы остаётесь в пределах 5 футов от цели.',
  },
  {
    slug: 'fs_two_weapon',
    feat: 'Сражение двумя оружиями',
    text: 'Когда вы совершаете дополнительную атаку от свойства Лёгкое, вы можете добавить ваш модификатор характеристики к урону, если ещё не добавляли этот модификатор к урону этой атаки.',
  },
  {
    slug: 'fs_interception',
    feat: 'Перехват',
    text: 'Когда видимое вами существо попадает броском атаки по другому существу в пределах 5 футов от вас, вы можете Реакцией уменьшить получаемый целью урон на 1к10 + ваш Бонус владения. Чтобы использовать эту Реакцию, вы должны держать в руках либо Щит, либо Простое или Воинское оружие.',
  },
  {
    slug: 'fs_unarmed',
    feat: 'Сражение без оружия',
    text: 'Когда вы попадаете Безоружным ударом и наносите урон, вместо обычного урона Безоружного удара вы можете нанести Дробящий урон, равный 1к6 + ваш модификатор Силы. Если вы не держите ни оружия, ни Щита, то в этом броске атаки к6 становится к8. В начале каждого вашего хода вы можете нанести 1к4 Дробящего урона одному Схваченному вами существу.',
  },
  {
    slug: 'fs_blind_fighting',
    feat: 'Сражение вслепую',
    text: 'Вы получаете Слепое зрение в пределах 10 футов.',
  },
  {
    slug: 'fs_thrown_weapon',
    feat: 'Сражение метательным оружием',
    text: 'Когда вы попадаете дальнобойной атакой оружием со свойством Метательное, вы получаете бонус +2 к броску урона.',
  },
];

const styleMechanics = (s) => ({
  activation: { mode: 'passive' },
  effects: [
    {
      resolution: 'auto',
      result: s.result ?? [{ kind: 'narrative', description: s.text }],
    },
  ],
});

// Сравнение с нормализацией порядка ключей (jsonb в Postgres сортирует ключи).
const canon = (v) => {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])]));
  }
  return v;
};
const eq = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

async function ensureStyleEffect(token, s, effectsBySlug) {
  const wantMech = styleMechanics(s);
  const name = `Боевой стиль: ${s.feat}`;
  const existing = effectsBySlug.get(s.slug);
  if (!existing) {
    console.log(`[effect] создаю ${s.slug} «${name}»`);
    const created = await apiRequest(token, 'POST', '/api/effects', {
      name,
      description: s.text,
      rarity: 'common',
      card_number: s.slug,
      effect_type: 'class_ability',
      mechanics: wantMech,
      author: 'Admin',
      source: 'PHB 2024',
    }, { dryRun });
    return created?.id ?? `dry-${s.slug}`;
  }
  const patch = {};
  if (existing.name !== name) patch.name = name;
  if (existing.description !== s.text) patch.description = s.text;
  if (existing.effect_type !== 'class_ability') patch.effect_type = 'class_ability';
  if (!eq(existing.mechanics, wantMech)) patch.mechanics = wantMech;
  if (Object.keys(patch).length) {
    console.log(`[effect] обновляю ${s.slug}: ${Object.keys(patch).join(', ')}`);
    await apiRequest(token, 'PUT', `/api/effects/${existing.id}`, patch, { dryRun });
  } else {
    console.log(`[effect] ${s.slug} актуален`);
  }
  return existing.id;
}

async function ensureFeat(token, s, effectId, featsByName) {
  const existing = featsByName.get(s.feat);
  if (!existing) {
    console.log(`[feat] создаю «${s.feat}» (fighting_style)`);
    await apiRequest(token, 'POST', '/api/feats', {
      name: s.feat,
      description: s.text,
      rarity: 'common',
      category: 'fighting_style',
      prerequisite: 'умение Боевой стиль',
      related_effects: [effectId],
      author: 'Admin',
      source: 'PHB 2024',
    }, { dryRun });
    return;
  }
  const patch = {};
  if (existing.description !== s.text) patch.description = s.text;
  const rel = existing.related_effects || [];
  if (!rel.includes(effectId)) patch.related_effects = [...rel, effectId];
  if (existing.category !== 'fighting_style') patch.category = 'fighting_style';
  if (Object.keys(patch).length) {
    console.log(`[feat] обновляю «${s.feat}»: ${Object.keys(patch).join(', ')}`);
    await apiRequest(token, 'PUT', `/api/feats/${existing.id}`, patch, { dryRun });
  } else {
    console.log(`[feat] «${s.feat}» актуальна`);
  }
}

/** Переключить choice «выбор боевого стиля» с explicit-списка на source:feat. */
function switchChoicePayload(payload) {
  if (payload?.kind !== 'choice') return false;
  const id = String(payload.id ?? '');
  const opts = payload.options || {};
  if (!/fighting_style/.test(id)) return false;
  if (opts.source === 'feat' && opts.filter === 'fighting_style' && payload.grant?.kind === 'grant_feat') {
    return false; // уже переключён
  }
  payload.options = { source: 'feat', filter: 'fighting_style' };
  payload.grant = { kind: 'grant_feat' };
  return true;
}

async function switchClassChoiceEffects(token, allEffects) {
  for (const e of allEffects) {
    const mech = e.mechanics;
    const list = Array.isArray(mech?.effects) ? mech.effects : [];
    let changed = false;
    for (const it of list) {
      if (it?.kind === 'choice') changed = switchChoicePayload(it) || changed;
      else if (it?.resolution === 'auto' && Array.isArray(it.result)) {
        for (const p of it.result) changed = switchChoicePayload(p) || changed;
      }
    }
    if (changed) {
      console.log(`[choice] переключаю «${e.name}» (${e.card_number || e.id}) на source:feat/fighting_style`);
      await apiRequest(token, 'PUT', `/api/effects/${e.id}`, { mechanics: mech }, { dryRun });
    }
  }
}

(async () => {
  console.log(dryRun ? '── DRY-RUN (без --apply ничего не пишем) ──' : '── APPLY: пишем в прод ──');
  const token = dryRun ? null : await login();

  const [effects, feats] = await Promise.all([
    fetchAll('/api/effects', 'effects'),
    fetchAll('/api/feats', 'feats'),
  ]);
  const effectsBySlug = new Map(effects.filter((e) => e.card_number).map((e) => [e.card_number, e]));
  const featsByName = new Map(feats.filter((f) => f.category === 'fighting_style').map((f) => [f.name, f]));

  for (const s of STYLES) {
    const effectId = await ensureStyleEffect(token, s, effectsBySlug);
    await ensureFeat(token, s, effectId, featsByName);
  }

  await switchClassChoiceEffects(token, effects);
  console.log('Готово.');
})().catch((err) => {
  console.error('FAILED:', err.message || err);
  process.exit(1);
});
