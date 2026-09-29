/** Cross-reference fields describe the current library, never executable data. */
export function withoutEntityReferences<T extends object>(entity: T): Omit<T, 'references' | 'referenced_by'> {
  const { references: _outgoing, referenced_by: _incoming, ...data } = entity as T & {
    references?: unknown;
    referenced_by?: unknown;
  };
  return data;
}
