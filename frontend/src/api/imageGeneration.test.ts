// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { AxiosError, type AxiosAdapter, type AxiosInstance, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import { cardsApi } from './client';
import { imagesApi } from './imagesApi';
import { ImageAPIError, IMAGE_GENERATION_TIMEOUT_MS } from './imageErrors';
import {listLegacyImageAttempts,finishLegacyImageAttempt} from './legacyImageAttempts';

// Keep the real Axios pipeline (timeouts, cancellation and interceptors), with
// a fake transport for each private/public client. No network requests.
const clients = vi.hoisted(() => [] as AxiosInstance[]);
vi.mock('axios', async (importOriginal) => {
  const actual = await importOriginal<typeof import('axios')>();
  return {
    ...actual,
    default: {
      ...actual.default,
      create: (config: Parameters<typeof actual.default.create>[0]) => {
        const client = actual.default.create(config);
        clients.push(client);
        return client;
      },
    },
  };
});

const calls = [
  { route: '/api/images/generate', run: (signal?: AbortSignal) => imagesApi.generateImage('card', 'saved-card', undefined, undefined, 'fantasy', 'high', { signal }) },
  { route: '/api/images/generate-standalone', run: (signal?: AbortSignal) => imagesApi.generateStandalone({ prompt: 'local test' }, { signal }) },
  { route: '/api/cards/generate-image', run: (signal?: AbortSignal) => cardsApi.generateImage({ card_id: 'saved-card', prompt: 'local test' }, { signal }) },
];

function setTransportAdapter(adapter: AxiosAdapter): void {
  for (const client of clients) client.defaults.adapter = config => config.url==='/api/images/jobs/capabilities'
    ? Promise.resolve(response(config,{protocol_version:1,enabled:false})) : adapter(config);
}
function acknowledgePreviousAttempt(){for(const row of listLegacyImageAttempts())finishLegacyImageAttempt(row.key);}

function response(config: InternalAxiosRequestConfig, data: unknown, status = 200): AxiosResponse {
  return { config, data, status, statusText: String(status), headers: { 'x-request-id': 'safe-request' } };
}

