// @vitest-environment jsdom
import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import ImageLibraryModal from './ImageLibraryModal';
import {getImageLibrary} from '../api/imageLibraryApi';
vi.mock('../api/imageLibraryApi',()=>({getImageLibrary:vi.fn(),getRarities:async()=>({rarities:[]}),deleteFromLibrary:vi.fn(),updateImageLibrary:vi.fn()}));
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const row=(id:string)=>({id,cloudinary_id:id,cloudinary_url:`/${id}.png`,card_name:id,created_at:'',updated_at:''});
const response=(id:string,page=1,total=201)=>({images:[row(id)],pagination:{page,limit:100,total}});
describe('whole image catalog search',()=>{
 let root:Root,host:HTMLDivElement;
 beforeEach(()=>{vi.useFakeTimers();vi.mocked(getImageLibrary).mockReset();host=document.createElement('div');document.body.append(host);root=createRoot(host);});
 afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.useRealTimers();});
 const render=async()=>act(async()=>root.render(<ImageLibraryModal isOpen onClose={()=>{}} onSelectImage={()=>{}} initialFilters={{item_type:'weapon'}}/>));
 const type=async(value:string)=>act(async()=>{
   const input=host.querySelector<HTMLInputElement>('input[placeholder="Введите название карты..."]')!;
   Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,value);
   input.dispatchEvent(new Event('input',{bubbles:true}));
 });
 it('queries the server as you type and pages the applied search, ignoring initial filter suggestions',async()=>{
   vi.mocked(getImageLibrary).mockResolvedValueOnce(response('first')).mockResolvedValueOnce(response('rare-beyond-first-page')).mockResolvedValueOnce(response('next-search-page',2));
   await render();
   expect(vi.mocked(getImageLibrary).mock.calls[0][0]).toMatchObject({page:1,search:'',item_type:''});
   await type('rare');await act(async()=>vi.advanceTimersByTime(260));
   expect(vi.mocked(getImageLibrary).mock.calls[1][0]).toMatchObject({page:1,search:'rare',item_type:''});
   expect(host.textContent).toContain('rare-beyond-first-page');
   const scroller=host.querySelector('#image-scroll-container')!;
   await act(async()=>scroller.dispatchEvent(new Event('scroll')));
   expect(vi.mocked(getImageLibrary).mock.calls[2][0]).toMatchObject({page:2,search:'rare',item_type:''});
   expect(host.querySelector('img[src="/next-search-page.png"]')).not.toBeNull();
 });
 it('ignores a late response belonging to an older query',async()=>{
   let finishOld!:(value:ReturnType<typeof response>)=>void;
   vi.mocked(getImageLibrary).mockResolvedValueOnce(response('first')).mockImplementationOnce(()=>new Promise(resolve=>{finishOld=resolve;})).mockResolvedValueOnce(response('new-result',1,1));
   await render();await type('old');await act(async()=>vi.advanceTimersByTime(260));
   await type('new');await act(async()=>vi.advanceTimersByTime(260));
   await act(async()=>finishOld(response('stale-result')));
   expect(host.textContent).toContain('new-result');expect(host.textContent).not.toContain('stale-result');
 });
 it('does not get stuck loading when text is erased before debounce completes',async()=>{
   vi.mocked(getImageLibrary).mockResolvedValue(response('restored-first-page'));
   await render();await type('x');await type('');
   await act(async()=>vi.advanceTimersByTime(260));
   expect(vi.mocked(getImageLibrary).mock.lastCall?.[0]).toMatchObject({search:'',page:1});
   expect(host.textContent).toContain('restored-first-page');
   expect(host.querySelector('#image-scroll-container img')).not.toBeNull();
 });
});
