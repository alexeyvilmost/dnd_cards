#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { apiUrl, fetchAll, login } from './api.mjs';
import {
  ENTITY_ENDPOINTS,
} from './micro-micro-gate.mjs';
import {
  buildCertificationIndex,
  certificationHashes,
} from './certification-hash.mjs';

const STATUSES = new Set([
  'verified_mechanical',
  'verified_partial',
  'verified_narrative',
  'partial',
  'untested',
  'known_mismatch',
]);

function option(name) {
  const position = process.argv.indexOf(`--${name}`);
  return position === -1 ? null : process.argv[position + 1] ?? null;
}

function options(name) {
  const values = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === `--${name}` && process.argv[index + 1]) {
      values.push(process.argv[index + 1]);
    }
  }
  return values;
}

function usage() {
  return [
    'Сертификация одной сущности контента (по умолчанию dry-run):',
    '  npm run content:certify -- --type class --card-number CLASS-warrior',
    '    --status verified_partial --limitation "Только первый уровень"',
    '',
    'Для записи добавьте --apply и задайте CONTENT_CERTIFICATION_KEY.',
    'Опции: --id, --card-number, --version, --note, повторяемый --limitation.',
  ].join('\n');
}

export async function prepareCertification({
  entityType,
  entityId = null,
  cardNumber = null,
  status,
  certificationVersion = 'micro-micro-v1',
  limitations = [],
  note = null,
  fetcher = fetchAll,
}) {
  if (!ENTITY_ENDPOINTS[entityType]) throw new Error(`Неизвестный --type: ${entityType}`);
  if (!STATUSES.has(status)) throw new Error(`Неизвестный --status: ${status}`);
  if (!entityId && !cardNumber) throw new Error('Нужен --id или --card-number');
  if (entityId && cardNumber) throw new Error('Укажите только один из --id/--card-number');
  if (status === 'verified_partial' && !limitations.some((item) => item.trim())) {
    throw new Error('verified_partial требует хотя бы один --limitation');
  }

  const groups = Object.fromEntries(await Promise.all(
    Object.entries(ENTITY_ENDPOINTS).map(async ([type, [path, key]]) => [
      type,
      await fetcher(path, key, { limit: 1000 }),
    ]),
  ));
  const entity = groups[entityType].find((candidate) => (
    entityId ? candidate.id === entityId : candidate.card_number === cardNumber
  ));
  if (!entity) {
    throw new Error(`Сущность не найдена: ${entityType}:${entityId ?? cardNumber}`);
  }

  const index = buildCertificationIndex(groups);
  const hashes = certificationHashes(entity, entityType, index);
  const payload = {
    status,
    content_hash: hashes.contentHash,
    dependency_hash: hashes.dependencyHash,
    certification_version: certificationVersion,
    ...(limitations.length ? { limitations } : {}),
    ...(note ? { note } : {}),
  };

  return {
    entityType,
    entity,
    payload,
    dependencies: hashes.dependencies,
  };
}

async function applyCertification(prepared) {
  const key = process.env.CONTENT_CERTIFICATION_KEY?.trim();
  if (!key) throw new Error('Для --apply нужен CONTENT_CERTIFICATION_KEY');
  const token = await login();
  const response = await fetch(
    `${apiUrl()}/api/content-support/${prepared.entityType}/${prepared.entity.id}`,
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'X-Content-Certification-Key': key,
      },
      body: JSON.stringify(prepared.payload),
    },
  );
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`PUT content-support → ${response.status}: ${text.slice(0, 500)}`);
  }
  return text ? JSON.parse(text) : null;
}

async function main() {
  if (process.argv.includes('--help')) {
    console.log(usage());
    return;
  }
  const prepared = await prepareCertification({
    entityType: option('type'),
    entityId: option('id'),
    cardNumber: option('card-number'),
    status: option('status'),
    certificationVersion: option('version') ?? 'micro-micro-v1',
    limitations: options('limitation'),
    note: option('note'),
  });
  const apply = process.argv.includes('--apply');

  console.log(`${apply ? 'APPLY' : 'DRY-RUN'} ${apiUrl()}`);
  console.log(`${prepared.entityType}: ${prepared.entity.name} (${prepared.entity.id})`);
  console.log(JSON.stringify(prepared.payload, null, 2));
  console.log(`Транзитивных зависимостей: ${prepared.dependencies.length}`);
  for (const dependency of prepared.dependencies) {
    console.log(`- ${dependency.identity} ${dependency.content_hash}`);
  }

  if (!apply) {
    console.log('Запись не выполнялась. После ручной проверки повторите с --apply.');
    return;
  }
  await applyCertification(prepared);
  console.log('Сертификация сохранена.');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error.message ?? error);
    console.error(usage());
    process.exitCode = 1;
  });
}
