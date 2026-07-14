/**
 * Ресурс «Наследие великанов» (giant_legacy) как ПОЛНОЦЕННАЯ data-driven сущность в потоке
 * ресурсов (ResourceDefinition, /api/resources) — как rage_charge и остальные 24 ресурса.
 * Раньше giant_legacy жил ТОЛЬКО хардкодом во фронте (registries.ts + fallback-мапы), из-за чего
 * не появлялся в библиотеке «Ресурсы» и плитка на листе не подтягивала имя/восстановление из данных.
 *
 * Идемпотентно: PUT, если ресурс уже есть, иначе POST.
 * Запуск: node scripts/content/giant-legacy-resource.mjs
 */
const BASE = process.env.API_URL || 'https://backend-production-41c3.up.railway.app';

const DEF = {
  resource_id: 'giant_legacy',
  name: 'Наследие великанов',
  description: 'Заряды наследия великанов Голиафа: тратятся на способности подвида (Огненный ожог, Морозная поступь, Толчок холмов и т.п.). Количество зарядов = бонус мастерства; восстанавливаются после долгого отдыха.',
  category: 'class_resource',
  recharge: 'long_rest',
  image_url: '',
  image_url_spent: '',
  sort_order: 110,
};

async function main() {
  const existing = await fetch(`${BASE}/api/resources/giant_legacy`);
  const method = existing.ok ? 'PUT' : 'POST';
  const url = existing.ok ? `${BASE}/api/resources/giant_legacy` : `${BASE}/api/resources`;
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(DEF) });
  console.log(res.ok
    ? `${method} ресурс giant_legacy → «${DEF.name}» (${DEF.category}, ${DEF.recharge})`
    : `FAIL: ${res.status} ${await res.text()}`);
  console.log('DONE');
}
main().catch((e) => { console.error(e); process.exit(1); });
