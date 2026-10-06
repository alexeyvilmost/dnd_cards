// Read-only discovery. A green workflow with a skipped deploy job is not a
// deployment. The receipt contents are validated separately after download.
import {loadReviewedDeploymentRefusal,assertReviewedRefusalRun,assertReviewedRefusalBaseline}from'./reviewed-deployment-refusal.mjs';
const positive = value => Number.isSafeInteger(value) && value > 0;
const timestamp = value => {
  const match = typeof value === 'string' && /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?Z$/.exec(value);
  if (!match) return NaN;
  const canonical = `${match[1]}.${(match[2] ?? '').padEnd(3, '0')}Z`, parsed = Date.parse(canonical);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === canonical ? parsed : NaN;
};
const runIdentity = (run, repository) => {
  if (!positive(run?.id) || !positive(run.run_attempt)
    || run.path !== '.github/workflows/deploy.yml' || run.head_branch !== 'main'
    || !['push', 'workflow_dispatch', 'workflow_run'].includes(run.event)
    || run.repository?.full_name !== repository || run.head_repository?.full_name !== repository
    || !/^[a-f0-9]{40}$/.test(run.head_sha ?? '') || run.status !== 'completed'
    || !['success', 'failure', 'cancelled', 'timed_out', 'neutral', 'skipped', 'action_required', 'stale'].includes(run.conclusion)) {
    throw Error('Untrusted or ambiguous deployment workflow metadata');
  }
  return {id: run.id, workflow: run.path, repository, controlCommit: run.head_sha,
    event: run.event, runAttempt: run.run_attempt, conclusion: run.conclusion};
};
const sameRun = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function* pages(get, route, key, maxPages = 100, maxKnownTotal = Infinity) {
  let total, count = 0;
  const seen = new Set();
  for (let page = 1; page <= maxPages; page++) {
    const response = await get(`${route}${route.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
    const rows = response?.[key];
    if (!Number.isSafeInteger(response?.total_count) || response.total_count < 0
      || !Array.isArray(rows) || rows.length > 100 || total !== undefined && total !== response.total_count) {
      throw Error('Deployment baseline discovery metadata unavailable or changed during pagination');
    }
    total = response.total_count;
    if (total > maxKnownTotal) throw Error('Deployment baseline exceeds the GitHub filtered search completeness limit; no fallback is permitted');
    if (!rows.length && count !== total || count + rows.length > total) throw Error('Incomplete deployment baseline pagination');
    for (const row of rows) {
      if (!positive(row?.id) || seen.has(row.id)) throw Error('Ambiguous deployment baseline pagination identity');
      seen.add(row.id);
    }
    count += rows.length;
    yield rows;
    if (count === total) return;
  }
  throw Error('Deployment baseline discovery pagination limit reached; no fallback is permitted');
}

async function list(get, route, key) {
  const rows = [];
  for await (const page of pages(get, route, key)) rows.push(...page);
  return rows;
}

export async function selectLatestDeployedRun(get, {repository, now = Date.now(),controlRoot} = {}) {
  if (typeof get !== 'function' || !/^[\w.-]+\/[\w.-]+$/.test(repository ?? '') || !Number.isFinite(now)) {
    throw Error('Invalid deployment baseline discovery request');
  }
  // Include failed completed runs: an attempted cutover with an unclear result
  // requires recovery, not an automatic return to an older successful baseline.
  const route = 'actions/workflows/deploy.yml/runs?branch=main&status=completed';
  let latest, tied = false;const refused=[];
  // GitHub orders workflow runs by creation. A historical manual rerun can
  // deploy after a newer-created run, so every available page must be scanned.
  // Filtered workflow searches return at most 1,000 rows. At that boundary
  // completeness cannot be assumed even if a capped total_count is reported.
  for await (const runs of pages(get, route, 'workflow_runs', 100, 999)) {
    for (const listed of runs) {
      const identity = runIdentity(listed, repository);
      const fresh = runIdentity(await get(`actions/runs/${identity.id}`), repository);
      if (!sameRun(identity, fresh)) throw Error('Deployment workflow changed during discovery');
      const jobs = await list(get, `actions/runs/${identity.id}/jobs?filter=latest`, 'jobs');
      const deployJobs = jobs.filter(job => job.name === 'deploy');
      if (deployJobs.length !== 1) throw Error('Missing or ambiguous deploy job; baseline cannot be inferred');
      const job = deployJobs[0];
      if (job.run_id !== identity.id || job.head_sha !== identity.controlCommit
        || job.run_attempt !== undefined && job.run_attempt !== identity.runAttempt || job.status !== 'completed') {
        throw Error('Deploy job metadata does not match the completed workflow attempt');
      }
      if (job.conclusion === 'skipped') {
        if (!sameRun(identity, runIdentity(await get(`actions/runs/${identity.id}`), repository))) throw Error('Deployment workflow changed during discovery');
        continue;
      }
      if (!['success', 'failure', 'cancelled', 'timed_out', 'neutral', 'action_required', 'stale'].includes(job.conclusion)) throw Error('Deploy job has an unknown or ambiguous terminal result');
      const started = timestamp(job.started_at), completed = timestamp(job.completed_at);
      if (!Number.isFinite(started) || !Number.isFinite(completed) || completed < started || completed > now) throw Error('Deploy job timestamps are unavailable or invalid');
      // Only a committed, individually audited rehearsal refusal may be
      // reconciled. Unknown failures, reruns and changed metadata still block.
      if(job.conclusion!=='success'||identity.conclusion!=='success'){
        const proof=loadReviewedDeploymentRefusal({id:identity.id,attempt:identity.runAttempt,repository,controlRoot});
        if(proof){assertReviewedRefusalRun(proof,{identity,job,now});if(!sameRun(identity,runIdentity(await get(`actions/runs/${identity.id}`),repository)))throw Error('Reviewed refused deployment changed during discovery');refused.push({proof,completed});continue;}
      }
      if (!latest || completed > latest.completed) {
        latest = {identity, job, started, completed}; tied = false;
      } else if (completed === latest.completed) tied = true;
    }
  }
  if (!latest){if(refused.length)throw Error('Reviewed refusal has no genuine successful baseline');return null;}
  if (tied) throw Error('Latest deployment completion timestamp is ambiguous; recovery is required');
  const {identity, job, started, completed} = latest;
  if (job.conclusion !== 'success' || identity.conclusion !== 'success') {
    throw Error('Latest attempted deployment has an unsuccessful or ambiguous result; recovery is required');
  }
  const artifacts = await list(get, `actions/runs/${identity.id}/artifacts`, 'artifacts');
  const receipts = artifacts.filter(artifact => artifact.name === 'deployed-release');
  if (receipts.length !== 1) throw Error('Actual deployment receipt is missing or ambiguous; no older baseline fallback');
  const receipt = receipts[0], created = timestamp(receipt.created_at), expires = timestamp(receipt.expires_at);
  if (receipt.expired !== false || !positive(receipt.size_in_bytes) || !Number.isFinite(expires) || expires <= now
    || receipt.workflow_run?.id !== identity.id || receipt.workflow_run?.head_sha !== identity.controlCommit
    || !Number.isFinite(created) || created < started || created > completed) {
    throw Error('Actual deployment receipt is expired, stale, or belongs to another workflow attempt');
  }
  if (!sameRun(identity, runIdentity(await get(`actions/runs/${identity.id}`), repository))) throw Error('Deployment workflow changed during discovery');
  const selected={id: identity.id, workflow: identity.workflow, repository, controlCommit: identity.controlCommit,
    event: identity.event, runAttempt: identity.runAttempt, artifactId: receipt.id, completedAt: job.completed_at};
  const applicable=refused.filter(row=>row.completed>=completed);for(const row of applicable){if(row.completed===completed)throw Error('Reviewed refusal completion is ambiguous');assertReviewedRefusalBaseline(row.proof,selected);}
  return {...selected,...(applicable.length?{reviewedRefusals:applicable.map(row=>row.proof)}:{})};
}
