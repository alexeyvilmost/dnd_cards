import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('paper notes select as one field and hidden blocks reflow without losing their data', async ({ page }) => {
  test.setTimeout(120_000);
  const sheet = {
    version: 1, fields: { name: 'Проверка листа', level: '1', str: '10', dex: '10', con: '10', int: '10', wis: '10', cha: '10' },
    checks: {}, training: {}, sections: { notes1: { text: 'Первая строка\nВторая строка', fontSize: 12 } },
    hiddenBlocks: [], settings: { grid: true }, weaponRows: 1, spellRows: 38, portrait: '',
  };
  let revision = 1;
  await page.route('**/api/paper-sheets/paper-blocks-qa', async route => {
    if (route.request().method() === 'PUT') {
      Object.assign(sheet, route.request().postDataJSON().document);
      revision++;
      await route.fulfill({ json: { revision } });
    } else await route.fulfill({ json: { id: 'paper-blocks-qa', document: sheet, revision, anonymous: true } });
  });
  await page.goto('/paper-sheet/paper-blocks-qa');
  await expect(page.locator('.ps-notes-page [data-note-section]')).toHaveCount(6);
  await page.getByRole('button', { name: 'Убрать блок: Заметки 1' }).click();
  await expect(page.locator('.ps-notes-page [data-note-section]').first()).toHaveAttribute('data-note-section', 'notes2');
  if (process.env.PAPER_SHEET_SCREENSHOT) await page.locator('.ps-notes-page').screenshot({ path: process.env.PAPER_SHEET_SCREENSHOT });
  await page.getByRole('button', { name: 'Скрытые блоки: 1' }).click();
  await page.getByRole('button', { name: 'Вернуть' }).click();
  await expect(page.locator('.ps-notes-page [data-note-section]').first()).toHaveAttribute('data-note-section', 'notes1');
  await page.getByRole('button', { name: 'Закрыть окно' }).click();
  await page.locator('[data-note-section="notes1"] .ps-note-line').first().click();
  const editor = page.getByRole('textbox', { name: 'Текст: Заметки' });
  await expect(editor).toHaveValue('Первая строка\nВторая строка');
  await editor.press('ControlOrMeta+A');
  expect(await editor.evaluate((element: HTMLTextAreaElement) => element.value.slice(element.selectionStart, element.selectionEnd))).toBe('Первая строка\nВторая строка');
  await editor.fill('Первая строка\nВторая строка\nТретья строка');
  await page.getByRole('button', { name: 'Готово' }).click();
  await expect(page.locator('[data-note-section="notes1"] .ps-note-line')).toHaveCount(3);
  await expect.poll(() => sheet.sections.notes1.text).toBe('Первая строка\nВторая строка\nТретья строка');
  await page.getByRole('button', { name: 'Убрать блок: Заметки 2' }).click();
  await page.getByRole('button', { name: 'Настройки листа' }).click();
  const [jsonDownload] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Скачать лист JSON' }).click()]);
  const exported = await readFile(await jsonDownload.path(), 'utf8');
  expect(JSON.parse(exported).hiddenBlocks).toContain('notes2');
  expect(JSON.parse(exported).sections.notes1.text).toBe('Первая строка\nВторая строка\nТретья строка');
  await page.getByRole('button', { name: 'Закрыть окно' }).click();
  await page.getByRole('button', { name: 'Скрытые блоки: 1' }).click();
  await page.getByRole('button', { name: 'Вернуть' }).click();
  await expect(page.locator('.ps-notes-page [data-note-section]')).toHaveCount(6);
  await page.getByRole('button', { name: 'Закрыть окно' }).click();
  await page.locator('input[aria-label="Импорт листа JSON"]').setInputFiles({ name: 'paper-sheet-roundtrip.json', mimeType: 'application/json', buffer: Buffer.from(exported) });
  await page.getByRole('button', { name: 'Загрузить', exact: true }).click();
  await expect(page.locator('.ps-notes-page [data-note-section]')).toHaveCount(5);
  await expect(page.locator('[data-note-section="notes1"] .ps-note-line')).toHaveCount(3);
  if (process.env.PAPER_SHEET_PDF) {
    if (process.env.PAPER_SHEET_SCREENSHOT_FINAL) await page.locator('.ps-notes-page').screenshot({ path: process.env.PAPER_SHEET_SCREENSHOT_FINAL });
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Скачать PDF' }).click()]);
    await download.saveAs(process.env.PAPER_SHEET_PDF);
  }
});
