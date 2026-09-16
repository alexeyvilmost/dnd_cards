import {expect,it} from 'vitest';
import {actorPassiveToggles} from './actorPassiveToggles';
import type {ActorState,RuleActionDefinition} from '../rules-core/domain';
it('inherits two independently named defense actions, filters ownership, and retains distinct preference keys',()=>{
  const actions=['shield','other-ward','not-owned'].map(id=>({id,name:`Сущность ${id}`,kind:'spell',spell:{level:1},sourceEntityIds:[id],
    mechanics:{attack_defense:{bonus:5}}})) as RuleActionDefinition[];
  const actor={capabilities:{actionIds:['shield','other-ward']}} as ActorState;
  const toggles=actorPassiveToggles(actor,actions,{'shield':{imageUrl:'/shield.png'},'other-ward':{imageUrl:'/other.png'}},[]);
  const defense=toggles.filter(toggle=>toggle.presentationKey==='reaction.changes-outcome');
  expect(defense).toHaveLength(2);
  expect(defense.map(toggle=>toggle.imageUrl)).toEqual(['/shield.png','/other.png']);
  expect(defense.map(toggle=>toggle.id)).toEqual(['reaction.changes-outcome:shield','reaction.changes-outcome:other-ward']);
  expect(defense.every(toggle=>toggle.defaultEnabled===false)).toBe(true);
});
