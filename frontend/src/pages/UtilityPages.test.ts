// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'postcss';
import { describe, expect, it } from 'vitest';
const css = readFileSync(resolve('src/pages/UtilityPages.css'), 'utf8');

const stylesheet = parse(css);
const pageSource = (name: string) => readFileSync(resolve(`src/pages/${name}.tsx`), 'utf8');

describe('legacy utility page theme boundaries', () => {
  it.each([
    ['CardTypeSelection', 'CardTypeSelector', 'types'],
    ['WeaponSelection', 'WeaponSelector', 'weapon'],
    ['EquipmentSelection', 'EquipmentSelector', 'categories'],
    ['PotionSelection', 'PotionSelector', 'categories'],
    ['IngredientSelection', 'IngredientSelector', 'categories'],
    ['TrinketSelection', 'TrinketSelector', 'categories'],
  ])('%s keeps its existing selector without new props', (page, selector, variant) => {
    const source = pageSource(page);
    expect(source).toContain(`utility-selection-page--${variant}`);
    expect(source).toContain('site-page-theme utility-selection-page');
    expect(source).toContain(`<${selector} />`);
    expect(source).not.toMatch(/useEffect|useState|\.\.\./);
  });

  it.each(['types', 'weapon', 'categories'])('only selects %s navigation chrome, never nested templates', (variant) => {
    const container = document.createElement('div');
    const entity = `<section data-entity>
      <div class="grid"><button class="bg-white"><h3>Template</h3><p>Description</p></button></div>
      <div class="mb-6"><h2>Entity heading</h2><p>Entity text</p></div>
      <div class="flex"><div><h2>Preview</h2><p>Preview text</p></div></div>
      <div class="border-t"></div>
    </section>`;
    container.innerHTML = `<div>
      <div class="site-page-theme utility-selection-page utility-selection-page--${variant}">
        <div class="min-h-screen bg-gradient-to-br">
          <div class="${variant === 'types' ? 'max-w-4xl' : 'max-w-6xl'}">
            <div class="flex"><button>Back</button><h1>Page heading</h1><p>Intro</p></div>
            <div class="grid"><button><div><h3>Category</h3><p>Category description</p></div></button></div>
            ${variant === 'weapon' ? `<div class="space-y-8"><div class="space-y-4">
              <div class="flex"><div><h2>Category heading</h2><p>Details</p></div><div class="text-sm">1</div></div>
              <div class="border-t"></div>${entity}</div></div>` : `<div><div class="mb-6"><h2>Category heading</h2><p>Details</p></div>${entity}</div>`}
          </div>
        </div>
      </div>
    </div>`;
    const matches = new Set<Element>();
    stylesheet.walkRules(rule => {
      if (!rule.selector.includes('utility-selection-page')) return;
      for (const element of container.querySelectorAll(rule.selector)) {
        expect(element.closest('[data-entity]'), rule.selector).toBeNull();
        matches.add(element);
      }
    });
    expect(matches.has(container.querySelector('h1')!)).toBe(true);
    expect(matches.has(container.querySelector('.grid > button')!)).toBe(true);
    expect(matches.has(container.querySelector('.grid > button h3')!)).toBe(true);
  });

  it('limits entity islands to the boundary, not their descendants', () => {
    const island = stylesheet.nodes.find(node => node.type === 'rule' && node.selector === '.utility-entity-island');
    expect(island?.toString()).toContain('color-scheme: light');
    stylesheet.walkRules(rule => {
      expect(rule.selector).not.toContain('.utility-entity-island ');
      expect(rule.selector).not.toContain('.bg-white');
    });
  });

  it('keeps guide color overrides screen-only and clears surface decoration for print', () => {
    let screenRules = 0;
    stylesheet.walkRules(rule => {
      if (!rule.selector.includes('.site-page-theme.utility-guide')) return;
      expect(rule.parent?.type).toBe('atrule');
      expect(rule.parent && 'params' in rule.parent ? rule.parent.params : null).toBe('screen');
      screenRules++;
    });
    expect(screenRules).toBeGreaterThan(5);
    expect(css).toContain('@media print');
    expect(css).toContain('.utility-guide.site-surface');
    expect(pageSource('EngineGuide')).toContain('components={{ pre: MarkdownPre }}');
    expect(pageSource('EngineGuide')).toContain('dangerouslySetInnerHTML={{ __html: svg }}');
  });

  it('keeps PDF capture outside themed panels and retains canonical preview props', () => {
    const source = pageSource('CardExport');
    const capture = source.slice(source.indexOf('{captureCard && ('), source.indexOf('{/* Оверлей'));
    expect(capture).toContain('utility-entity-island');
    expect(capture).toContain('bg-white');
    expect(capture).not.toContain('site-surface');
    expect(capture).toContain('<CardPreview card={captureCard} disableHover />');
  });

  it.each(['ShopNew', 'CreateInventory', 'WeaponTemplates'])('%s keeps the selected control visibly distinct', (name) => {
    expect(pageSource(name)).toContain('site-page-theme');
    expect(pageSource(name)).toContain('utility-choice--selected');
    expect(pageSource(name)).toContain('site-control');
  });

  it.each([
    'Groups', 'CreateGroup', 'JoinGroup', 'GroupDetail', 'Inventory',
    'CreateInventory', 'InventoryDetail', 'AddItemToInventory', 'CardExport',
    'WeaponTemplates', 'ShopNew', 'ImageStudio', 'NotFound',
  ])('%s opts its own heading into shared chrome', name => {
    expect(pageSource(name)).toContain('site-page-head');
    expect(pageSource(name)).toContain('site-heading');
  });
});
