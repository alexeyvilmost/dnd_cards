import {expect, test, type Page} from '@playwright/test';
import {PerspectiveCamera, Vector3} from 'three';
import {frameBattleCamera} from '../src/battle3d/BattleCamera';

const fixture = '/e2e/fixtures/battle-3d-preview.html';
const setting = (page:Page) => page.getByRole('checkbox', {name:/Монетки на поле/});
const scene = (page:Page) => page.getByTestId('battle-scene-3d');

test.beforeEach(({baseURL}, testInfo) => {
  test.skip(!baseURL || testInfo.project.name !== 'battle3d-local', 'Dev-only fixture: use playwright.battle3d.config.ts with a local Vite server.');
});

async function enable3d(page:Page) {
  await setting(page).check();
  await expect(scene(page).locator('canvas')).toBeVisible({timeout:30_000});
  await expect(scene(page).locator('[data-actor-id="hero-0"]')).toBeVisible();
  await expect.poll(async () => {
    const box = await scene(page).locator('canvas').boundingBox();
    return Boolean(box && box.width > 100 && box.height > 100);
  }).toBe(true);
}

function errorsFrom(page:Page) {
  const errors:string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  return errors;
}

async function capture(page:Page, path:string) {
  // Two animation frames settle the DOM projection of the canvas camera.
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await page.locator('section[aria-label="Проверочное поле боя"]').screenshot({path});
}

test('3D setting persists and both presentations dispatch the same actor and grid cell', async ({page}, testInfo) => {
  const errors = errorsFrom(page);
  await page.goto(fixture);
  await expect(page.getByTestId('tactical-map')).toBeVisible();
  await expect(setting(page)).not.toBeChecked();
  await page.getByTestId('tactical-map').locator('button[data-actor-id="monster-goblin-warrior"]').first().click();
  const from2d = await page.getByTestId('selection').textContent();
  expect(JSON.parse(from2d!)).toMatchObject({actorId:'monster-goblin-warrior'});
  await enable3d(page);
  await capture(page, testInfo.outputPath('battle-3d-desktop.png'));
  const selected = JSON.parse(from2d!) as {position:{x:number;y:number}};
  const canvas = scene(page).locator('canvas');
  const box = (await canvas.boundingBox())!;
  const camera = new PerspectiveCamera(42, box.width / box.height, .1, 250);
  frameBattleCamera(camera, 18, 12, 2.4);
  camera.updateProjectionMatrix(); camera.updateMatrixWorld();
  const projected = new Vector3(selected.position.x+.5,.3,selected.position.y+.5).project(camera);
  await page.mouse.click(box.x+(projected.x+1)*box.width/2,box.y+(1-projected.y)*box.height/2);
  await expect(page.getByTestId('selection')).toHaveText(from2d!);
  await expect(page.getByTestId('selection-count')).toHaveText('2');
  await page.reload();
  await expect(setting(page)).toBeChecked();
  await expect(scene(page).locator('canvas')).toBeVisible();
  await setting(page).uncheck();
  await expect(page.getByTestId('tactical-map')).toBeVisible();
  await expect(scene(page)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('canvas raycasts the intended board cell, camera controls work and dragging never selects', async ({page}) => {
  const errors = errorsFrom(page);
  await page.goto(fixture);
  await enable3d(page);
  const heroLabel = scene(page).locator('[data-actor-id="hero-0"]');
  const original = await heroLabel.boundingBox();
  await page.getByRole('button', {name:'Приблизить поле', exact:true}).click();
  await expect.poll(async () => JSON.stringify(await heroLabel.boundingBox())).not.toBe(JSON.stringify(original));
  await page.getByRole('button', {name:'Показать всё поле', exact:true}).click();
  const reset = await heroLabel.boundingBox();
  await expect(page.getByRole('button', {name:/Повернуть камеру/})).toHaveCount(0);
  const panCanvas=scene(page).locator('canvas');
  const panBox=(await panCanvas.boundingBox())!;
  await page.mouse.move(panBox.x+panBox.width*.5,panBox.y+panBox.height*.5);
  await page.mouse.down();
  await page.mouse.move(panBox.x+panBox.width*.5+95,panBox.y+panBox.height*.5-35,{steps:10});
  await page.mouse.up();
  await expect.poll(async () => JSON.stringify(await heroLabel.boundingBox())).not.toBe(JSON.stringify(reset));
  await page.getByRole('button', {name:'Показать всё поле', exact:true}).click();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));

  // Project a known unoccupied cell using the same public framing convention;
  // the pointer still passes through the real browser canvas/raycaster.
  const canvas = scene(page).locator('canvas');
  const box = (await canvas.boundingBox())!;
  const camera = new PerspectiveCamera(42, box.width / box.height, .1, 250);
  frameBattleCamera(camera, 18, 12, 2.4);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  const projected = new Vector3(2.5, .02, 6.5).project(camera);
  const x = box.x + (projected.x + 1) * box.width / 2;
  const y = box.y + (1 - projected.y) * box.height / 2;
  await page.mouse.click(x, y);
  await expect(page.getByTestId('selection')).toHaveText(JSON.stringify({position:{x:2,y:6}}));
  await expect(page.getByTestId('selection-count')).toHaveText('1');
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 95, y - 35, {steps:10});
  await page.mouse.up();
  await expect(page.getByTestId('selection-count')).toHaveText('1');
  expect(errors).toEqual([]);
});

