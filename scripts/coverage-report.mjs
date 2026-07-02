#!/usr/bin/env node
/**
 * Отчёт покрытия контента MVP (фаза G1).
 * Запуск: node scripts/coverage-report.mjs [--json] [--strict]
 * Переменные: API_URL
 */
import { apiUrl, buildIndex, fetchAll, resolveRef } from './content/api.mjs';
import {
  hasCyrillic,
  hasMechanics,
  isExecutableAction,
  isPassiveEffect,
  isSkillId,
  progressionRefs,
} from './content/mechanics.mjs';
import {
  MVP_BACKGROUND_COUNT,
  MVP_CLASSES,
  MVP_LEVELS,
  MVP_ORIGIN_FEAT_COUNT,
  MVP_ORIGIN_FEAT_NAMES,
  MVP_RACE_COUNT,
  MVP_SPELL_LEVELS,
  classSpecBySlug,
} from './content/mvp-requirements.mjs';

const JSON_OUT = process.argv.includes('--json');
const STRICT = process.argv.includes('--strict');

function gap(entity, message) {
  return { entity, message };
}

function pct(n, total) {
  if (!total) return '—';
  return `${Math.round((n / total) * 100)}%`;
}

function activationMode(entity) {
  return entity?.mechanics?.activation?.mode ?? null;
}

function checkClass(cls, indexes) {
  const issues = [];
  const spec = classSpecBySlug(cls.card_number);
  const label = cls.card_number || cls.name;

  if (!cls.hit_die) issues.push(gap(label, 'нет hit_die'));
  else if (spec && cls.hit_die !== spec.hitDie) {
    issues.push(gap(label, `hit_die ${cls.hit_die}, ожидается ${spec.hitDie}`));
  }
  if (!cls.saving_throws?.length) issues.push(gap(label, 'нет saving_throws'));
  const sc = cls.skill_choices;
  if (!sc?.options?.length) issues.push(gap(label, 'нет skill_choices.options'));
  else if (!sc.count) issues.push(gap(label, 'skill_choices без count'));

  if (spec?.needsResources && !cls.resources) {
    issues.push(gap(label, 'нет resources (нужны для классовых зарядов)'));
  }

  const prog = cls.level_progression || {};
  for (const lvl of MVP_LEVELS) {
    const key = String(lvl);
    if (!prog[key]) {
      issues.push(gap(label, `нет level_progression[${key}]`));
      continue;
    }
    const { effects, actions } = progressionRefs(prog[key]);
    if (!effects.length && !actions.length) {
      issues.push(gap(label, `L${lvl}: пустой progression`));
    }
    for (const ref of effects) {
      const eff = resolveRef(ref, indexes.effect);
      if (!eff) issues.push(gap(label, `L${lvl}: effect ${ref} не найден`));
      else if (!hasMechanics(eff)) issues.push(gap(label, `L${lvl}: effect «${eff.name}» без mechanics`));
      else if (!isPassiveEffect(eff) && activationMode(eff) !== 'triggered') {
        issues.push(gap(label, `L${lvl}: effect «${eff.name}» не passive/triggered`));
      }
    }
    for (const ref of actions) {
      const act = resolveRef(ref, indexes.action);
      if (!act) issues.push(gap(label, `L${lvl}: action ${ref} не найден`));
      else if (!isExecutableAction(act)) {
        issues.push(gap(label, `L${lvl}: action «${act.name}» не исполняемая (active + effects)`));
      }
    }
  }

  if (spec?.caster) {
    const l1 = prog['1'];
    const effectIds = l1?.effects || [];
    const hasSpellcasting = effectIds.some((ref) => {
      const eff = resolveRef(ref, indexes.effect);
      if (!eff?.mechanics?.effects) return false;
      const mechStr = JSON.stringify(eff.mechanics);
      return mechStr.includes('grant_spell') || mechStr.includes('"source":"spell"');
    });
    if (!hasSpellcasting) issues.push(gap(label, 'кастер без spellcasting/grant_spell в L1'));
  }

  return issues;
}

function checkRace(race) {
  const issues = [];
  const label = race.card_number || race.name;
  const refs = [
    ...(race.related_effects || []),
    ...(race.related_actions || []),
  ];
  const hasLineages = Array.isArray(race.lineages) && race.lineages.length > 0;

  if (!hasLineages) issues.push(gap(label, 'пустые lineages (G5)'));
  if (!refs.length && !hasLineages) {
    issues.push(gap(label, 'нет related_effects/actions и lineages'));
  }
  return issues;
}

function checkBackground(bg) {
  const issues = [];
  const label = bg.card_number || bg.name;
  for (const s of bg.skill_proficiencies || []) {
    if (hasCyrillic(s)) issues.push(gap(label, `skill «${s}» — не id`));
    else if (!isSkillId(s)) issues.push(gap(label, `skill «${s}» — подозрительный id`));
  }
  if (bg.origin_feat && hasCyrillic(String(bg.origin_feat))) {
    issues.push(gap(label, `origin_feat «${bg.origin_feat}» — не slug`));
  }
  if (!bg.equipment_options && !bg.starting_equipment) {
    issues.push(gap(label, 'нет equipment_options (G6)'));
  }
  return issues;
}

function checkOriginFeat(feat, indexes) {
  const issues = [];
  const label = feat.card_number || feat.name;
  const effectRefs = feat.related_effects || [];
  if (!effectRefs.length) {
    issues.push(gap(label, 'нет related_effects'));
    return issues;
  }
  for (const ref of effectRefs) {
    const eff = resolveRef(ref, indexes.effect);
    if (!eff) issues.push(gap(label, `effect ${ref} не найден`));
    else if (!hasMechanics(eff)) issues.push(gap(label, `effect «${eff.name}» без mechanics`));
  }
  return issues;
}

