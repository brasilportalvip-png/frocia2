import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ deliveries: new Map<string, any>() }));
vi.mock('../server/lib/firebaseAdmin.js', () => ({ adminDb: { collection: (name: string) => ({ doc: (id: string) => ({
  get: async () => ({ data: () => state.deliveries.get(name + '/' + id) }),
  set: async (value: any) => state.deliveries.set(name + '/' + id, value),
}) }) } }));
vi.mock('../server/siteFactory/professionalMediaService.js', () => ({ generateFactoryMedia: vi.fn() }));
import { ProfessionalAdapters } from '../server/siteFactory/professionalAdapters.js';
import { sourceDigest } from '../server/siteFactory/professionalContract.js';
import { GithubAppService } from '../server/services/githubAppService.js';
import { GithubUserConnectionService } from '../server/services/githubUserConnectionService.js';
import { ProjectDeploymentService } from '../server/services/projectDeploymentService.js';
const base = 'a'.repeat(40), commit = 'b'.repeat(40), files = [{ path: 'index.html', content: '<html>Site criado</html>' }];
const connection = { owner: 'owner', repository: 'Repo.Case', installationId: 17, defaultBranch: 'main' } as any;
const build = () => ({ id: 'build-a', projectId: 'project-a', userId: 'user-a', tenantId: 'tenant-a',
  brief: { githubTarget: { owner: 'owner', repository: 'Repo.Case', installationId: 17 }, githubBaseSha: base },
  bundle: { title: 'Meu site' }, certificate: { status: 'passed', artifactDigest: sourceDigest(files) } }) as any;
beforeEach(() => {
  state.deliveries.clear();
  vi.spyOn(GithubAppService, 'getProjectConnection').mockResolvedValue(connection);
  vi.spyOn(GithubUserConnectionService, 'assertRepositoryAccess').mockResolvedValue({} as any);
  vi.spyOn(GithubAppService, 'sourceTree').mockResolvedValue({ commitSha: base, repositoryUrl: 'https://github.com/owner/Repo.Case' } as any);
  vi.spyOn(GithubAppService, 'installationToken').mockResolvedValue({ token: 'test-installation', expiresAt: '', permissions: { contents: 'write', pull_requests: 'write' } });
  vi.spyOn(ProjectDeploymentService, 'publishToGitHub').mockResolvedValue({ commitSha: commit, branch: 'froc/build-build-a', verified: true } as any);
  vi.spyOn(GithubAppService, 'createPullRequest').mockResolvedValue({ html_url: 'https://github.com/owner/Repo.Case/pull/1' });
});
afterEach(() => vi.restoreAllMocks());
describe('Entrega de código no destino GitHub escolhido', () => {
  it('usa a conexão do projeto, preserva o nome e não chama a Vercel', async () => {
    const vercel = vi.fn(); const adapter = new ProfessionalAdapters(undefined, vercel);
    const first = await adapter.publish(build(), files), second = await adapter.publish(build(), files);
    expect(first).toMatchObject({ status: 'ready', deliveryKind: 'github', commitSha: commit, pullRequestUrl: 'https://github.com/owner/Repo.Case/pull/1' });
    expect(second.url).toBe(first.url); expect(vercel).not.toHaveBeenCalled();
    expect(ProjectDeploymentService.publishToGitHub).toHaveBeenCalledTimes(1);
    expect(ProjectDeploymentService.publishToGitHub).toHaveBeenCalledWith(expect.objectContaining({ owner: 'owner', repoName: 'Repo.Case', token: 'test-installation', branch: 'froc/build-build-a' }));
  });
  it('interrompe sem escrever quando a base mudou durante a geração', async () => {
    vi.mocked(GithubAppService.sourceTree).mockResolvedValue({ commitSha: 'c'.repeat(40) } as any);
    await expect(new ProfessionalAdapters().publish(build(), files)).rejects.toMatchObject({ code: 'github_base_changed' });
    expect(ProjectDeploymentService.publishToGitHub).not.toHaveBeenCalled();
  });
  it('interrompe sem escrever quando o projeto foi reconectado a outro destino', async () => {
    vi.mocked(GithubAppService.getProjectConnection).mockResolvedValue({ ...connection, repository: 'other-repo' });
    await expect(new ProfessionalAdapters().publish(build(), files)).rejects.toMatchObject({ code: 'github_target_changed' });
    expect(ProjectDeploymentService.publishToGitHub).not.toHaveBeenCalled();
  });
});
