import {describe,expect,it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import CombatTriggeredActionPanel from './CombatTriggeredActionPanel';
import type {SoloCombatState} from '../solo-combat/types';
import compiled from '../pages/rulesLabFixture.generated.json';
import type {Action,Spell} from '../types';

describe('canonical post-attack icons',()=>{
  it('renders both spell and nonspell choices as icons with canonical previews',()=>{
    const spell={id:'spell',name:'Spell',level:1,description:'Spell description',image_url:'/spell.png',mechanics:{}} as Spell;
    const action={id:'ability',name:'Ability',description:'Ability description',image_url:'/ability.png',mechanics:{}} as Action;
    const state={world:{actors:{hero:{...compiled.roots.magicInitiateFighter.actor,id:'hero',name:'Hero'}}},
      pendingTriggeredAction:{event:'hit',sourceActorId:'hero',targetIds:[],optionActionIds:['spell','ability']},
      catalogActions:[{id:'spell',name:'Spell',kind:'spell',spell:{level:1},sourceEntityIds:['spell'],mechanics:{}},
        {id:'ability',name:'Ability',kind:'nonSpell',sourceEntityIds:['ability'],mechanics:{}}],
      actionPresentation:{spell:{spellRef:spell,imageUrl:'/spell.png'},ability:{actionRef:action,imageUrl:'/ability.png'}},
    } as unknown as SoloCombatState;
    const html=renderToStaticMarkup(<CombatTriggeredActionPanel state={state} busy={false} onChoose={()=>{}}/>);
    expect(html).toContain('combat-triggered-action-icons');
    expect(html.match(/class="cs-action-tile(?: |")/g)).toHaveLength(2);
    expect(html).not.toContain('class="sheet-item-row');
    expect(html).toContain('/spell.png');expect(html).toContain('/ability.png');
  });
});
