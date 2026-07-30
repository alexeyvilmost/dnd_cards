#!/usr/bin/env node
/**
 * Печатает актуальные хэши сущностей, исправленных по приёмке 2026-07-30.
 * Вывод используется миграцией 084; скрипт ничего не изменяет.
 */
import { fetchAll } from './api.mjs';
import {
  buildCertificationIndex,
  certificationHashes,
} from './certification-hash.mjs';
import { ENTITY_ENDPOINTS } from './micro-micro-gate.mjs';

const targets = [
  ['class', 'CLASS-cleric'],
  ['race', 'RACE-0008'],
  ['feat', 'FEAT-0001'],
  ['feat', 'FEAT-0056'],
  ['spell', 'SPELL-0230'],
  ['spell', 'SPELL-0163'],
  ['spell', 'SPELL-0311'],
  ['spell', 'SPELL-0242'],
  ['spell', 'SPELL-0171'],
  ['race', 'sub-white'],
  ['race', 'sub-bronze'],
  ['race', 'sub-green'],
  ['race', 'sub-gold'],
  ['race', 'sub-red'],
  ['race', 'sub-brass'],
  ['race', 'sub-copper'],
  ['race', 'sub-silver'],
  ['race', 'sub-blue'],
  ['race', 'sub-black'],
  ['race', 'sub-high_elf'],
  ['race', 'sub-drow'],
  ['race', 'sub-wood_elf'],
];

const groups = Object.fromEntries(await Promise.all(
  Object.entries(ENTITY_ENDPOINTS).map(async ([type, [path, key]]) => [
    type,
    await fetchAll(path, key, { limit: 1000 }),
  ]),
));
const index = buildCertificationIndex(groups);

const output = targets.map(([type, cardNumber]) => {
  const entity = groups[type].find((candidate) => candidate.card_number === cardNumber);
  if (!entity) throw new Error(`Не найдено: ${type}:${cardNumber}`);
  const hashes = certificationHashes(entity, type, index);
  return {
    type,
    table: ENTITY_ENDPOINTS[type][0].replace('/api/', ''),
    cardNumber,
    name: entity.name,
    contentHash: hashes.contentHash,
    dependencyHash: hashes.dependencyHash,
  };
});

console.log(JSON.stringify(output, null, 2));
