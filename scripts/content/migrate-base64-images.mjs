/**
 * B1: миграция base64-иконок (data-URL в image_url) в Yandex Object Storage.
 *
 * ⚠️ НЕ ДЕЙСТВУЕТ с 2026-07-16: роут POST /api/images/upload-base64 удалён (KB-202) как
 * анонимная неограниченная запись в облачный бакет. Скрипт оставлен как история одноразовой
 * миграции. Чтобы запустить снова: восстановить хендлер UploadBase64Image + роут ПОД РЕАЛЬНОЙ
 * авторизацией (после починки AuthMiddleware, KB-165) и добавить сюда логин/токен.
 *
 * Проходит spells/actions/feats/effects, у кого image_url начинается с 'data:':
 *   POST /api/images/upload-base64 {data}  → постоянная https-ссылка;
 *   PUT  /api/<type>/<id> {image_url}       → заменяет data-URL ссылкой.
 *
 * Запуск:  node scripts/content/migrate-base64-images.mjs [--dry]
 * Отчёт:   scripts/content/batches/data/migrate-base64-report.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { apiUrl, fetchAll, apiRequest } from './api.mjs';

const TYPES = [
  { path: '/api/spells', key: 'spells' },
  { path: '/api/actions', key: 'actions' },
  { path: '/api/feats', key: 'feats' },
  { path: '/api/effects', key: 'effects' },
];
const DRY = process.argv.includes('--dry');
const FOLDER = 'migrated_icons';
const REPORT = 'scripts/content/batches/data/migrate-base64-report.json';

const isDataUrl = (v) => typeof v === 'string' && v.startsWith('data:');

async function uploadBase64(dataUrl) {
  const res = await apiRequest(null, 'POST', '/api/images/upload-base64', { data: dataUrl, folder: FOLDER });
  if (!res?.image_url) throw new Error('нет image_url в ответе upload-base64');
  return res.image_url;
}

async function main() {
  const report = { startedAt: new Date().toISOString(), api: apiUrl(), dryRun: DRY, byType: {} };
  for (const { path: p, key } of TYPES) {
    // limit=50: страницы поменьше, т.к. base64-картинки тяжёлые.
    const items = await fetchAll(p, key, { limit: 50 });
    const candidates = items.filter((it) => isDataUrl(it.image_url));
    const r = { total: items.length, base64: candidates.length, migrated: 0, failed: [] };
    console.log(`\n=== ${key}: ${candidates.length}/${items.length} с base64 ===`);
    for (const it of candidates) {
      try {
        if (DRY) { r.migrated++; continue; }
        const url = await uploadBase64(it.image_url);
        await apiRequest(null, 'PUT', `${p}/${it.id}`, { image_url: url });
        r.migrated++;
        if (r.migrated % 10 === 0) console.log(`  ${key}: ${r.migrated}/${candidates.length}`);
        await new Promise((res) => setTimeout(res, 40));
      } catch (err) {
        console.error(`  FAIL ${key} ${it.name || it.id}: ${err.message}`);
        r.failed.push({ id: it.id, name: it.name, error: String(err.message).slice(0, 200) });
      }
    }
    report.byType[key] = r;
    console.log(`  ${key}: мигрировано ${r.migrated}, ошибок ${r.failed.length}`);
  }
  report.finishedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(REPORT), { recursive: true });
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
  const totals = Object.values(report.byType).reduce(
    (a, r) => ({ base64: a.base64 + r.base64, migrated: a.migrated + r.migrated, failed: a.failed + r.failed.length }),
    { base64: 0, migrated: 0, failed: 0 },
  );
  console.log(`\nИТОГО: base64=${totals.base64}, мигрировано=${totals.migrated}, ошибок=${totals.failed}. Отчёт: ${REPORT}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
