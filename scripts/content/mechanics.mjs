/**
 * Проверки механик для отчёта покрытия (фаза G1).
 */

export function hasMechanics(entity) {
  const m = entity?.mechanics;
  return !!m && typeof m === 'object' && Object.keys(m).length > 0;
}

export function activationMode(entity) {
  const m = entity?.mechanics;
  if (!m || typeof m !== 'object') return null;
  return m.activation?.mode ?? null;
}

export function isExecutableAction(entity) {
  if (!hasMechanics(entity)) return false;
  const mode = activationMode(entity);
  if (mode !== 'active') return false;
  const effects = entity.mechanics.effects;
  return Array.isArray(effects) && effects.length > 0;
}

export function isPassiveEffect(entity) {
  if (!hasMechanics(entity)) return false;
  const mode = activationMode(entity);
  return mode === 'passive' || mode === 'triggered';
}

export function collectResourceIdsFromMechanics(mech) {
  const ids = new Set();
  if (!mech || typeof mech !== 'object') return ids;
  const cost = mech.activation?.cost;
  if (Array.isArray(cost)) {
    for (const c of cost) {
      if (c?.resource) ids.add(String(c.resource));
    }
  }
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(walk);
    if (node.kind === 'resource' && node.id) ids.add(String(node.id));
    for (const v of Object.values(node)) walk(v);
  };
  walk(mech.effects);
  return ids;
}

export function progressionRefs(levelEntry) {
  const effects = levelEntry?.effects || [];
  const actions = levelEntry?.actions || [];
  return { effects: [...effects], actions: [...actions] };
}

export function isSkillId(value) {
  return typeof value === 'string' && /^[a-z][a-z0-9_]*$/.test(value);
}

const CYRILLIC = /[а-яА-ЯёЁ]/;

export function hasCyrillic(value) {
  return typeof value === 'string' && CYRILLIC.test(value);
}
