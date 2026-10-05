// @vitest-environment jsdom
import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {webcrypto} from 'node:crypto';
import ImageJobsPanel from './ImageJobsPanel';
import {beginLegacyImageAttempt,listLegacyImageAttempts,markLegacyImageAttemptUnknown,readLegacyImageAttempt} from '../api/legacyImageAttempts';
const state=vi.hoisted(()=>({id:'owner-A',get:vi.fn(),post:vi.fn()}));
vi.mock('../api/client',()=>({apiClient:{get:state.get,post:state.post}}));
vi.mock('../contexts/AuthContext',()=>({useAuth:()=>({user:{id:state.id}})}));
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
let host:HTMLDivElement,root:Root;
const key=`image-job:${'b'.repeat(64)}`;
function selectOwner(id:string){state.id=id;localStorage.setItem('user',JSON.stringify({id}));}
function button(label:string){const match=Array.from(host.querySelectorAll('button')).find(item=>item.textContent===label);expect(match).toBeDefined();return match!;}
function history(jobs:unknown[]=[],page=1,hasMore=false){return {data:{jobs,page,has_more:hasMore}};}
beforeEach(()=>{state.get.mockReset();state.post.mockReset();localStorage.clear();selectOwner('owner-A');markLegacyImageAttemptUnknown(key);vi.stubGlobal('crypto',webcrypto);host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();vi.unstubAllGlobals();});

it('restores a saved result from owner history without generating it again',async()=>{
 state.get.mockResolvedValue(history([{id:'saved',state:'succeeded',label:'Посох',result:{image_url:'https://images.test/staff.png'}}]));
 await act(async()=>root.render(<ImageJobsPanel/>));expect(host.textContent).toContain('Посох · Сохранено');
 expect(host.querySelector('a')?.href).toBe('https://images.test/staff.png');expect(state.post).not.toHaveBeenCalled();
});

it('releasing an unknown request is explicit and never sends a paid POST',async()=>{
 localStorage.setItem('image-job:local-test','unknown-job');
 state.get.mockResolvedValue(history([{id:'unknown-job',state:'unknown',label:'Иллюстрация'}]));
 await act(async()=>root.render(<ImageJobsPanel/>));expect(host.textContent).toContain('Иллюстрация · Результат неизвестен');
 expect(localStorage.getItem('image-job:local-test')).toBe('unknown-job');
 host.querySelector('summary')!.click();
 await act(async()=>button('Разрешить новый запрос').click());
 expect(localStorage.getItem('image-job:local-test')).toBeNull();expect(state.post).not.toHaveBeenCalled();
 expect(host.textContent).toContain('Предыдущая попытка сохранена');
});

it('drops a late history response from the previous account',async()=>{
 let resolveOld:(value:unknown)=>void=()=>{};
 state.get.mockImplementationOnce(()=>new Promise(resolve=>{resolveOld=resolve;})).mockResolvedValue(history([{id:'new',state:'succeeded',label:'Новый аккаунт',result:{image_url:'https://images.test/new.png'}}]));
 await act(async()=>root.render(<ImageJobsPanel/>));expect(state.get).toHaveBeenCalledOnce();
 selectOwner('owner-B');await act(async()=>root.render(<ImageJobsPanel/>));expect(host.textContent).toContain('Новый аккаунт · Сохранено');
 await act(async()=>resolveOld(history([{id:'old',state:'succeeded',label:'Чужая история'}])));
 expect(host.textContent).not.toContain('Чужая история');expect(host.textContent).toContain('Новый аккаунт · Сохранено');expect(state.post).not.toHaveBeenCalled();
});

it('refreshes history after network loss using only a safe GET',async()=>{
 state.get.mockRejectedValueOnce(Error('offline')).mockResolvedValue(history([{id:'saved',state:'succeeded',label:'Сохранённое изображение'}]));
 await act(async()=>root.render(<ImageJobsPanel/>));expect(host.textContent).toContain('История генерации пока недоступна');
 await act(async()=>button('Обновить историю').click());
 expect(host.textContent).toContain('Сохранённое изображение · Сохранено');expect(state.get).toHaveBeenCalledTimes(2);expect(state.post).not.toHaveBeenCalled();
});

