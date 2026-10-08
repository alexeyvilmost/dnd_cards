import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {afterEach,expect,it,vi} from 'vitest';
import type {Action,Spell,Background} from '../types';
import ActionPreview from './ActionPreview';
import SpellPreview from './SpellPreview';
import BackgroundPreview from './BackgroundPreview';
import ClassPreview from './ClassPreview';
vi.mock('./EntityRefRegistry',()=>({useEntityRef:()=>({entity:{id:'feat-origin',name:'Устойчивый'},error:false,loading:false})}));
afterEach(()=>vi.unstubAllGlobals());
it.each([false,true])('controls detailed text without hiding the primary description, enabled=%s',enabled=>{
 vi.stubGlobal('localStorage',{getItem:()=>JSON.stringify({showDetailedPreview:enabled})});
 const base={id:'test',name:'Entity',description:'PRIMARY_DESCRIPTION',detailed_description:'DETAIL_DESCRIPTION',show_detailed_description:true};
 const action=renderToStaticMarkup(createElement(ActionPreview,{action:{...base,action_type:'class_feature'} as Action,resources:[]}));
 const spellEntity:Spell={...base,level:1,rarity:'common',card_number:'preview-spell',component_verbal:true,component_somatic:false,component_material:false,concentration:false,ritual:false,is_healing:false,created_at:'',updated_at:''};
 const spell=renderToStaticMarkup(createElement(SpellPreview,{spell:spellEntity}));
 for(const html of [action,spell]) {
  expect(html).toContain('PRIMARY_DESCRIPTION');expect(html.includes('DETAIL_DESCRIPTION')).toBe(enabled);
 }
});
it('shows the resolved origin feat name instead of its database identifier',()=>{
 const background={id:'origin',name:'Origin',origin_feat:'12345678-1234-4567-8123-123456789abc'} as Background;
 const html=renderToStaticMarkup(createElement(BackgroundPreview,{background}));
 expect(html).toContain('Устойчивый');expect(html).not.toContain(background.origin_feat);
 expect(html).toContain('/entity/feats/feat-origin');
});
it('localizes background skills and removes progression level lists from class previews',()=>{
 const background=renderToStaticMarkup(createElement(BackgroundPreview,{background:{id:'bg',name:'Предыстория',skill_proficiencies:['athletics','stealth']} as Background}));
 expect(background).toContain('Атлетика, Скрытность');expect(background).not.toContain('athletics');
 const klass=renderToStaticMarkup(createElement(ClassPreview,{characterClass:{id:'class',name:'Класс',level_progression:{'3':{effects:['effect']}}} as never}));
 expect(klass).not.toContain('Уровни способностей');
});