test('a held roll shows no outcome animation; confirmed attacks and health changes render safely', async ({page}, testInfo) => {
  const errors = errorsFrom(page);
  await page.goto(fixture);
  await enable3d(page);
  await page.getByRole('button', {name:'До реакции', exact:true}).click();
  await expect(scene(page).locator('[data-animation="attack"], [data-animation="hit"]')).toHaveCount(0);
  await page.getByRole('button', {name:'Подтверждённое попадание', exact:true}).click();
  await expect(scene(page).locator('[data-actor-id="hero-0"]')).toHaveAttribute('data-animation', 'attack');
  await expect(scene(page).locator('[data-actor-id="monster-goblin-warrior"]')).toHaveAttribute('data-animation', 'hit');
  await page.getByRole('button', {name:'Подтверждённый промах', exact:true}).click();
  await expect(scene(page).locator('[data-actor-id="monster-goblin-warrior"]')).not.toHaveAttribute('data-animation', 'hit');
  await page.getByRole('button', {name:'Выстрел из лука', exact:true}).click();
  await expect(scene(page).locator('[data-actor-id="hero-1"]')).toHaveAttribute('data-animation', 'attack');
  await expect(scene(page).locator('canvas')).toBeVisible();
  await page.getByRole('button', {name:'Убрать эффект', exact:true}).click();
  await page.getByRole('button', {name:'50% здоровья', exact:true}).click();
  await expect(page.getByTestId('fixture-health')).toHaveText('10');
  await page.getByRole('button', {name:'0% здоровья', exact:true}).click();
  await expect(page.getByTestId('fixture-health')).toHaveText('0');
  await capture(page, testInfo.outputPath('battle-3d-fallen.png'));
  await page.getByRole('button', {name:'Восстановить', exact:true}).click();
  await page.getByRole('button', {name:'Переместить монетку', exact:true}).click();
  await expect(scene(page).locator('canvas')).toBeVisible();
  expect(errors).toEqual([]);
});

test('field mode shows committed attack and damage dice over the board', async ({page},testInfo) => {
  const errors=errorsFrom(page);
  await page.goto(fixture);
  await enable3d(page);
  await expect(scene(page).locator('[data-actor-id="hero-0"] .battle-scene-3d__name')).toBeHidden();
  await page.getByRole('combobox',{name:'Свои действия и союзники'}).selectOption('field');
  await page.getByRole('button',{name:'Подтверждённое попадание',exact:true}).click();
  const dice=scene(page).locator('.battle-scene-3d__field-dice');
  await expect(dice.getByText('Атака · Атака мечом')).toBeVisible();
  await expect(dice.locator('.committed-die[data-sides="20"]')).toBeVisible();
  await expect(dice.getByText('Урон · Атака мечом')).toBeVisible({timeout:10_000});
  await expect(dice.locator('.committed-die[data-sides="6"]')).toBeVisible();
  await capture(page,testInfo.outputPath('battle-3d-field-dice.png'));
  await page.getByRole('button',{name:'Убрать эффект',exact:true}).click();
  await expect(dice).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a moving coin crosses visible intermediate positions', async ({page}) => {
  const errors=errorsFrom(page);
  await page.goto(fixture);
  await enable3d(page);
  await page.getByRole('button',{name:'Переместить монетку',exact:true}).click();
  const transforms=await page.evaluate(async()=>{
    const label=document.querySelector<HTMLElement>('.battle-scene-3d__label[data-actor-id="hero-0"]')!;
    const samples:string[]=[];
    for(let index=0;index<14;index++){
      samples.push(label.style.transform);
      await new Promise(resolve=>setTimeout(resolve,70));
    }
    return samples;
  });
  expect(new Set(transforms).size).toBeGreaterThan(2);
  expect(errors).toEqual([]);
});

