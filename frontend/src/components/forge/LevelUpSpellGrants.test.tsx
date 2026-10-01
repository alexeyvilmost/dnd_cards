// @vitest-environment jsdom
import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import type {CharacterClass, PassiveEffect, Spell} from '../../types';
import {assemble} from '../../character/assemble';
import {emptyDraft} from '../../character/types';
import {resolveCharacterRules} from '../../character/rules/resolveCharacterRules';
import {buildCharacterContext} from '../../character/runtime';
import type {LevelUpSpellGrantSnapshot} from '../../character/levelUpPresentation';
import {createRegistry} from '../../engine/registry';
import LevelUpSpellGrants from './LevelUpSpellGrants';

(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const modes=vi.hoisted(()=>({spells:'icon' as 'icon'|'row'}));
vi.mock('../../settings',()=>({useSiteSettings:()=>({entityDisplay:modes,showVerificationStatus:false})}));
vi.mock('../../utils/resources',async original=>({...await original<typeof import('../../utils/resources')>(),useResourceOptions:()=>[]}));
const spell={id:'spell',card_number:'SPELL-renamed',name:'Granted spell',description:'Canonical spell description',level:1,classes:[],mechanics:{}} as unknown as Spell;
function snapshot(source:string|null,freeuse=false):LevelUpSpellGrantSnapshot {
  const klass={id:'class',card_number:'CLASS-renamed',name:'Other class'} as CharacterClass;
  const draft={...emptyDraft(),classId:klass.id,level:2};
  const assembled=assemble({race:null,klass,background:null,feats:[],spells:[],actions:[],effects:source?[{
    origin:{kind:'class',id:source,name:source},effect:{id:'feature',card_number:'EFF-feature',name:'Gift',mechanics:{effects:[{resolution:'auto',result:[{
      kind:'grant_spell',value:spell.card_number,label:'always_prepared',...(freeuse?{freeuse:{count:2,recharge:'short_rest',level:2}}:{}),
    }]}]}} as unknown as PassiveEffect,
  }]:[]},draft);
  const rules=resolveCharacterRules({draft,assembled});
  return {assembled,grants:rules.appliedGrants,context:buildCharacterContext(rules,draft,[],klass)};
}

describe('level-up granted spell canonical presentation',()=>{
  let container:HTMLDivElement,root:Root;
  beforeEach(()=>{modes.spells='icon';container=document.createElement('div');document.body.append(container);root=createRoot(container);});
  afterEach(async()=>{await act(async()=>root.unmount());container.remove();});
  it.each(['icon','row'] as const)('honors %s mode, canonical preview, source and free casts without changing the draft',async mode=>{
    modes.spells=mode;
    const before=snapshot(null),after=snapshot('Subclass A',true),original=JSON.stringify(after);
    const resolve=vi.fn(async()=>spell);
    const registry=createRegistry({resolveSpell:resolve,resolveAction:async()=>null,resolveEffect:async()=>null,resolveFeat:async()=>null});
    await act(async()=>root.render(<LevelUpSpellGrants before={before} after={after} spells={[]} registry={registry}/>));
    expect(resolve).toHaveBeenCalledExactlyOnceWith('SPELL-renamed');
    expect(container.textContent).toContain('Всегда подготовлено');
    expect(container.textContent).toContain('Без ячейки · 2 / короткий отдых');
    expect(container.textContent).toContain('Уровень бесплатного применения: 2');
    expect(container.textContent).toContain('Subclass A: Gift');
    const entity=container.querySelector<HTMLButtonElement>(mode==='icon'?'.cs-action-tile':'.sheet-item-row')!;
    expect(entity).not.toBeNull();
    await act(async()=>entity.focus());
    expect(document.body.textContent).toContain('Canonical spell description');
    await act(async()=>entity.click());
    expect(JSON.stringify(after)).toBe(original);
    expect(after.assembled.spells).toEqual([]);
    expect(document.body.querySelector('[title]')).toBeNull();
  });
  it('uses the current subclass selection and hides stale grants while a new bundle loads',async()=>{
    const before=snapshot(null),first=snapshot('Subclass A'),second=snapshot('Subclass B');
    await act(async()=>root.render(<LevelUpSpellGrants before={before} after={first} spells={[spell]}/>));
    expect(container.textContent).toContain('Subclass A: Gift');
    await act(async()=>root.render(<LevelUpSpellGrants before={before} after={first} spells={[spell]} loading/>));
    expect(container.textContent).not.toContain('Subclass A');
    await act(async()=>root.render(<LevelUpSpellGrants before={before} after={second} spells={[spell]}/>));
    expect(container.textContent).toContain('Subclass B: Gift');
    expect(container.textContent).not.toContain('Subclass A');
  });
});
