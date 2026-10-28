import { createHash } from 'node:crypto';
import { GithubAppService } from '../services/githubAppService.js';
import { GithubUserConnectionService } from '../services/githubUserConnectionService.js';
import { changesBetween, protectedPath, readArchive, DevelopmentError } from './archive.js';
import { DevelopmentService } from './service.js';
import { db, getBlob, owned, type DevelopmentScope } from './persistence.js';

/** All writes require a fresh intersection of owner and installation permissions. No global repository token. */
export async function publishDevelopmentPullRequest(scope: DevelopmentScope, jobId: string) {
  const { ref, data: job } = await owned('development_jobs', jobId, scope), ws = await DevelopmentService.workspace(scope, job.workspaceId);
  const system = (await db().collection('development_config').doc('system').get()).data();
  if (ws.paused || system?.enabled === false) throw new DevelopmentError('development_paused', 'Publicação bloqueada pelo controle persistente.', 409);
  if (!['ready', 'validated'].includes(job.status) || !job.revision || !job.checks?.length || job.checks.some((c: any) => c.exitCode !== 0)) throw new DevelopmentError('development_not_validated', 'A versão ainda não possui validações aprovadas.', 409);
  if (job.revision !== ws.revision) throw new DevelopmentError('github_delivery_revision_changed', 'Outra versão já foi salva no workspace. Abra a execução mais recente antes de entregar.', 409);
  if (ws.source?.kind !== 'github') throw new DevelopmentError('github_origin_required', 'Este workspace não possui um repositório de origem. O ZIP integral está disponível.', 409);
  const connection = await GithubAppService.getProjectConnection(scope.userId, scope.tenantId, ws.projectId);
  if (`${connection.owner}/${connection.repository}`.toLowerCase() !== `${ws.source.owner}/${ws.source.repository}`.toLowerCase()) throw new DevelopmentError('github_source_mismatch', 'Selecione o mesmo repositório de origem do workspace.', 409);
  await GithubUserConnectionService.assertRepositoryAccess(scope, connection.owner, connection.repository, true);
  const installation = await GithubAppService.installationToken(connection.installationId);
  if (installation.permissions.contents !== 'write' || installation.permissions.pull_requests !== 'write') throw new DevelopmentError('github_write_permissions_missing', 'A instalação precisa de Contents:write e Pull requests:write.', 403);
  const api = `https://api.github.com/repos/${encodeURIComponent(connection.owner)}/${encodeURIComponent(connection.repository)}`;
  const request = async (relative: string, body?: unknown, method = body === undefined ? 'GET' : 'POST', optional = false) => {
    const result = await fetch(api + relative, { method, redirect: 'error', signal: AbortSignal.timeout(20_000), headers: {
      Authorization: `Bearer ${installation.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json', 'User-Agent': 'FrocIA-Development',
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (optional && result.status === 404) return null;
    if (!result.ok) throw new DevelopmentError('github_delivery_failed', `GitHub recusou a entrega (HTTP ${result.status}). Nenhum merge foi solicitado.`, result.status === 403 ? 403 : 502);
    return result.json();
  };
  const head = await request(`/git/ref/heads/${encodeURIComponent(ws.source.branch)}`);
  if (head.object?.sha !== ws.source.commitSha) throw new DevelopmentError('github_origin_changed', 'A branch de origem mudou. A entrega exige reconciliar a nova versão antes de criar outro commit.', 409);
  const before = readArchive(await getBlob(scope, ws.originalRevision)), after = readArchive(await getBlob(scope, job.revision));
  const changes = changesBetween(before, after);
  if (!changes.length || changes.some(change => protectedPath(change.path))) throw new DevelopmentError('github_delivery_changes_denied', 'Entrega sem diff ou com alteração de configuração protegida.', 409);
  const commit = await request(`/git/commits/${ws.source.commitSha}`);
  const entries: any[] = [];
  for (const change of changes) {
    const file = after.get(change.path);
    if (!file) entries.push({ path: change.path, mode: before.get(change.path)!.mode & 0o111 ? '100755' : '100644', type: 'blob', sha: null });
    else {
      const blob = await request('/git/blobs', { content: Buffer.from(file.bytes).toString('base64'), encoding: 'base64' });
      const expected = createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${file.bytes.length}\0`), Buffer.from(file.bytes)])).digest('hex');
      if (blob.sha !== expected) throw new DevelopmentError('github_blob_mismatch', 'O GitHub devolveu bytes diferentes dos validados.');
      entries.push({ path: change.path, mode: file.mode & 0o111 ? '100755' : '100644', type: 'blob', sha: blob.sha });
    }
  }
  const tree = await request('/git/trees', { base_tree: commit.tree.sha, tree: entries });
  const branch = `froc/development-${jobId.slice(7)}`;
  const oldRef = await request(`/git/ref/heads/${encodeURIComponent(branch)}`, undefined, 'GET', true);
  let commitSha: string;
  if (oldRef) {
    const existing = await request(`/git/commits/${oldRef.object.sha}`);
    if (existing.tree?.sha !== tree.sha || existing.parents?.length !== 1 || existing.parents[0].sha !== ws.source.commitSha) throw new DevelopmentError('github_branch_conflict', 'A branch já possui conteúdo diferente. Nenhuma sobrescrita foi executada.', 409);
    commitSha = oldRef.object.sha;
  } else {
    const created = await request('/git/commits', { message: 'fix: alterações validadas pela Froc.IA', tree: tree.sha, parents: [ws.source.commitSha] });
    commitSha = created.sha;
    await request('/git/refs', { ref: `refs/heads/${branch}`, sha: commitSha });
  }
  const existing = await request(`/pulls?state=open&head=${encodeURIComponent(connection.owner + ':' + branch)}&base=${encodeURIComponent(ws.source.branch)}`);
  const pull = existing[0] || await request('/pulls', { head: branch, base: ws.source.branch, draft: true,
    title: 'Alterações no projeto existente — Froc.IA', body: `Tarefa ${jobId}.\n\n${job.summary || ''}\n\nArquivos alterados:\n${changes.map(change => '- ' + change.path).join('\n')}\n\nValidações:\n${job.checks.map((c: any) => '- ' + c.command + ': exit ' + c.exitCode).join('\n')}\n\nExecutor: ${job.runUrl || 'consulte os recibos na plataforma'}.\nEntrega somente por PR; sem merge ou deploy automático.` });
  const expectedPrefix = `https://github.com/${connection.owner}/${connection.repository}/pull/`;
  if (typeof pull.html_url !== 'string' || !pull.html_url.startsWith(expectedPrefix)) throw new DevelopmentError('github_pull_request_unconfirmed', 'O endereço da PR não foi confirmado.');
  const receipt = { branch, commitSha, pullRequestUrl: pull.html_url, at: new Date().toISOString() };
  await ref.set({ githubDelivery: receipt }, { merge: true }); return receipt;
}
