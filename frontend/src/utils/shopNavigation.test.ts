import {describe,it,expect} from 'vitest';
import {shopReturnTo,shopURLFromPage} from './shopNavigation';
describe('shop return destination',()=>{
  it.each(['/roguelike/run','/characters-v3/hero?roguelike=run#equipment','/?type=items&tag=rare'])('remembers %s including query and hash',from=>{
    const page=new URL(from,'https://local.invalid');
    const link=shopURLFromPage('/shop/roguelike?roguelike=run&character=hero',page);
    const params=new URL(link,'https://local.invalid').searchParams;
    expect(params.get('character')).toBe('hero');
    expect(shopReturnTo(params.get('returnTo'))).toBe(from);
  });
  it('preserves the original page through shop setup and character/filter changes',()=>{
    const first=shopURLFromPage('/shop/new',new URL('/characters-forge','https://local.invalid'));
    const second=shopURLFromPage('/shop/generated?vendor=smith',new URL(first,'https://local.invalid'));
    const params=new URL(second,'https://local.invalid').searchParams;
    params.set('character','hero');
    expect(shopReturnTo(params.get('returnTo'))).toBe('/characters-forge');
  });
  it.each([null,'https://evil.test','//evil.test','/\\evil.test','/%5cevil.test','/shop/new','/shop/roguelike?x=1','/a/../shop/new','/%73hop/new','/%2fexample.org','/%'])('rejects unsafe/looping destination %s',value=>{
    expect(shopReturnTo(value)).toBeUndefined();
  });
  it('does not invent an origin for direct shop links',()=>{
    expect(shopURLFromPage('/shop/generated',new URL('/shop/new','https://local.invalid'))).toBe('/shop/generated');
  });
});
