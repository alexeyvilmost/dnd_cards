import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { projectRuleAction } from '../canon/ruleActionProjection';
import { materializeDeclaredMechanicsTargeting } from '../rules-core/actionTargeting';
import type { Action } from '../types';

const manifestPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)),
  '../../../scripts/content/data/action-variants-280.json');
type Row = { entity_type:'action'; id:string; card_number:string; name:string;
  preimage:{mechanics:Record<string,unknown>}|null;
  patch:Action|{mechanics:Record<string,unknown>}; };
const rows = JSON.parse(fs.readFileSync(manifestPath,'utf8')) as Row[];
const parents=rows.filter(row=>row.preimage!==null),children=rows.filter(row=>row.preimage===null);
const mechanics=(row:Row)=>row.patch.mechanics as Record<string,unknown>;
const choices=(value:unknown):number=>Array.isArray(value)
  ? value.reduce((sum,entry)=>sum+choices(entry),0)
  : value&&typeof value==='object'
    ? Number((value as Record<string,unknown>).kind==='choice')
      + Object.values(value).reduce<number>((sum,entry)=>sum+choices(entry),0):0;

describe('fixed action variant data',()=>{
  it('maps all fixed options into distinct executable child actions',()=>{
    expect(parents).toHaveLength(6);
    expect(children).toHaveLength(23);
    expect(new Set(rows.map(row=>row.id)).size).toBe(rows.length);
    for(const parent of parents){
      const listed=children.filter(row=>mechanics(row).variant_of_action_id===parent.id);
      expect(mechanics(parent).action_variant_ids,parent.card_number).toEqual(listed.map(row=>row.id));
      for(const child of listed){
        expect(choices(mechanics(child)),child.card_number).toBe(0);
        expect(()=>projectRuleAction({...child.patch as Action,
          mechanics:materializeDeclaredMechanicsTargeting(mechanics(child))}),child.card_number).not.toThrow();
      }
    }
  });
  it('binds Bait and Switch recipient and Help stabilization to fixed outcomes',()=>{
    const bait=parents.find(row=>row.card_number==='ACT-bm-bait-switch')!;
    const versions=children.filter(row=>mechanics(row).variant_of_action_id===bait.id);
    expect(versions.map(row=>(mechanics(row).effects as {who?:string}[])[1].who)).toEqual(['self','target']);
    const help=parents.find(row=>row.card_number==='action_help')!;
    const stabilize=children.find(row=>mechanics(row).variant_of_action_id===help.id&&row.name.includes('Стабилизировать'))!;
    expect(mechanics(stabilize).pre_action_check).toEqual({ability:'wis',skill:'medicine',dc:10});
    expect(JSON.stringify(mechanics(stabilize).effects)).toContain('stabilize');
  });
});
