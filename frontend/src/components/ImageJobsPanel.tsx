import {useEffect,useRef,useState} from 'react';
import {apiClient} from '../api/client';
import {allowNewImageAttempt,type ImageJob} from '../api/imageJobs';
import {finishLegacyImageAttempt,listLegacyImageAttempts,type LegacyImageAttempt} from '../api/legacyImageAttempts';
import {useAuth} from '../contexts/AuthContext';

const labels:Record<ImageJob['state'],string>={queued:'В очереди',running:'Генерируется',succeeded:'Сохранено',failed:'Не завершено',unknown:'Результат неизвестен'};
export default function ImageJobsPanel(){
  const {user}=useAuth();
  const [jobs,setJobs]=useState<ImageJob[]>([]),[error,setError]=useState(''),[released,setReleased]=useState<string[]>([]);
  const [localAttempts,setLocalAttempts]=useState<LegacyImageAttempt[]>([]),[localError,setLocalError]=useState(''),[acknowledged,setAcknowledged]=useState(false);
  const [page,setPage]=useState(1),[hasMore,setHasMore]=useState(false),[loading,setLoading]=useState(false);
  const refresh=useRef<()=>void>(()=>{});
  useEffect(()=>{setPage(1);setReleased([]);setAcknowledged(false);},[user?.id]);
  useEffect(()=>{
    let active=true,sequence=0,timer:ReturnType<typeof setTimeout>|undefined;
    setJobs([]);setError('');setLocalAttempts([]);setLocalError('');setHasMore(false);
    const loadLocal=()=>{if(!active)return;try{setLocalAttempts(user?listLegacyImageAttempts().filter(row=>row.owner===user.id):[]);setLocalError('');}
      catch{setLocalError('Не удалось прочитать сведения о попытках в этом браузере. Новая генерация заблокирована до восстановления хранилища.');}};
    const load=async()=>{const request=++sequence;if(timer)clearTimeout(timer);loadLocal();
      if(!user){setLoading(false);return;}setLoading(true);try{
      const response=await apiClient.get<{jobs:ImageJob[];page:number;has_more:boolean}>('/api/images/jobs',{params:{page}});if(!active||request!==sequence)return;
      if(!Array.isArray(response.data.jobs)||response.data.page!==page||typeof response.data.has_more!=='boolean')throw Error('Invalid job list');
      setJobs(response.data.jobs);setHasMore(response.data.has_more);setError('');
      if(response.data.jobs.some(job=>job.state==='queued'||job.state==='running'))timer=setTimeout(()=>void load(),3000);
    }catch{if(active&&request===sequence)setError('История генерации пока недоступна. Обновите историю, чтобы проверить результат без новой генерации.');}
    finally{if(active&&request===sequence)setLoading(false);}};
    refresh.current=()=>void load();
    void load();const changed=()=>void load();window.addEventListener('image-jobs-changed',changed);
    window.addEventListener('storage',loadLocal);
    return()=>{active=false;refresh.current=()=>{};if(timer)clearTimeout(timer);window.removeEventListener('image-jobs-changed',changed);window.removeEventListener('storage',loadLocal);};
  },[user?.id,page]);
  const acknowledge=(attempt:LegacyImageAttempt)=>{
    try{
      const current=listLegacyImageAttempts();
      if(attempt.owner!==user?.id||!current.some(row=>!row.active&&row.owner===attempt.owner&&row.id===attempt.id&&row.key===attempt.key))throw Error('Attempt owner changed');
      finishLegacyImageAttempt(attempt.key);setLocalAttempts(listLegacyImageAttempts().filter(row=>row.owner===user?.id));setLocalError('');setAcknowledged(true);
    }
    catch{setLocalError('Не удалось сохранить подтверждение. Новая попытка остаётся заблокированной.');}
  };
  if(!jobs.length&&!error&&!localAttempts.length&&!localError&&!acknowledged&&!loading&&page===1)return null;
  return <section aria-label="История генерации" className="site-panel mb-6 p-4">
    <h2>Последние изображения</h2>
    <button type="button" onClick={()=>refresh.current()} disabled={loading}>Обновить историю</button>
    {loading&&<p role="status">Загрузка истории…</p>}{error&&<p role="status">{error}</p>}
    <ul>{jobs.map(job=><li key={job.id} className="my-3">
      <span>{job.label} · {labels[job.state]}</span>
      {job.state==='succeeded'&&typeof job.result?.image_url==='string'&&<a className="ml-3" href={job.result.image_url} target="_blank" rel="noreferrer">Открыть изображение</a>}
      {(job.state==='failed'||job.state==='unknown')&&!released.includes(job.id)&&<details>
        <summary>Новый запрос из формы</summary>
        <p>Предыдущая попытка могла быть оплачена. Новый запрос оплачивается отдельно и не повторяет старое задание автоматически.</p>
        <button type="button" onClick={()=>{allowNewImageAttempt(job.id);setReleased(current=>[...current,job.id]);}}>Разрешить новый запрос</button>
      </details>}
      {released.includes(job.id)&&<p>Теперь можно запустить новый запрос в форме. Предыдущая попытка сохранена в истории.</p>}
    </li>)}</ul>
    {(page>1||hasMore)&&<nav aria-label="Страницы истории генерации">
      <button type="button" onClick={()=>setPage(current=>current-1)} disabled={loading||page===1}>Новые изображения</button>
      <span className="mx-3">Страница {page}</span>
      <button type="button" onClick={()=>setPage(current=>current+1)} disabled={loading||!hasMore}>Ранее созданные</button>
    </nav>}
    {localError&&<p role="alert">{localError}</p>}
    {localAttempts.length>0&&<div>
      <h3>Попытки в этом браузере</h3>
      <ul>{localAttempts.map(attempt=><li key={attempt.id} className="my-3">
        <p>Изображение · {attempt.active?'Генерируется':'Результат неизвестен'}</p><p>Номер попытки: {attempt.id}</p>
        {!attempt.active&&<details><summary>Разрешить новую попытку</summary>
          <p>Предыдущая попытка могла быть оплачена. Сначала проверьте изображение. Новый запрос оплачивается отдельно.</p>
          <button type="button" onClick={()=>acknowledge(attempt)}>Подтверждаю новую платную попытку</button>
        </details>}
      </li>)}</ul>
    </div>}
    {acknowledged&&<p role="status">Подтверждение сохранено. Новый платный запрос можно запустить в форме; генерация ещё не запущена.</p>}
  </section>;
}
