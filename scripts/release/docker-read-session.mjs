import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';

const snapshotPattern=/^[a-fA-F0-9]{8}-[a-fA-F0-9]{8}-[0-9]+$/;
const fixedError=kind=>Object.assign(Error('Owned read-only inventory session failed'),{code:kind});

// One private stdin/stdout connection imports the existing exporter's snapshot.
// Row text is consumed synchronously, never accumulated as a whole inventory.
// A caller failure still removes only the registered, exact labelled container.
export async function withDockerReadSession({command,cleanupCommand=command,config,dsn,name,label,snapshot,progress,spawnProcess=spawn,limits={}},visit){
 if(!/^legacy_inspect_[a-z0-9_]+$/.test(name)||label!==`bagofholding.legacy-inspection=${name}`||!snapshotPattern.test(snapshot)||typeof progress!=='function')throw Error('Owned exported read snapshot required');
 if(!/^\S+@sha256:[a-f0-9]{64}$/.test(config.postgresImage??'')||typeof config.databaseNetwork!=='string'||!config.databaseNetwork)throw Error('Exact private database transport required');
 const maxLineBytes=limits.maxLineBytes??64*1024*1024,maxMetadataBytes=limits.maxMetadataBytes??16*1024*1024,statementMilliseconds=limits.statementMilliseconds??70000;
 if(!Number.isSafeInteger(maxLineBytes)||maxLineBytes<1||maxLineBytes>64*1024*1024||!Number.isSafeInteger(maxMetadataBytes)||maxMetadataBytes<1||maxMetadataBytes>16*1024*1024||!Number.isSafeInteger(statementMilliseconds)||statementMilliseconds<1||statementMilliseconds>70000)throw Error('Bounded read-session limits required');
 const client=`${name}_stream`,nonce=randomBytes(16).toString('hex');
 let child,active,buffer='',failed,closed=false,sequence=0,exitPromise,bodyError,answer;
 const fail=error=>{failed??=error;if(active){clearTimeout(active.timer);active.reject(error);active=null;}};
 const cleanup=async()=>{
  const listed=await cleanupCommand(['container','ls','-a','--filter',`label=${label}`,'--format','{{.Names}}']);
  if(listed.split(/\r?\n/).includes(client)){
   const value=JSON.parse(await cleanupCommand(['container','inspect',client]))[0];
   if(value.Config.Labels?.['bagofholding.legacy-inspection']!==name)throw Error('Read-session helper ownership changed');
   await cleanupCommand(['container','rm','--force',client]);
  }
 };
 const submit=async(sql,consume,{closing=false}={})=>{
  if(!closing)await progress();
  if(failed||closed)throw failed??fixedError('CURSOR_CLOSED');
  if(active)throw fixedError('CURSOR_CONCURRENT_QUERY');
  const result=await new Promise((resolve,reject)=>{
   const marker=`__inventory_${nonce}_${++sequence}__`;
   const timer=setTimeout(()=>{fail(fixedError('CURSOR_STATEMENT_TIMEOUT'));child.kill();},statementMilliseconds);
   active={marker,consume,resolve,reject,timer,lines:consume?undefined:[],bytes:0};
   child.stdin.write(`${sql}\n\\echo ${marker}\n`);
  });
  if(!closing)await progress();
  return result;
 };
 try{
  await progress(true);
  child=spawnProcess('docker',['run','--log-driver','none','--name',client,'--label',label,'-i','--read-only','--network',config.databaseNetwork,'-e','DATABASE_URL','-e','PGCONNECT_TIMEOUT=10','--entrypoint','sh',config.postgresImage,'-ec','exec psql "$DATABASE_URL" -X -qAt -v ON_ERROR_STOP=1 -v VERBOSITY=sqlstate'],{
   env:{...Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.toUpperCase().startsWith('PG'))),DATABASE_URL:dsn},windowsHide:true,stdio:['pipe','pipe','pipe']});
  child.stdin.on('error',()=>{});child.stderr.resume();
  const decoder=new TextDecoder('utf-8',{fatal:true});
  child.stdout.on('data',chunk=>{
   try{
    try{buffer+=decoder.decode(chunk,{stream:true});}catch{throw fixedError('CURSOR_INVALID_UTF8');}let position;
    while((position=buffer.indexOf('\n'))>=0){
     const line=buffer.slice(0,position).replace(/\r$/,'');buffer=buffer.slice(position+1);
     if(Buffer.byteLength(line)>maxLineBytes)throw fixedError('CURSOR_ROW_LIMIT');
     if(!active)throw fixedError('CURSOR_UNEXPECTED_OUTPUT');
     if(line===active.marker){const complete=active;active=null;clearTimeout(complete.timer);complete.resolve(complete.lines?.join('\n')??'');}
     else if(active.consume){const consumed=active.consume(line);if(consumed&&typeof consumed.then==='function')throw fixedError('CURSOR_ASYNC_CONSUMER');}
     else{active.bytes+=Buffer.byteLength(line);if(active.bytes>maxMetadataBytes)throw fixedError('CURSOR_METADATA_LIMIT');active.lines.push(line);}
    }
    if(Buffer.byteLength(buffer)>maxLineBytes)throw fixedError('CURSOR_ROW_LIMIT');
   }catch(error){fail(error);child.kill();}
  });
  child.on('error',()=>fail(fixedError('CURSOR_SUBPROCESS_UNAVAILABLE')));
  exitPromise=new Promise(resolve=>child.on('close',code=>{closed=true;try{buffer+=decoder.decode();}catch{fail(fixedError('CURSOR_INVALID_UTF8'));}if(active||code!==0||buffer.length)fail(fixedError('CURSOR_SUBPROCESS_FAILED'));resolve(code);}));
  await submit(`BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET TRANSACTION SNAPSHOT '${snapshot}'; SET LOCAL statement_timeout='60s'; SET LOCAL lock_timeout='2s'; SET LOCAL idle_in_transaction_session_timeout='120s'; SET LOCAL transaction_timeout='1800s';`);
  answer=await visit({query:sql=>submit(sql),rows:(sql,consume)=>submit(sql,consume)});
  // An imported snapshot survives exporter exit; keeper liveness must be
  // checked explicitly, even inside the normal throttled renewal interval.
  await progress(true);
  if(failed)throw failed;
 }catch(error){bodyError=error;}
 finally{
  const cleanupErrors=[];
  if(child){
   try{if(!closed&&!failed)await submit('ROLLBACK;',undefined,{closing:true});}catch{cleanupErrors.push(fixedError('CURSOR_ROLLBACK_FAILED'));}
   child.stdin.end();
   let exited;
   if(exitPromise){let timer;exited=await Promise.race([exitPromise,new Promise(resolve=>{timer=setTimeout(()=>resolve(null),3000);})]);clearTimeout(timer);}
   if(!bodyError&&(exited!==0||failed))cleanupErrors.push(fixedError('CURSOR_SUBPROCESS_FAILED'));
   try{await cleanup();}catch{cleanupErrors.push(fixedError('CURSOR_OWNED_CLEANUP_FAILED'));}
   if(!closed)child.kill();
   if(exitPromise&&!closed){let timer;const killed=await Promise.race([exitPromise,new Promise(resolve=>{timer=setTimeout(()=>resolve(false),3000);})]);clearTimeout(timer);if(killed===false)cleanupErrors.push(fixedError('CURSOR_PROCESS_CLEANUP_FAILED'));}
  }else try{await cleanup();}catch{cleanupErrors.push(fixedError('CURSOR_OWNED_CLEANUP_FAILED'));}
  if(cleanupErrors.length)throw new AggregateError([...(bodyError?[bodyError]:[]),...cleanupErrors],'Owned read-session cleanup failed');
 }
 if(bodyError)throw bodyError;
 return answer;
}
