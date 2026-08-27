import policyJson from './data/certified_mutable_metadata_fields.v1.json' with { type: 'json' };

interface CertifiedContentProjectionPolicy {
  schema_version: 1;
  mutable_metadata_root_fields: string[];
}

const policy = policyJson as CertifiedContentProjectionPolicy;

if (policy.schema_version !== 1
  || !Array.isArray(policy.mutable_metadata_root_fields)
  || policy.mutable_metadata_root_fields.some((field) => (
    typeof field !== 'string' || !/^[a-z][a-z0-9_]*$/.test(field)
  ))) {
  throw new Error('Invalid certified content projection policy');
}

export const CERTIFIED_MUTABLE_METADATA_ROOT_FIELDS: ReadonlySet<string> = new Set(
  policy.mutable_metadata_root_fields,
);

/**
 * Projects a database entity onto the bytes that can affect compiled/runtime
 * behavior. Root presentation metadata remains editable without pretending
 * the certified mechanics changed; identity and every undeclared structural
 * field stay fail-closed.
 */
export function certifiedExecutableRootProjection(
  entity: object,
  additionallyExcludedFields: Iterable<string> = [],
): Record<string, unknown> {
  const excluded = new Set([
    ...CERTIFIED_MUTABLE_METADATA_ROOT_FIELDS,
    ...additionallyExcludedFields,
  ]);
  return Object.fromEntries(Object.entries(entity).filter(([key, value]) => (
    !excluded.has(key) && value !== undefined
  )));
}
