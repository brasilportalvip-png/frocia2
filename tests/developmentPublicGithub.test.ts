import { afterEach, describe, expect, it, vi } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { publicGithubArchive, publicRepository, fixedDownload } from '../server/development/publicGithub';
describe('Download público sem credenciais e com destinos fixos', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
  it.each(['http://github.com/a/b', 'https://github.com.evil/a/b', 'https://token@github.com/a/b', 'https://github.com/a/b?token=secret', 'https://127.0.0.1/a/b', 'https://github.com/a/b/../../api'])('recusa origem inválida: %s', url => expect(() => publicRepository(url)).toThrow());
  it('não segue redirecionamento para localhost e não envia token global', async () => {
    vi.stubEnv('GITHUB_TOKEN', 'do-not-use-this-for-public-import');
    const fetch = vi.fn(async (_url: any, options: any) => { expect(options.headers.Authorization).toBeUndefined(); return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/internal' } }); });
    vi.stubGlobal('fetch', fetch);
    await expect(fixedDownload(new URL('https://api.github.com/repos/a/b'), new Set(['api.github.com']), 1000)).rejects.toMatchObject({ code: 'download_host_denied' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('baixa o arquivo da versão fixada, sem depender do tamanho do último commit', async () => {
    const sha = 'a'.repeat(40), calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: any) => { const value = String(url); calls.push(value);
      if (value.endsWith('/repos/a/b')) return Response.json({ private: false, default_branch: 'main' });
      if (value.includes('/git/ref/heads/')) return Response.json({ object: { sha } });
      if (value.endsWith('/zipball/' + sha)) return new Response(zipSync({ 'root/main.ts': strToU8('source') }));
      throw new Error('unexpected_url');
    }));
    const result = await publicGithubArchive('https://github.com/a/b');
    expect(result.source.commitSha).toBe(sha); expect(calls).toHaveLength(3); expect(calls.every(url => !url.includes('/commits/'))).toBe(true);
  });
  it('recusa resposta comprimida que ultrapassa o limite antes de armazenar', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(1024), { headers: { 'content-length': '1024' } })));
    await expect(fixedDownload(new URL('https://api.github.com/repos/a/b'), new Set(['api.github.com']), 100)).rejects.toMatchObject({ code: 'download_size_limit' });
  });
});
