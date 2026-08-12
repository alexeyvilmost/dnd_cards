import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import SheetAuthorityNotice from './SheetAuthorityNotice';

describe('SheetAuthorityNotice', () => {
  it('labels the server as authority and the browser result as a preview', () => {
    const markup = renderToStaticMarkup(createElement(
      MemoryRouter,
      null,
      createElement(SheetAuthorityNotice),
    ));

    expect(markup).toContain('data-testid="sheet-authority-notice"');
    expect(markup).toContain('aria-label="Режим исполнения правил"');
    expect(markup).toContain('Сервер — источник правил');
    expect(markup).toContain('взаимодействия листов подтверждаются сервером');
    expect(markup).toContain('локальный расчёт — предварительный');
    expect(markup).toContain('Изолированная сценарная проверка — Rules Session Lab');
    expect(markup).toContain('href="/rules-lab"');
    expect(markup).not.toContain('legacy');
    expect(markup).not.toContain('Локальный движок правил');
  });
});
