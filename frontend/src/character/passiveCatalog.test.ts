import {beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({get:vi.fn(),put:vi.fn()}));
vi.mock('../api/client',()=>({apiClient:mocks}));
describe('server-owned passive presentation',()=>{
 beforeEach(()=>{vi.resetModules();mocks.get.mockReset();mocks.put.mockReset();});
 it('loads and saves an unrelated future passive without adding a UI branch',async()=>{
  const row={key:'future.other-policy',name:'Другая политика',description:'Описание',image_url:'/other.png',enabled_description:'Да',disabled_description:'Нет',version:4};
  mocks.get.mockResolvedValue({data:{passives:[row],can_manage:true}});
  mocks.put.mockResolvedValue({data:{...row,name:'Новое оформление',version:5}});
  const catalog=await import('./passiveCatalog');
  await Promise.all([catalog.loadPassiveCatalog(),catalog.loadPassiveCatalog()]);
  expect(mocks.get).toHaveBeenCalledTimes(1);
  const saved=await catalog.savePassivePresentation({...row,name:'Новое оформление'});
  expect(mocks.put).toHaveBeenCalledWith('/api/passive-presentations/future.other-policy',expect.objectContaining({version:4,name:'Новое оформление'}));
  expect(mocks.put.mock.calls[0][1]).not.toHaveProperty('mechanics');
  expect(catalog.passivePresentationEffect(saved)).toMatchObject({name:'Новое оформление',image_url:'/other.png',effect_type:'passive'});
 });
});