test('all portrait coins and narrow maps render, with usable 2D fallback after losing WebGL', async ({page}, testInfo) => {
  const errors = errorsFrom(page);
  await page.goto(`${fixture}?gallery`);
  await enable3d(page);
  await expect(page.getByTestId('roster-count')).toHaveText('25');
  await expect(scene(page).locator('[data-actor-id]')).toHaveCount(25);
  await capture(page, testInfo.outputPath('battle-3d-bestiary.png'));
  await page.setViewportSize({width:390,height:844});
  await expect(scene(page).locator('canvas')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await capture(page, testInfo.outputPath('battle-3d-mobile.png'));
  await scene(page).locator('canvas').evaluate((canvas:HTMLCanvasElement) => {
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    const extension = gl?.getExtension('WEBGL_lose_context');
    if (!extension) throw new Error('Test browser lacks WEBGL_lose_context');
    extension.loseContext();
  });
  await expect(page.getByText(/Используется обычная карта/)).toBeVisible();
  await expect(page.getByTestId('tactical-map')).toBeVisible();
  await page.getByTestId('tactical-map').locator('button[data-actor-id="hero-0"]').click();
  await expect(page.getByTestId('selection')).toContainText('hero-0');
  expect(errors).toEqual([]);
});

test('a browser without WebGL opens the ordinary map and preserves its click behavior', async ({page}) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind:string, ...args:unknown[]) {
      return kind.startsWith('webgl') || kind === 'experimental-webgl' ? null : original.call(this, kind, ...args);
    } as typeof original;
  });
  await page.goto(fixture);
  await setting(page).check();
  await expect(page.getByText(/Используется обычная карта/)).toBeVisible({timeout:30_000});
  await expect(page.getByTestId('tactical-map')).toBeVisible();
  await page.getByTestId('tactical-map').locator('button[data-actor-id="hero-0"]').click();
  await expect(page.getByTestId('selection')).toContainText('hero-0');
});

test('coin hover ends in empty canvas space and resumes on the board', async ({page}) => {
  const errors = errorsFrom(page);
  await page.goto(fixture);
  await enable3d(page);
  await scene(page).scrollIntoViewIfNeeded();
  const canvas = scene(page).locator('canvas');
  const box = (await canvas.boundingBox())!;
  const camera = new PerspectiveCamera(42, box.width / box.height, .1, 250);
  frameBattleCamera(camera, 18, 12, 2.4);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  const project = (x:number, z:number) => {
    const point = new Vector3(x, .07, z).project(camera);
    return {x:box.x + (point.x + 1) * box.width / 2, y:box.y + (1 - point.y) * box.height / 2};
  };
  const goblin = scene(page).locator('[data-actor-id="monster-goblin-warrior"]');
  const goblinPoint = project(6.5, .5);
  const emptyCell = project(2.5, 6.5);
  await page.mouse.move(goblinPoint.x, goblinPoint.y);
  await expect(goblin).toHaveClass(/is-expanded/);
  await expect(goblin.locator('.battle-scene-3d__name')).toBeVisible();
  // This point remains inside the viewport but is outside the projected board,
  // so only surface pointer-out handling can clear the former actor hover.
  await page.mouse.move(box.x + box.width * .04, box.y + box.height * .1, {steps:5});
  await expect(goblin).not.toHaveClass(/is-expanded/);
  await expect(goblin.locator('.battle-scene-3d__name')).toBeHidden();
  await page.mouse.move(goblinPoint.x, goblinPoint.y);
  await expect(goblin).toHaveClass(/is-expanded/);
  await page.mouse.move(emptyCell.x, emptyCell.y);
  await expect(goblin).not.toHaveClass(/is-expanded/);
  await expect(page.getByTestId('selection-count')).toHaveText('0');
  expect(errors).toEqual([]);
});