async function main() {
  const [
    classes, races, backgrounds, feats, effects, actions, spells,
  ] = await Promise.all([
    fetchAll('/api/classes', 'classes'),
    fetchAll('/api/races', 'races'),
    fetchAll('/api/backgrounds', 'backgrounds'),
    fetchAll('/api/feats', 'feats'),
    fetchAll('/api/effects', 'effects'),
    fetchAll('/api/actions', 'actions'),
    fetchAll('/api/spells', 'spells'),
  ]);

  const indexes = {
    effect: buildIndex(effects),
    action: buildIndex(actions),
    class: buildIndex(classes),
  };

  const classBySlug = new Map(classes.map((c) => [c.card_number, c]));
  const missingClasses = MVP_CLASSES.filter((spec) => !classBySlug.has(spec.slug));

  const allGaps = [];

  for (const spec of MVP_CLASSES) {
    const cls = classBySlug.get(spec.slug);
    if (!cls) {
      allGaps.push(gap(spec.slug, 'класс отсутствует в БД'));
      continue;
    }
    allGaps.push(...checkClass(cls, indexes));
  }

  for (const race of races) allGaps.push(...checkRace(race));

  const originFeats = feats.filter((f) => {
    const cat = String(f.category || f.feat_category || '').toLowerCase();
    if (cat.includes('origin') || cat.includes('происх')) return true;
    return MVP_ORIGIN_FEAT_NAMES.some((n) => f.name?.includes(n.split(' ')[0]));
  });
  for (const feat of originFeats) allGaps.push(...checkOriginFeat(feat, indexes));

  for (const bg of backgrounds) allGaps.push(...checkBackground(bg));

  const spells01 = spells.filter((s) => MVP_SPELL_LEVELS.includes(s.level ?? -1));
  const spells01WithMech = spells01.filter(hasMechanics);

  const report = {
    api: apiUrl(),
    summary: {
      classes: { have: classes.length, need: MVP_CLASSES.length, ok: missingClasses.length === 0 },
      races: { have: races.length, need: MVP_RACE_COUNT, ok: races.length >= MVP_RACE_COUNT },
      backgrounds: { have: backgrounds.length, need: MVP_BACKGROUND_COUNT, ok: backgrounds.length >= MVP_BACKGROUND_COUNT },
      originFeats: { have: originFeats.length, need: MVP_ORIGIN_FEAT_COUNT },
      spellsL01: {
        have: spells01.length,
        withMechanics: spells01WithMech.length,
        coverage: pct(spells01WithMech.length, spells01.length),
      },
      effects: { total: effects.length, withMechanics: effects.filter(hasMechanics).length },
      actions: { total: actions.length, executable: actions.filter(isExecutableAction).length },
      gaps: allGaps.length,
    },
    missingClasses: missingClasses.map((c) => c.slug),
    gaps: allGaps,
  };

  if (JSON_OUT) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`\n📊 Отчёт покрытия MVP — ${report.api}\n`);
    console.log('── Сводка ──');
    console.log(`Классы:      ${classes.length}/${MVP_CLASSES.length}${missingClasses.length ? ` (нет: ${missingClasses.map((c) => c.slug.replace('CLASS-', '')).join(', ')})` : ' ✓'}`);
    console.log(`Виды:        ${races.length}/${MVP_RACE_COUNT}${races.length >= MVP_RACE_COUNT ? ' ✓' : ''}`);
    console.log(`Предыстории: ${backgrounds.length}/${MVP_BACKGROUND_COUNT}${backgrounds.length >= MVP_BACKGROUND_COUNT ? ' ✓' : ''}`);
    console.log(`Черты origin: ${originFeats.length}/${MVP_ORIGIN_FEAT_COUNT}`);
    console.log(`Заклинания 0–1: механики ${spells01WithMech.length}/${spells01.length} (${pct(spells01WithMech.length, spells01.length)})`);
    console.log(`Эффекты:     ${effects.filter(hasMechanics).length}/${effects.length} с mechanics`);
    console.log(`Действия:    ${actions.filter(isExecutableAction).length}/${actions.length} исполняемых`);
    console.log(`\n── Пробелы: ${allGaps.length} ──`);

    const byEntity = new Map();
    for (const g of allGaps) {
      if (!byEntity.has(g.entity)) byEntity.set(g.entity, []);
      byEntity.get(g.entity).push(g.message);
    }
    let shown = 0;
    for (const [entity, msgs] of byEntity) {
      if (shown >= 40) {
        console.log(`  … и ещё ${allGaps.length - shown} (используйте --json)`);
        break;
      }
      console.log(`  ${entity}:`);
      for (const m of msgs.slice(0, 5)) console.log(`    • ${m}`);
      if (msgs.length > 5) console.log(`    • … +${msgs.length - 5}`);
      shown += msgs.length;
    }

    if (allGaps.length === 0) {
      console.log('\n✅ Покрытие MVP: замечаний нет\n');
    } else {
      console.log('\n❌ Покрытие неполное. Следующий шаг: батчи G2–G9 (scripts/content/batches/)\n');
    }
  }

  const fail = STRICT && allGaps.length > 0;
  const failMissing = STRICT && missingClasses.length > 0;
  if (fail || failMissing) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
