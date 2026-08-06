import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('mechanics schema distribution', () => {
  it('keeps the runtime and documentation schemas byte-for-byte identical', () => {
    const runtimeSchema = readFileSync(
      new URL('../schemas/mechanics.schema.json', import.meta.url),
      'utf8',
    );
    const documentationSchema = readFileSync(
      new URL('../../../docs/mechanics.schema.json', import.meta.url),
      'utf8',
    );
    expect(documentationSchema).toBe(runtimeSchema);
  });
});
