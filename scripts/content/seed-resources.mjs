#!/usr/bin/env node
/**
 * Заводит в систему ресурсов (справочник /api/resources) все ресурсы,
 * которые встречаются в klass.resources и payload-ах механик, но записей
 * не имеют (luck_points, bardic_inspiration и т.п.). Идемпотентен.
 * Также чинит перезарядку по PHB 2024: second_wind/action_surge/focus — short_rest.
 *
 * Запуск: node scripts/content/seed-resources.mjs [--apply]
 */
import { apiRequest, fetchAll, login } from './api.mjs';

const APPLY = process.argv.includes('--apply');

const DEFS = [
  { resource_id: 'second_wind', name: 'Второе дыхание', category: 'class_resource', recharge: 'short_rest', sort_order: 20, description: 'Воин: бонусным действием восстановите 1к10 + уровень воина хитов.' },
  { resource_id: 'action_surge', name: 'Всплеск действий', category: 'class_resource', recharge: 'short_rest', sort_order: 21, description: 'Воин: одно дополнительное действие в свой ход.' },
  { resource_id: 'bardic_inspiration', name: 'Вдохновение барда', category: 'class_resource', recharge: 'long_rest', sort_order: 22, description: 'Бард: кость вдохновения союзнику (бонусное действие); зарядов — модификатор Харизмы.' },
  { resource_id: 'focus', name: 'Очки фокусировки', category: 'class_resource', recharge: 'short_rest', sort_order: 23, description: 'Монах: топливо техник (Шквал ударов, Терпение защиты, Шаг ветра).' },
  { resource_id: 'sorcery_points', name: 'Очки чародейства', category: 'class_resource', recharge: 'long_rest', sort_order: 24, description: 'Чародей: метамагия и преобразование ячеек.' },
  { resource_id: 'wild_shape', name: 'Дикий облик', category: 'class_resource', recharge: 'long_rest', sort_order: 25, description: 'Друид: превращение в зверя (1 заряд восстанавливается на коротком отдыхе).' },
  { resource_id: 'channel_divinity', name: 'Божественный канал', category: 'class_resource', recharge: 'short_rest', sort_order: 26, description: 'Жрец/Паладин: проведение божественной силы.' },
  { resource_id: 'luck_points', name: 'Очки удачи', category: 'character_resource', recharge: 'long_rest', sort_order: 40, description: 'Черта «Везунчик»: преимущество/помеха на к20 (зарядов — бонус мастерства).' },
  ...Array.from({ length: 9 }, (_, i) => ({
    resource_id: `spell_slot_${i + 1}`,
    name: `Ячейка ${i + 1}-го круга`,
    category: 'class_resource',
    recharge: 'long_rest',
    sort_order: 30 + i,
    description: `Ячейка заклинаний ${i + 1}-го круга.`,
  })),
];

// Перезарядка по PHB 2024 в klass.resources (движок читает поле per/recharge оттуда).
const CLASS_RECHARGE_FIX = {
  'Воин': { second_wind: 'short_rest', action_surge: 'short_rest' },
  'Монах': { focus: 'short_rest' },
};

async function main() {
  const existing = await fetch('https://backend-production-41c3.up.railway.app/api/resources').then((r) => r.json());
  const have = new Set((existing.resources || []).map((r) => r.resource_id));
  const missing = DEFS.filter((d) => !have.has(d.resource_id));
  console.log(`Справочник: ${have.size} записей; добавить: ${missing.length}; режим: ${APPLY ? 'APPLY' : 'dry-run'}`);
  const token = APPLY ? await login() : null;
  for (const def of missing) {
    console.log(' +', def.resource_id, '—', def.name);
    if (APPLY) await apiRequest(token, 'POST', '/api/resources', def);
  }

  const classes = await fetchAll('/api/classes', 'classes');
  for (const [className, fixes] of Object.entries(CLASS_RECHARGE_FIX)) {
    const cl = classes.find((c) => c.name === className && !c.is_subclass);
    if (!cl?.resources) continue;
    let changed = false;
    const resources = JSON.parse(JSON.stringify(cl.resources));
    for (const [rid, per] of Object.entries(fixes)) {
      const entry = resources[rid];
      if (entry && typeof entry === 'object' && entry.per !== per && entry.recharge !== per) {
        if ('per' in entry || !('recharge' in entry)) entry.per = per;
        if ('recharge' in entry) entry.recharge = per;
        changed = true;
        console.log(` ~ ${className}.${rid} → ${per}`);
      }
    }
    if (changed && APPLY) await apiRequest(token, 'PUT', `/api/classes/${cl.id}`, { resources });
  }
  console.log('Готово.');
}

main().catch((e) => { console.error(e); process.exit(1); });
