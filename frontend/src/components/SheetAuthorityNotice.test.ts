import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import SheetAuthorityNotice from './SheetAuthorityNotice';

describe('SheetAuthorityNotice', () => {
  it('labels the real sheet as local execution without claiming shared authority', () => {
    const markup = renderToStaticMarkup(createElement(
      MemoryRouter,
      null,
      createElement(SheetAuthorityNotice),
    ));

    expect(markup).toContain('data-testid="sheet-authority-notice"');
    expect(markup).toContain('aria-label="Режим исполнения правил"');
    expect(markup).toContain('Локальный движок правил');
    expect(markup).toContain('результат сохраняется в листе или бою');
    expect(markup).toContain('Изолированная сценарная проверка — Rules Session Lab');
    expect(markup).toContain('href="/rules-lab"');
    expect(markup).not.toContain('legacy');
    expect(markup).not.toContain('Общий движок');
    expect(markup).not.toContain('shared authority');
  });
});