it('reaches an older unknown job beyond the first twenty rows and returns to recent history',async()=>{
 state.get.mockImplementation(async(_route,config)=>config.params.page===1
   ?history(Array.from({length:20},(_,index)=>({id:`saved-${index}`,state:'succeeded',label:`Изображение ${index}`})),1,true)
   :history([{id:'older-unknown',state:'unknown',label:'Старая попытка'}],2,false));
 localStorage.setItem('image-job:older-test','older-unknown');
 await act(async()=>root.render(<ImageJobsPanel/>));expect(button('Новые изображения').disabled).toBe(true);
 await act(async()=>button('Ранее созданные').click());
 expect(state.get).toHaveBeenLastCalledWith('/api/images/jobs',{params:{page:2}});
 expect(host.textContent).toContain('Старая попытка · Результат неизвестен');expect(button('Ранее созданные').disabled).toBe(true);
 await act(async()=>button('Разрешить новый запрос').click());expect(localStorage.getItem('image-job:older-test')).toBeNull();
 await act(async()=>button('Новые изображения').click());expect(state.get).toHaveBeenLastCalledWith('/api/images/jobs',{params:{page:1}});
 expect(host.textContent).toContain('Изображение 0 · Сохранено');expect(state.post).not.toHaveBeenCalled();
});

it('blocks acknowledgement while a legacy call is active, then requires an explicit choice without POST',async()=>{
 const id=beginLegacyImageAttempt(key);state.get.mockResolvedValue(history());
 await act(async()=>root.render(<ImageJobsPanel/>));expect(host.textContent).toContain('Изображение · Генерируется');
 expect(host.querySelector('details')).toBeNull();expect(readLegacyImageAttempt(key)).toEqual({id});
 await act(async()=>markLegacyImageAttemptUnknown(key));expect(host.textContent).toContain('Изображение · Результат неизвестен');
 expect(host.textContent).toContain('Предыдущая попытка могла быть оплачена');
 await act(async()=>button('Подтверждаю новую платную попытку').click());
 expect(readLegacyImageAttempt(key)).toBeNull();expect(host.textContent).toContain('генерация ещё не запущена');expect(state.post).not.toHaveBeenCalled();
});

it('keeps local unknown evidence if acknowledgement storage fails',async()=>{
 const id=beginLegacyImageAttempt(key);markLegacyImageAttemptUnknown(key);state.get.mockResolvedValue(history());
 await act(async()=>root.render(<ImageJobsPanel/>));const failed=vi.spyOn(Storage.prototype,'removeItem').mockImplementation(()=>{throw Error('storage blocked');});
 await act(async()=>button('Подтверждаю новую платную попытку').click());
 expect(host.textContent).toContain('Новая попытка остаётся заблокированной');failed.mockRestore();expect(readLegacyImageAttempt(key)).toEqual({id});expect(state.post).not.toHaveBeenCalled();
});

it('never acknowledges a stale local row after the persisted account changes',async()=>{
 selectOwner('owner-B');const newID=beginLegacyImageAttempt(key);markLegacyImageAttemptUnknown(key);
 selectOwner('owner-A');const oldID=beginLegacyImageAttempt(key);markLegacyImageAttemptUnknown(key);state.get.mockResolvedValue(history());
 await act(async()=>root.render(<ImageJobsPanel/>));
 selectOwner('owner-B');
 await act(async()=>button('Подтверждаю новую платную попытку').click());
 expect(listLegacyImageAttempts()[0].id).toBe(newID);selectOwner('owner-A');expect(readLegacyImageAttempt(key)).toEqual({id:oldID});expect(state.post).not.toHaveBeenCalled();
});

it('rejects a malformed pagination response instead of hiding older unknown jobs',async()=>{
 state.get.mockResolvedValue({data:{jobs:[],page:1}});
 await act(async()=>root.render(<ImageJobsPanel/>));expect(host.textContent).toContain('История генерации пока недоступна');expect(state.post).not.toHaveBeenCalled();
});
