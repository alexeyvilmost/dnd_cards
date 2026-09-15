import {describe,it,expect} from 'vitest';
import {armorClassTerminology} from './armorClassTerminology';
describe('Armor Class display terminology',()=>{
  it('localizes historical abbreviations and grammatical forms',()=>{
    expect(armorClassTerminology('КЗ 15; +5 к Классу Защиты; класс защиты 10; Armor Class')).toBe('КД 15; +5 к КД; КД 10; КД');
  });
  it('does not confuse protection and immunity with AC or damage words',()=>{
    expect(armorClassTerminology('Защита без доспехов; защита от огня; ЭКЗЕМПЛЯР; ac; armor_class')).toBe('Защита без доспехов; защита от огня; ЭКЗЕМПЛЯР; ac; armor_class');
  });
});
