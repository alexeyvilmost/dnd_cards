import type { JsonObject } from './domain';

export type ActivationLevelRequirement =
  | { status: 'none' }
  | { status: 'invalid'; issue: string }
  | { status: 'required'; minLevel: number };

/**
 * Parse the data-owned character-level gate shared by assembly, UI previews,
 * reaction discovery, and authoritative execution. Other requirement kinds
 * remain outside this narrow policy until their runtime facts are available.
 */
export function parseActivationLevelRequirement(
  mechanics: JsonObject | null | undefined,
): ActivationLevelRequirement {
  if (!mechanics) return { status: 'none' };
  const activation = mechanics.activation;
  if (!activation || typeof activation !== 'object' || Array.isArray(activation)) {
    return { status: 'none' };
  }
  const requirements = (activation as JsonObject).requirements;
  if (requirements === undefined) return { status: 'none' };
  if (!Array.isArray(requirements)) {
    return { status: 'invalid', issue: 'activation.requirements must be an array' };
  }

  let minLevel: number | null = null;
  for (const raw of requirements) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const requirement = raw as JsonObject;
    if (requirement.type !== 'level') continue;
    if (typeof requirement.min_level !== 'number'
      || !Number.isInteger(requirement.min_level)
      || requirement.min_level < 1) {
      return {
        status: 'invalid',
        issue: 'activation.requirements level min_level must be a positive integer',
      };
    }
    minLevel = Math.max(minLevel ?? 1, requirement.min_level);
  }
  return minLevel == null
    ? { status: 'none' }
    : { status: 'required', minLevel };
}

export function meetsActivationLevelRequirement(
  mechanics: JsonObject | null | undefined,
  characterLevel: number,
): boolean {
  const requirement = parseActivationLevelRequirement(mechanics);
  return requirement.status === 'none'
    || (requirement.status === 'required' && characterLevel >= requirement.minLevel);
}
