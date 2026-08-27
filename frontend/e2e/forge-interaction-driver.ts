import { expect, type Locator, type Page } from '@playwright/test';

type CatalogActionLike = {
  id: string;
  mechanics?: unknown;
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function selectedCount(value: string | null): { selected: number; required: number } | null {
  const match = value?.match(/Выбрано\s+(\d+)\s+из\s+(\d+)/i);
  if (!match) return null;
  return { selected: Number(match[1]), required: Number(match[2]) };
}

function isSelectedChoice(className: string): boolean {
  return className.split(/\s+/).some((token) => token === 'on' || token === 'selected');
}

export async function openForgeSection(page: Page, label: string): Promise<void> {
  const navigation = page.getByRole('navigation', { name: 'Этапы создания персонажа' });
  const button = navigation.getByRole('button', {
    name: new RegExp(`^${escapeRegExp(label)}(?:\\s|$)`),
  });
  await expect(button).toBeVisible();
  // MobileSuggestion becomes visible from a React effect after the Forge has
  // rendered. Always settle it immediately before navigation so a slow mount
  // cannot leave the fixed overlay intercepting a real section-button click.
  await dismissMobileForgeSuggestion(page);
  await button.click();
  await expect(button).toHaveAttribute('aria-current', 'page');
}

export async function selectForgeEntity(page: Page, name: string): Promise<void> {
  const button = page.locator('.forge-editor').getByRole('button', {
    name: new RegExp(`^${escapeRegExp(name)}(?:\\s|$)`),
  }).first();
  await expect(button, `Forge entity ${name}`).toBeVisible();
  await button.click();
  await expect(button, `selected Forge entity ${name}`).toHaveClass(/\bselected\b/);
}

async function firstUnselectedEnabledButton(container: Locator): Promise<Locator | null> {
  const candidates = container.locator('button:not([disabled]):not([aria-disabled="true"])');
  for (let index = 0; index < await candidates.count(); index += 1) {
    const candidate = candidates.nth(index);
    if (!await candidate.isVisible()) continue;
    if (isSelectedChoice(await candidate.getAttribute('class') ?? '')) continue;
    return candidate;
  }
  return null;
}

/**
 * Completes every declarative choice currently rendered in a Forge section.
 * The driver intentionally follows the UI contract ("selected N of M") and
 * never knows which class, spell, lineage, mastery, or option produced it.
 */
export async function completeVisibleForgeChoices(page: Page): Promise<void> {
  for (let pass = 0; pass < 100; pass += 1) {
    const counters = page.locator('.forge-editor .choice-count');
    let changed = false;
    for (let index = 0; index < await counters.count(); index += 1) {
      const counter = counters.nth(index);
      if (!await counter.isVisible()) continue;
      const count = selectedCount(await counter.textContent());
      if (!count || count.selected >= count.required) continue;
      const container = counter.locator('xpath=..');
      const candidate = await firstUnselectedEnabledButton(container);
      if (!candidate) {
        throw new Error(
          `Forge exposes an incomplete choice without an enabled option: ${await counter.textContent()}`,
        );
      }
      const before = count.selected;
      await candidate.click();
      await expect.poll(async () => (
        selectedCount(await counter.textContent())?.selected ?? before
      )).toBeGreaterThan(before);
      changed = true;
      break;
    }
    if (!changed) return;
  }
  throw new Error('Forge choice completion did not converge after 100 selections');
}

export async function assertVisibleForgeImagesLoaded(page: Page): Promise<void> {
  const declaredCards = page.locator('.forge-editor .forge-square-card[data-image-state="declared"]:visible');
  const failedCards = page.locator('.forge-editor .forge-square-card[data-image-state="error"]:visible');
  const missingCards = page.locator('.forge-editor .forge-square-card[data-image-state="missing"]:visible');
  const declaredCount = await declaredCards.count();
  expect(declaredCount, 'the selected Forge section should declare at least one real image')
    .toBeGreaterThan(0);
  await expect.poll(async () => ({
    declared: await declaredCards.count(),
    failed: await failedCards.count(),
    missing: await missingCards.count(),
    loaded: await declaredCards.locator('img').evaluateAll((nodes) => nodes.filter((node) => {
      const image = node as HTMLImageElement;
      return image.complete && image.naturalWidth > 0;
    }).length),
  })).toEqual({ declared: declaredCount, failed: 0, missing: 0, loaded: declaredCount });
}

export async function dismissMobileForgeSuggestion(page: Page): Promise<void> {
  const suggestion = page.getByRole('complementary', { name: 'Предложение мобильной версии' });
  if (!await suggestion.isVisible()) {
    // The prompt is enabled in useEffect. Two paints distinguish a genuinely
    // absent desktop prompt from the mobile prompt's initial hidden render.
    await page.evaluate(() => new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    }));
  }
  if (!await suggestion.isVisible()) return;

  const dismiss = suggestion.getByRole('button', { name: 'Не сейчас', exact: true });
  await expect(dismiss).toBeVisible();
  await dismiss.click();
  await expect(suggestion).toBeHidden();
}

export async function openForgeOverviewIfNeeded(page: Page): Promise<void> {
  const create = page.getByRole('button', { name: 'Создать персонажа', exact: true });
  if (await create.count() === 0) await openForgeSection(page, 'Общее');
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/**
 * Identifies the split basic weapon actions by their executable contract, not
 * by a migration-era card number. This keeps browser evidence valid when a
 * content identity is renamed without changing rules semantics.
 */
export function weaponActionIdsByAttackKind(
  actions: readonly CatalogActionLike[],
): { melee: string[]; ranged: string[] } {
  const result = { melee: [] as string[], ranged: [] as string[] };
  for (const action of actions) {
    const mechanics = record(action.mechanics);
    const primitive = record(mechanics?.primitive);
    if (primitive?.type !== 'weapon_attack') continue;
    const effects = Array.isArray(mechanics?.effects) ? mechanics.effects : [];
    const kinds = effects.map(record).filter((effect): effect is Record<string, unknown> => Boolean(effect))
      .filter((effect) => effect.resolution === 'attack_roll')
      .map((effect) => effect.attack_kind);
    if (kinds.includes('weapon_melee')) result.melee.push(action.id);
    if (kinds.includes('weapon_ranged')) result.ranged.push(action.id);
  }
  return result;
}
