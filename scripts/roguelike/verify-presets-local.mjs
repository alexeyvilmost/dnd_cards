// Read-only validation against the live local Forge and combat rules.
import {readFile, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(new URL('../../frontend/package.json', import.meta.url));
const {chromium} = require('@playwright/test');
const base = 'http://127.0.0.1:3001';
const access = JSON.parse(await readFile(new URL('../../outputs/shop-249/review-access.json', import.meta.url),'utf8'));
const login = await (await fetch(`${base}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:access.username,password:access.password})})).json();
const browser = await chromium.launch({channel:'chrome',headless:true});
try {
  const page = await browser.newPage();
  await page.addInitScript(({token,user}) => {localStorage.setItem('auth_token',token);localStorage.setItem('user',JSON.stringify(user));},login);
  await page.goto(`${base}/characters`);
  for (const [kind, hp, ac] of [['swordsman',15,16],['archer',13,15],['line',15,19]]) {
    const character = JSON.parse(await readFile(new URL(`../../outputs/presets-250/${kind}.json`,import.meta.url),'utf8'));
    const result = await page.evaluate(async character => {
      const {loadAssembly} = await import('/src/character/assemble.ts');
      const {characterToDraft, completionIssues} = await import('/src/character/forgeHelpers.ts');
      const {loadSheetCombatParticipant} = await import('/src/character/sheetCombatTargetRuntime.ts');
      const {weaponAttackPreview} = await import('/src/engine/weapon.ts');
      const {MECH_WEAPON_ATTACK} = await import('/src/mvp/fixtures.ts');
      const draft = characterToDraft(character);
      const assembled = await loadAssembly(draft);
      const loaded = await loadSheetCombatParticipant({character,cards:new Map()});
      const actor = loaded.canonical.world.actors[character.id];
      return {issues:completionIssues(draft,assembled), ac:actor.ac, hp:actor.runtime.hp,
        attack:weaponAttackPreview(MECH_WEAPON_ATTACK,actor.character,actor.runtime.equipment,actor.runtime,actor.passives),
        feats:assembled.feats.map(f=>f.name), spells:assembled.spells.map(s=>s.name), equipment:actor.runtime.equipment};
    },character);
    console.log(kind,JSON.stringify(result));
    assert.deepEqual(result.issues,[]); assert.equal(result.ac,ac); assert.equal(result.hp.max,hp);
    await writeFile(new URL(`../../outputs/presets-250/${kind}-validation.json`,import.meta.url),JSON.stringify(result,null,2));
  }
} finally {await browser.close();}
