import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('production Login UI', () => {
  it('does not publish or autofill repository test credentials', () => {
    const source = readFileSync(new URL('./Login.tsx', import.meta.url), 'utf8');
    expect(source).not.toContain('testuser');
    expect(source).not.toContain('Тестовые данные для входа');
    expect(source).not.toMatch(/setFormData\([^\n]+password:\s*['"]password['"]/);
  });
});
