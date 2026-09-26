import { readFileSync } from 'node:fs';
import { Box3, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import catalog from './catalog.snapshot.json';
import { MONSTER_MINIATURE_BINDINGS, resolveMiniature, TEMPLATE_MINIATURE_BINDINGS } from './bindings';
import { getMiniatureGeometry } from './geometry';
import { MINIATURE_RECIPES } from './recipes';
import {miniatureMaterial} from './materials';

describe('battle miniature asset coverage', () => {
  it('covers every record from the actual local bestiary including custom audit creatures', () => {
    expect(catalog.monsters).toHaveLength(catalog.total);
    for (const monster of catalog.monsters) {
      expect(MONSTER_MINIATURE_BINDINGS[monster.id], `${monster.name} (${monster.id})`).toBeTruthy();
      expect(resolveMiniature({monsterId: monster.id}).id).toBe(MONSTER_MINIATURE_BINDINGS[monster.id]);
    }
  });

  it('covers all current built-in monster seed IDs independently of the captured API snapshot', () => {
    const migrations = ['migrations.go', 'materialize_roguelike_monsters_199.go'];
    let seedCount = 0;
    for (const filename of migrations) {
      const source = readFileSync(new URL(`../../../../backend/migrations/${filename}`, import.meta.url), 'utf8');
      const rows = [...source.matchAll(/\{"(c[12]000000-[0-9a-f-]+)", "([a-z-]+)", "([^"\n]+)"/g)];
      for (const row of rows) {
        seedCount += 1;
        expect(MONSTER_MINIATURE_BINDINGS[row[1]], row[3]).toBeTruthy();
        expect(resolveMiniature({monsterId: row[1]})).toBe(resolveMiniature({monsterSlug: row[2]}));
      }
    }
    expect(seedCount).toBeGreaterThanOrEqual(21);
  });

  it('covers every canonical character template and their renamed copies by portrait', () => {
    const templates = JSON.parse(readFileSync(new URL('../../../../backend/charactertemplates/presets.json', import.meta.url), 'utf8')) as
      Array<{id: string; name: string; snapshot: {avatar_url?: string}; character?: {avatar_url?: string}}>;
    expect(templates).toHaveLength(3);
    const recipeIds = new Set<string>();
    for (const template of templates) {
      expect(TEMPLATE_MINIATURE_BINDINGS[template.id], template.name).toBeTruthy();
      const recipe = resolveMiniature({templateId: template.id});
      recipeIds.add(recipe.id);
      // The raw fixture snapshot key can evolve; locate its stored portrait without duplicating template metadata.
      const portrait = JSON.stringify(template).match(/\/portraits\/presets\/[^"\\]+\.png/)?.[0];
      expect(portrait).toBeTruthy();
      expect(resolveMiniature({portraitUrl: `${portrait}?version=2`})).toBe(recipe);
      expect(resolveMiniature({portraitUrl: `https://example.test${portrait}`})).toBe(recipe);
    }
    expect(recipeIds.size).toBe(3);
    expect(MINIATURE_RECIPES.swordsman.head).toBe('reptile');
    expect(MINIATURE_RECIPES.archer.weapon).toBe('bow');
    expect(MINIATURE_RECIPES.line.shield).toBe(true);
  });

  it('resolves new custom identities safely from their declared category without name heuristics', () => {
    expect(resolveMiniature({monsterId: 'custom-beast', creatureType: 'beast'}).body).toBe('wolf');
    expect(resolveMiniature({monsterId: 'custom-construct', creatureType: 'construct'}).body).toBe('dummy');
    expect(resolveMiniature({monsterId: 'skeleton'}).id).toBe('adventurer');
    expect(resolveMiniature({portraitUrl: '/custom/archer.png', kind: 'playerCharacter'}).id).toBe('adventurer');
    expect(resolveMiniature({})).toBe(MINIATURE_RECIPES.adventurer);
  });
});

describe('procedural miniature geometry', () => {
  it('makes finite, bounded volumetric sculpts for every recipe with a bounded draw-call budget', () => {
    for (const recipe of Object.values(MINIATURE_RECIPES)) {
      const parts = getMiniatureGeometry(recipe);
      expect(parts.length, recipe.id).toBeLessThanOrEqual(11);
      expect(parts.length, recipe.id).toBeGreaterThanOrEqual(3);
      const bounds = new Box3();
      let triangles = 0;
      for (const {geometry} of parts) {
        bounds.union(geometry.boundingBox!);
        const positions = geometry.getAttribute('position');
        triangles += positions.count / 3;
        expect([...positions.array].every(Number.isFinite), recipe.id).toBe(true);
        expect(geometry.getAttribute('normal').count).toBe(positions.count);
        expect(geometry.getAttribute('uv').count).toBe(positions.count);
        expect([...geometry.getAttribute('uv').array].every(Number.isFinite),recipe.id).toBe(true);
      }
      const size = bounds.getSize(new Vector3());
      expect(size.x, recipe.id).toBeGreaterThan(.2);
      expect(size.y, recipe.id).toBeGreaterThan(.15);
      expect(size.z, recipe.id).toBeGreaterThan(.1);
      expect(size.x, recipe.id).toBeLessThan(1.15);
      expect(size.y, recipe.id).toBeLessThan(1.8);
      expect(size.z, recipe.id).toBeLessThan(1.1);
      expect(bounds.min.y, recipe.id).toBeGreaterThanOrEqual(0);
      expect(triangles, recipe.id).toBeLessThan(80_000);
      if(recipe.body!=='dummy')expect(triangles,recipe.id).toBeGreaterThan(20_000);
      expect(getMiniatureGeometry(recipe)).toBe(parts);
    }
  });

  it('provides different anatomy for humanoids, wolves, rats, spiders and practice dummies', () => {
    const volumes = ['guard', 'wolf', 'giant-rat', 'giant-wolf-spider', 'training-dummy'].map(id => {
      const recipe = MINIATURE_RECIPES[id as keyof typeof MINIATURE_RECIPES];
      const geometry = getMiniatureGeometry(recipe);
      const bounds = new Box3();
      geometry.forEach(part => bounds.union(part.geometry.boundingBox!));
      return bounds.getSize(new Vector3()).toArray().map(value => value.toFixed(3)).join(',');
    });
    expect(new Set(volumes).size).toBe(5);
  });

  it('keeps smooth sculpt normals instead of flattening the face into triangle facets',()=>{
    const skin=getMiniatureGeometry(MINIATURE_RECIPES.guard).find(part=>part.paint==='skin')!;
    const normals=skin.geometry.getAttribute('normal');
    let smoothFaces=0;
    for(let n=0;n<normals.count;n+=3){
      const a=new Vector3().fromBufferAttribute(normals,n),b=new Vector3().fromBufferAttribute(normals,n+1);
      expect(a.length()).toBeCloseTo(1,4);
      if(a.dot(b)<.999&&a.dot(b)>.6)smoothFaces+=1;
    }
    expect(smoothFaces).toBeGreaterThan(100);
  });

  it('reuses detailed surfaces and separates cloth, skin and steel finishes',()=>{
    const steel=miniatureMaterial('#777777','metal'),cloth=miniatureMaterial('#777777','cloth'),skin=miniatureMaterial('#777777','skin');
    expect(steel).toBe(miniatureMaterial('#777777','metal'));
    expect(cloth.roughness).toBeGreaterThan(steel.roughness);
    expect(steel.metalness).toBeGreaterThan(.5);
    expect(skin.metalness).toBe(0);
    expect(cloth.map).toBe(miniatureMaterial('#665544','cloth').map);
    expect(cloth.bumpMap).toBeTruthy();
    expect(cloth.roughnessMap).toBeTruthy();
    expect(steel.flatShading).toBe(false);
  });
});
