import {describe,expect,it} from 'vitest';
import manifest from '../../../scripts/content/data/item-completion-middle-20260929.json';
import related from '../../../scripts/content/data/item-completion-middle-related-20260929.json';
import migration from '../../../backend/migrations/data/item-completion-279/items.json';
import {validateMechanics} from './validateMechanics';
import {projectRuleAction} from '../canon/ruleActionProjection';
import type {Action} from '../types';
import {parseWeaponProfile} from './weaponProfile';

type Dict=Record<string,unknown>;
describe('middle item completion declarations',()=>{
  it('validates every authored item and related action through the canonical schema',()=>{
    const errors:string[]=[];
    for(const [ref,row] of Object.entries(manifest)){
      const mechanics=row.mechanics as Dict|null;if(!mechanics)continue;
      const parsed=validateMechanics(mechanics,{id:ref,name:ref,kind:'passive_effect'});
      if(!parsed.valid)errors.push(`${ref}: ${parsed.errors.join('; ')}`);
      if(mechanics.weapon_profile){const weapon=parseWeaponProfile({id:ref,mechanics});if(!weapon.valid)errors.push(`${ref}: ${weapon.issue}`);}
    }
    for(const row of related.entities){const patch=row.patch as Dict;if(!patch.mechanics)continue;
      const migrated=migration.entities.find(entry=>entry.entity_type===row.entity_type&&entry.id===row.id);
      if(!migrated){errors.push(`${row.id}: related entity is missing from migration 279`);continue;}
      if(JSON.stringify(migrated.patch)!==JSON.stringify(row.patch)){
        errors.push(`${migrated.card_number}: migration 279 patch differs from authored middle data`);
        continue;
      }
      // Existing entities contribute their immutable snapshot columns; a
      // mechanics-only update is never itself a complete Action source.
      const entity={...(migrated.preimage??{}),...patch,id:migrated.id,
        card_number:migrated.card_number,name:migrated.name};
      const parsed=validateMechanics(entity.mechanics as Dict,{id:String(row.id),name:String(entity.name),kind:row.entity_type==='action'?'action':'passive_effect'});
      if(!parsed.valid)errors.push(`${entity.card_number}: ${parsed.errors.join('; ')}`);
      if(row.entity_type==='action')try{projectRuleAction(entity as unknown as Action);}catch(error){errors.push(`${entity.card_number}: ${String(error)}`);}
    }
    expect(errors).toEqual([]);
  });
});
