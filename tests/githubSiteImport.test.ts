import { afterEach, describe, expect, it, vi } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { importGithubSite } from '../server/services/githubSiteImportService.js';

describe('importGithubSite', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('baixa o ZIP do repositório e devolve o site pronto com relatório', async () => {
    const zip = zipSync({
      'o-r-1/index.html': strToU8('<html><head><title>Meu Site</title><link rel="stylesheet" href="s.css"></head><body><img src="a.png"></body></html>'),
      'o-r-1/s.css': strToU8('body{color:blue}'),
      'o-r-1/a.png': new Uint8Array([1, 2]),
    });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/repos/o/r')) {
        return new Response(JSON.stringify({ default_branch: 'main', private: false, full_name: 'o/r' }), { status: 200 });
      }
      if (url.includes('/zipball/main')) return new Response(zip, { status: 200 });
      throw new Error(`unexpected ${url}`);
    }));
    const site = await importGithubSite('https://github.com/o/r');
    expect(site.title).toBe('Meu Site');
    expect(site.html).toContain('body{color:blue}');
    expect(site.report.complete).toBe(true);
    expect(site.fullDownloadUrl).toBe('https://github.com/o/r/archive/refs/heads/main.zip');
  });

  it('recusa repositório privado e repositório inexistente', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ private: true }), { status: 200 })));
    await expect(importGithubSite('https://github.com/o/r')).rejects.toMatchObject({ code: 'private_repository' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })));
    await expect(importGithubSite('https://github.com/o/r')).rejects.toMatchObject({ code: 'github_repository_not_found' });
  });
});
