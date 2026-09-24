import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

// A local, mocked browser acceptance check. No writes reach the application DB.
const origin = process.env.LIBRARY_TEST_ORIGIN || 'http://localhost:3000';
assert(['localhost', '127.0.0.1'].includes(new URL(origin).hostname));
const output = resolve('../outputs/item-library-policy');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const tag = {id:'d2620000-0000-4000-8000-000000000001',name:'Available for Players',description:'Доступно игрокам'};
const cards = [
  {id:'d2620000-0000-4000-8000-000000000011',name:'Походный меч',description:'Предмет для проверки библиотеки.',rarity:'common',card_number:'LIB-001',source:"Player's Handbook",image_url:'/default_image.png'},
  {id:'d2620000-0000-4000-8000-000000000012',name:'Кольцо ясного неба',description:'Второй предмет с другими данными.',rarity:'rare',card_number:'LIB-002',source:'Bag Of Holding',image_url:'/default_image.png'},
];
try {
  for (const admin of [true, false]) {
    const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
    if (admin) await context.addInitScript(() => localStorage.setItem('auth_token','local-library-test'));
    const mutations = [];
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', error => {pageErrors.push(error);console.error('Page error:', error.stack);});
    await page.route('**/api/**', async route => {
      const req = route.request(), url = new URL(req.url());
      if (!url.pathname.startsWith('/api/')) return route.continue();
      let data = {};
      if (url.pathname === '/api/auth/profile') data = {id:'local-admin',username:'local-admin',display_name:'Проверка библиотеки'};
      else if (url.pathname === '/api/cards') data = {cards,total:cards.length,page:1,limit:50};
      else if (url.pathname === '/api/entity-tags') data = {tags:[tag],can_manage:admin};
      else if (url.pathname === '/api/entity-tags/bulk') { mutations.push(req.postDataJSON()); data = {ok:true}; }
      else if (url.pathname.startsWith('/api/entity-tags/')) data = {tags:[]};
      else if (url.pathname === '/api/effects') data = {effects:[],total:0};
      else if (url.pathname === '/api/resources') data = {resources:[],total:0};
      else if (url.pathname === '/api/audio') data = {cues:[],bindings:[],can_manage:false};
      else if (url.pathname === '/api/auth/oauth/providers') data = {providers:[]};
      else if (url.pathname.startsWith('/api/cards/')) data = cards.find(card => url.pathname.endsWith(card.id)) || cards[0];
      else if (req.method() !== 'GET') throw new Error(`Unexpected mutation: ${req.method()} ${url.pathname}`);
      await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
    });
    await page.goto(`${origin}/library`);
    await page.getByRole('heading',{name:'Библиотека карточек'}).waitFor({timeout:15000}).catch(async error => {
      console.error((await page.locator('body').innerText()).slice(0,2000));
      await page.screenshot({path:resolve(output,'load-failure.png'),fullPage:true});
      throw error;
    });
    await page.getByText('Походный меч',{exact:true}).first().waitFor();
    const rail = page.getByRole('navigation',{name:'Тип содержимого'});
    assert.equal(await rail.getByRole('button',{name:'Монстры',exact:true}).count(),1);
    const bounds = await rail.evaluate(el => ({width:el.getBoundingClientRect().width,client:el.clientWidth,scroll:el.scrollWidth,overflow:getComputedStyle(el).overflowX}));
    assert(bounds.width >= 180, JSON.stringify(bounds));
    assert(bounds.scroll <= bounds.client + 1, JSON.stringify(bounds));
    if (admin) {
      await page.getByRole('button',{name:'Выбрать предметы',exact:true}).click();
      await page.getByRole('checkbox',{name:'Выбрать: Походный меч',exact:true}).check();
      await page.getByRole('button',{name:'Выбрать загруженные',exact:true}).click();
      await page.locator('.library-bulk-tags').getByRole('combobox',{name:'Фильтр по тегу'}).selectOption(tag.id);
      await page.getByRole('button',{name:'Добавить тег',exact:true}).click();
      await page.getByText('Тег добавлен ко всем выбранным предметам.',{exact:true}).waitFor();
      assert.equal(mutations.length,1); assert.deepEqual(mutations[0].entity_ids,cards.map(card=>card.id));
      assert.deepEqual(mutations[0].tag_ids,[tag.id]);
    } else assert.equal(await page.getByRole('button',{name:'Выбрать предметы',exact:true}).count(),0);
    await page.screenshot({path:resolve(output,admin?'desktop-admin.png':'desktop-guest.png'),fullPage:true});
    await page.setViewportSize({width:390,height:844});
    await page.screenshot({path:resolve(output,admin?'mobile-admin.png':'mobile-guest.png'),fullPage:true});
    const horizontal = await page.evaluate(() => ({width:innerWidth,scroll:document.documentElement.scrollWidth}));
    assert(horizontal.scroll <= horizontal.width + 1, JSON.stringify(horizontal));
    assert.equal(pageErrors.length,0,'No unhandled browser errors');
    console.log(JSON.stringify({admin,sidebar:bounds,mobile:horizontal,bulkRequests:mutations.length}));
    await context.close();
  }
} finally { await browser.close(); }
