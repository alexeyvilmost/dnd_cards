// Shared GET-only transport. Never retries dispatch, deployment or database writes.
class MetadataFailure extends Error {
  constructor(diagnostic) {super('GitHub read-only metadata request failed');this.diagnostic=Object.freeze(diagnostic);}
}
export function githubMetadataDiagnostic(error) {return error instanceof MetadataFailure?error.diagnostic:null;}
export function createGithubMetadataReader({repository,token,allowCommitHead=false,operation='github-metadata'},
  {request=fetch,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),onDiagnostic=()=>{}}={}) {
  if(!/^[\w.-]+\/[\w.-]+$/.test(repository??'')||!token||typeof allowCommitHead!=='boolean'
    ||!['github-metadata','writer-github-metadata','workflow-github-metadata'].includes(operation))throw Error('Read-only GitHub identity required');
  const number=value=>typeof value==='string'&&/^\d+$/.test(value)&&Number.isSafeInteger(Number(value))?Number(value):null;
  return async route=>{
    if(typeof route!=='string'||!/^[a-zA-Z0-9_./?=&-]+$/.test(route)||route.includes('..')
      ||!route.startsWith('actions/')&&!(allowCommitHead&&route==='commits/main'))throw Error('Invalid metadata route');
    for(let attempt=1;attempt<=3;attempt++){
      let response,reason='transport';
      try{response=await request('https://api.github.com/repos/'+repository+'/'+route,{method:'GET',headers:{Authorization:'Bearer '+token,
        Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'},redirect:'error',signal:AbortSignal.timeout(15000)});reason='http';}
      catch(error){if(['TimeoutError','AbortError'].includes(error?.name))reason='timeout';}
      if(response?.ok){try{return await response.json();}catch(error){reason=['TimeoutError','AbortError'].includes(error?.name)?'timeout':error instanceof SyntaxError?'invalid-json':'transport';}}
      const diagnostic={operation,attempt,reason,status:Number.isInteger(response?.status)?response.status:null,
        rateLimitRemaining:number(response?.headers?.get('x-ratelimit-remaining')),rateLimitReset:number(response?.headers?.get('x-ratelimit-reset')),
        retryAfterSeconds:number(response?.headers?.get('retry-after'))};
      onDiagnostic(diagnostic);
      const throttled=response?.status===429||response?.status===403&&(diagnostic.rateLimitRemaining===0||diagnostic.retryAfterSeconds!==null);
      const resetDelay=diagnostic.rateLimitReset===null?null:Math.max(0,diagnostic.rateLimitReset-Math.floor(Date.now()/1000));
      const delaySeconds=throttled?(diagnostic.retryAfterSeconds??resetDelay):1;
      const retry=reason==='transport'||reason==='timeout'||[500,502,503,504].includes(response?.status)||throttled&&delaySeconds!==null&&delaySeconds<=10;
      if(attempt===3||!retry)throw new MetadataFailure(diagnostic);
      await wait(Math.max(1,delaySeconds??1)*1000);
    }
  };
}
