const ASPECT_ID_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const MAX_ASPECT_ID_LENGTH = 120;

declare const aspectIdBrand: unique symbol;

/** Stable, serialization-safe identifier of one independently testable rule aspect. */
export type AspectId = string & { readonly [aspectIdBrand]: 'AspectId' };

export function isAspectId(value: unknown): value is AspectId {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_ASPECT_ID_LENGTH
    && ASPECT_ID_PATTERN.test(value);
}
/**
 * Constructs an AspectId without normalization. Rejecting whitespace/case drift is
 * intentional: changing an ID must make old evidence orphaned, not silently relink it.
 */
export function aspectId(value: string): AspectId {
  if (!isAspectId(value)) {
    throw new Error(
      `Invalid aspectId "${value}"; expected lower-case dot/dash/underscore-separated tokens`,
    );
  }
  return value;
}
