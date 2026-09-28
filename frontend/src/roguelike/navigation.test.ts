import {describe,expect,it} from 'vitest';
import {runHasCharacter} from './navigation';
import type {RoguelikeRun} from './api';

describe('roguelike party membership',()=>{
  it('recognizes both the primary sheet and a secondary party sheet for camp level-up',()=>{
    const run={character_id:'primary',party:{members:[{character_id:'secondary',source_character_id:'source'}]}} as RoguelikeRun;
    expect(runHasCharacter(run,'primary')).toBe(true);
    expect(runHasCharacter(run,'secondary')).toBe(true);
    expect(runHasCharacter(run,'outsider')).toBe(false);
  });
});
