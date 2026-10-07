import {afterEach, describe, expect, it, vi} from 'vitest';
import {AxiosError} from 'axios';
import {apiClient, cardsApi} from './client';
import {clearApiCache} from './apiCache';
const identity=vi.hoisted(()=>({token:'owner' as string|null}));
vi.mock('./authSession',()=>({readPersistedAuthToken:()=>identity.token,signalUnauthorized:vi.fn()}));
const original=apiClient.defaults.adapter;
afterEach(()=>{apiClient.defaults.adapter=original;identity.token='owner';clearApiCache();});
const row=(id:string)=>({id,name:id});
describe.each(['getCardsByIds','getDisplayCardsByIds'] as const)('fresh %s bulk reads',method=>{
  const read=(ids:readonly string[])=>cardsApi[method](ids);
  const route=method==='getCardsByIds'?'/api/cards/runtime/resolve':'/api/cards/resolve';
  it('coalesces a pending ID set and preserves each caller order without retaining completed reads',async()=>{
    let release!:()=>void;
    const gate=new Promise<void>(resolve=>{release=resolve;});
    const requests:string[]=[];
    apiClient.defaults.adapter=async config=>{
      requests.push(String(config.params.ids));await gate;
      return{status:200,data:{cards:[row('a'),row('b')]},headers:{},statusText:'OK',config};
    };
    const first=read(['b','a']);
    const second=read(['a','b','b']);
    try {await vi.waitFor(()=>expect(requests.length).toBeGreaterThan(0));expect(requests).toEqual(['a,b']);}
    finally {release();}
    expect(await first).toEqual([row('b'),row('a')]);
    expect(await second).toEqual([row('a'),row('b')]);
    await read(['a','b']);expect(requests).toEqual(['a,b','a,b']);
  });
  it('coalesces overlapping fallback detail reads with ordinary item readers',async()=>{
    let release!:()=>void;
    const gate=new Promise<void>(resolve=>{release=resolve;});
    const urls:string[]=[];
    apiClient.defaults.adapter=async config=>{
      urls.push(config.url!);
      if(config.url!.endsWith('/resolve'))throw new AxiosError('Not found','ERR_BAD_REQUEST',config,undefined,{status:404,data:'404 page not found',headers:{},statusText:'Not found',config});
      await gate;return{status:200,data:row('a'),headers:{},statusText:'OK',config};
    };
    const detail=cardsApi.getCard('a');const bulk=read(['a']);
    try {await vi.waitFor(()=>expect(urls).toContain(method==='getCardsByIds'?route:'/api/cards/a'));await new Promise(resolve=>setTimeout(resolve,0));expect(urls.filter(url=>url==='/api/cards/a')).toHaveLength(1);if(method==='getDisplayCardsByIds')expect(urls).not.toContain(route);}
    finally {release();}
    expect(await detail).toEqual(row('a'));expect(await bulk).toEqual([row('a')]);
  });
  it('reads exact IDs fresh and does not reuse a result after same-session revocation',async()=>{
    let calls=0;
    apiClient.defaults.adapter=async config=>{calls++;if(calls>1)throw new AxiosError('private','ERR_BAD_REQUEST',config,undefined,{status:404,data:{code:'cards_unavailable'},headers:{},statusText:'Not found',config});return{status:200,data:{cards:[row('a')]},headers:{},statusText:'OK',config};};
    expect(await read(['a','a'])).toEqual([row('a')]);
    await expect(read(['a'])).rejects.toMatchObject({status:404,code:'cards_unavailable'});
    expect(calls).toBe(2);
  });
  it('uses fresh single-ID detail reads only when the older backend lacks the route',async()=>{
    const urls:string[]=[];
    apiClient.defaults.adapter=async config=>{urls.push(config.url!);if(config.url!.endsWith('/resolve'))throw new AxiosError('Not found','ERR_BAD_REQUEST',config,undefined,{status:404,data:'404 page not found',headers:{},statusText:'Not found',config});return{status:200,data:row('a'),headers:{},statusText:'OK',config};};
    expect(await read(['a'])).toEqual([row('a')]);
    expect(urls).toEqual([route,'/api/cards/a']);
  });
  it('discards a response from the previous owner before publishing it',async()=>{
    let finish!:(value:unknown)=>void;let calls=0;
    apiClient.defaults.adapter=async config=>{calls++;const data=calls===1?await new Promise(resolve=>{finish=resolve;}):{cards:[{...row('a'),name:'player'}]};return{status:200,data,headers:{},statusText:'OK',config};};
    const pending=read(['a']);await vi.waitFor(()=>expect(calls).toBe(1));identity.token='other';finish({cards:[{...row('a'),name:'admin'}]});
    expect(await pending).toEqual([{...row('a'),name:'player'}]);expect(calls).toBe(method==='getCardsByIds'?2:3);
  });
  it.each([{cards:[row('a'),row('a')]},{cards:[row('foreign')]},{cards:[]}])('rejects an incomplete/foreign bulk result',async ({cards})=>{
    apiClient.defaults.adapter=async config=>({status:200,data:{cards},headers:{},statusText:'OK',config});
    await expect(read(['a'])).rejects.toThrow('точный список');
  });
});

it('never coalesces undecorated runtime cards with display cards that carry canonical previews',async()=>{
 const urls:string[]=[];let release!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve;});
 apiClient.defaults.adapter=async config=>{urls.push(config.url!);await pending;const card=config.url==='/api/cards/resolve'?{...row('a'),references:[{entity_type:'effect',entity_id:'effect-a'}],referenced_by:[]}:row('a');return{status:200,data:{cards:[card]},headers:{},statusText:'OK',config};};
 const runtime=cardsApi.getCardsByIds(['a']),display=cardsApi.getDisplayCardsByIds(['a']);
 try{await vi.waitFor(()=>expect(urls).toHaveLength(2));expect(urls.sort()).toEqual(['/api/cards/resolve','/api/cards/runtime/resolve']);}finally{release();}
 expect(await runtime).toEqual([row('a')]);expect((await display)[0]).toMatchObject({references:[{entity_id:'effect-a'}]});
});

it('rechecks a public detail when its pending display batch fails for a private sibling',async()=>{
 const urls:string[]=[];let release!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve;});
 apiClient.defaults.adapter=async config=>{urls.push(config.url!);if(config.url==='/api/cards/resolve'){await pending;throw new AxiosError('private sibling','ERR_BAD_REQUEST',config,undefined,{status:404,data:{code:'cards_unavailable'},headers:{},statusText:'Not found',config});}return{status:200,data:row('public'),headers:{},statusText:'OK',config};};
 const batch=cardsApi.getDisplayCardsByIds(['public','private']);const rejected=expect(batch).rejects.toMatchObject({status:404,code:'cards_unavailable'});
 await vi.waitFor(()=>expect(urls).toEqual(['/api/cards/resolve']));const detail=cardsApi.getCard('public');release();
 await rejected;expect(await detail).toEqual(row('public'));expect(urls).toEqual(['/api/cards/resolve','/api/cards/public']);
});