describe('image generation API contract', () => {
  beforeEach(() => {
    vi.stubGlobal('crypto', webcrypto);
    localStorage.clear();
    localStorage.setItem('auth_token','local-test');
    localStorage.setItem('user',JSON.stringify({id:'owner-A'}));
    setTransportAdapter(async (config) => response(config, { success: true, image_url: 'https://images.example.test/new.png', message: 'saved' }));
  });
  afterEach(() => vi.unstubAllGlobals());

  for (const call of calls) {
    it(`${call.route} uses the shared deadline and optional abort signal`, async () => {
      const controller = new AbortController();
      let captured: InternalAxiosRequestConfig | undefined;
      setTransportAdapter(async (config) => { captured = config; return response(config, { image_url: 'https://images.example.test/new.png' }); });
      await expect(call.run(controller.signal)).resolves.toMatchObject({ image_url: 'https://images.example.test/new.png' });
      expect(captured?.url).toBe(call.route);
      expect(captured?.timeout).toBe(IMAGE_GENERATION_TIMEOUT_MS);
      expect(captured?.signal).toBe(controller.signal);
      await expect(call.run()).resolves.toMatchObject({ image_url: 'https://images.example.test/new.png' });
    });

    it(`${call.route} keeps storage and uncertain persistence failures safe without a paid retry`, async () => {
      for (const [code, source, outcome] of [
        ['image_storage_failed', 'storage', 'not_saved'],
        ['image_persistence_unknown', 'persistence', 'unknown'],
      ]) {
        let attempts = 0;
        setTransportAdapter(async (config) => {
          attempts++;
          throw new AxiosError('SECRET transport body', 'ERR_BAD_RESPONSE', config, undefined,
            response(config, { code, source, outcome, error: 'SECRET sk-private data:image/png;base64,AAA' }, 503));
        });
        let caught: unknown;
        try { await call.run(); } catch (error) { caught = error; }
        expect(caught).toBeInstanceOf(ImageAPIError);
        expect(caught).toMatchObject({ code, source, outcome, requestId: 'safe-request' });
        expect((caught as Error).message).not.toMatch(/SECRET|sk-private|base64/);
        expect(attempts).toBe(1);
        expect(listLegacyImageAttempts()).toHaveLength(1);
        acknowledgePreviousAttempt(); // The next iteration is a separate explicit paid attempt.
      }
    });

    it(`${call.route} uses the legacy route after a real intercepted capability 404`,async()=>{
      const observed:string[]=[];
      for(const client of clients)client.defaults.adapter=async config=>{
        observed.push(`${config.method} ${config.url}`);
        if(config.url==='/api/images/jobs/capabilities')throw new AxiosError('old backend','ERR_BAD_REQUEST',config,undefined,response(config,{error:'not found'},404));
        return response(config,{image_url:'legacy-result'});
      };
      await expect(call.run()).resolves.toMatchObject({image_url:'legacy-result'});
      expect(observed).toEqual(['get /api/images/jobs/capabilities',`post ${call.route}`]);
      expect(listLegacyImageAttempts()).toEqual([]);
    });

    it(`${call.route} clears only explicit not-started/rejected legacy outcomes after real interceptors`,async()=>{
      for(const outcome of ['not_started','rejected']){
        let attempts=0;
        setTransportAdapter(async config=>{
          attempts++;
          if(attempts===1)throw new AxiosError('SECRET raw provider response','ERR_BAD_RESPONSE',config,undefined,response(config,{code:'image_provider_error',source:'provider',outcome,error:'PRIVATE prompt/token'},503));
          return response(config,{image_url:'deliberate-second-attempt'});
        });
        let caught:unknown;try{await call.run();}catch(error){caught=error;}
        expect(caught).toBeInstanceOf(ImageAPIError);
        expect(caught).toMatchObject({status:503,outcome});
        expect(caught).not.toHaveProperty('response');
        expect(JSON.stringify(caught)).not.toMatch(/SECRET|PRIVATE|prompt\/token/);
        expect(listLegacyImageAttempts()).toEqual([]);
        await expect(call.run()).resolves.toMatchObject({image_url:'deliberate-second-attempt'});
        expect(attempts).toBe(2);
      }
    });

    it(`${call.route} normalizes transport timeout and active cancellation without retries`, async () => {
      let attempts = 0;
      setTransportAdapter(async (config) => { attempts++; throw new AxiosError('timeout', 'ECONNABORTED', config); });
      await expect(call.run()).rejects.toMatchObject({ name: 'ImageAPIError', code: 'image_timeout', source: 'network', outcome: 'unknown' });
      expect(attempts).toBe(1);
      acknowledgePreviousAttempt();
      const controller = new AbortController();
      setTransportAdapter(async (config) => {
        attempts++;
        controller.abort();
        return response(config, {});
      });
      await expect(call.run(controller.signal)).rejects.toMatchObject({ name: 'ImageAPIError', code: 'image_cancelled', outcome: 'unknown' });
      expect(attempts).toBe(2);
    });
  }

  it('an intercepted non-404 capability failure never starts paid generation',async()=>{
    const posts:string[]=[];
    for(const status of [403,503]){
      for(const client of clients)client.defaults.adapter=async config=>{
        if(config.method==='post')posts.push(config.url??'');
        throw new AxiosError('private failed capability','ERR_BAD_RESPONSE',config,undefined,response(config,{error:'SECRET'},status));
      };
      await expect(imagesApi.generateStandalone({prompt:'capability failure'})).rejects.toMatchObject({status});
    }
    expect(posts).toEqual([]);expect(listLegacyImageAttempts()).toEqual([]);
  });
});
