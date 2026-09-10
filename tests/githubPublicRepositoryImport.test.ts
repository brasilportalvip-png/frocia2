import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ExternalImportService,
  parseGithubRepositoryUrl,
} from '../server/services/externalImportService.js';

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function encoded(content: string) {
  return {
    encoding: 'base64',
    content: Buffer.from(content, 'utf8').toString('base64'),
  };
}

describe('public GitHub repository import', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.GITHUB_TOKEN;
  });

  it('accepts only a canonical HTTPS owner/repository URL', () => {
    expect(
      parseGithubRepositoryUrl('https://github.com/openai/example.git')
    ).toEqual({
      owner: 'openai',
      repository: 'example',
      normalizedUrl: 'https://github.com/openai/example',
    });

    expect(() =>
      parseGithubRepositoryUrl('http://github.com/openai/example')
    ).toThrow(expect.objectContaining({ code: 'invalid_github_protocol' }));
    expect(() =>
      parseGithubRepositoryUrl('https://github.com/openai/example/issues')
    ).toThrow(expect.objectContaining({ code: 'invalid_repository_url' }));
  });

  it('reads bounded text files through api.github.com without OAuth', async () => {
    const packageSha = '1'.repeat(40);
    const sourceSha = '2'.repeat(40);
    const secretSha = '3'.repeat(40);
    const fetchMock = vi.fn(async (
      input: string | URL | Request,
      _init?: RequestInit
    ) => {
      const url = String(input);
      if (url.endsWith('/repos/openai/example')) {
        return jsonResponse({
          full_name: 'openai/example',
          description: 'Public example',
          default_branch: 'main',
          language: 'TypeScript',
          stargazers_count: 1,
          forks_count: 0,
          html_url: 'https://github.com/openai/example',
          private: false,
          archived: false,
          topics: [],
          license: { spdx_id: 'MIT' },
        });
      }
      if (url.includes('/git/trees/main')) {
        return jsonResponse({
          truncated: false,
          tree: [
            { path: 'package.json', type: 'blob', size: 35, sha: packageSha },
            { path: 'src/App.tsx', type: 'blob', size: 45, sha: sourceSha },
            { path: '.env.production', type: 'blob', size: 30, sha: secretSha },
            { path: 'public/logo.png', type: 'blob', size: 500, sha: '4'.repeat(40) },
          ],
        });
      }
      if (url.endsWith('/readme')) return jsonResponse(encoded('# Example'));
      if (url.endsWith(`/git/blobs/${packageSha}`)) {
        return jsonResponse(encoded('{"scripts":{"test":"vitest"}}'));
      }
      if (url.endsWith(`/git/blobs/${sourceSha}`)) {
        return jsonResponse(encoded('export const App = () => <main>OK</main>;'));
      }
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await ExternalImportService.import({
      type: 'github',
      url: 'https://github.com/openai/example',
    });
    const document = JSON.parse(result.content);

    expect(document.contentFilesReturned).toBe(2);
    expect(document.importedFiles).toEqual([
      expect.objectContaining({ path: 'package.json', content: expect.stringContaining('vitest') }),
      expect.objectContaining({ path: 'src/App.tsx', content: expect.stringContaining('<main>OK') }),
    ]);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes(secretSha))).toBe(false);
    expect(fetchMock.mock.calls.every(([, init]) => {
      const headers = (init as RequestInit).headers as Record<string, string>;
      return !headers.Authorization;
    })).toBe(true);
  });

  it('prioritizes root manifests when the repository exceeds the file-content limit', async () => {
    const packageSha = 'a'.repeat(40);
    const filler = Array.from({ length: 45 }, (_, index) => ({
      path: `docs/file-${String(index).padStart(2, '0')}.md`,
      type: 'blob',
      size: 10,
      sha: index.toString(16).padStart(40, '0'),
    }));
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/repos/openai/large')) {
        return jsonResponse({
          full_name: 'openai/large', description: null, default_branch: 'main',
          language: 'TypeScript', stargazers_count: 0, forks_count: 0,
          html_url: 'https://github.com/openai/large', private: false,
          archived: false, topics: [],
        });
      }
      if (url.includes('/git/trees/main')) {
        return jsonResponse({
          tree: [...filler, { path: 'package.json', type: 'blob', size: 60, sha: packageSha }],
        });
      }
      if (url.endsWith('/readme')) return jsonResponse({}, 404);
      if (url.endsWith(`/git/blobs/${packageSha}`)) {
        return jsonResponse(encoded('{"name":"critical-package"}'));
      }
      if (url.includes('/git/blobs/')) return jsonResponse(encoded('filler'));
      throw new Error(`unexpected request: ${url}`);
    }));

    const result = await ExternalImportService.import({
      type: 'github',
      url: 'https://github.com/openai/large',
    });
    const document = JSON.parse(result.content);

    expect(document.contentFilesReturned).toBe(40);
    expect(document.importedFiles[0]).toMatchObject({
      path: 'package.json',
      content: '{"name":"critical-package"}',
    });
  });

  it('does not return private keys found inside an otherwise eligible text file', async () => {
    const sha = 'a'.repeat(40);
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/repos/openai/leaked')) {
        return jsonResponse({
          full_name: 'openai/leaked', description: null, default_branch: 'main',
          language: null, stargazers_count: 0, forks_count: 0,
          html_url: 'https://github.com/openai/leaked', private: false,
          archived: false,
        });
      }
      if (url.includes('/git/trees/main')) {
        return jsonResponse({ tree: [{ path: 'config.txt', type: 'blob', size: 80, sha }] });
      }
      if (url.endsWith('/readme')) return jsonResponse({}, 404);
      if (url.endsWith(`/git/blobs/${sha}`)) {
        return jsonResponse(encoded('-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----'));
      }
      throw new Error(`unexpected request: ${url}`);
    }));

    const result = await ExternalImportService.import({
      type: 'github',
      url: 'https://github.com/openai/leaked',
    });

    expect(JSON.parse(result.content).importedFiles).toEqual([]);
    expect(result.content).not.toContain('BEGIN PRIVATE KEY');
  });

  it('reports an absent public repository honestly', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 404)));

    await expect(
      ExternalImportService.import({
        type: 'github',
        url: 'https://github.com/openai/missing',
      })
    ).rejects.toMatchObject({
      code: 'github_repository_not_found',
      status: 404,
    });
  });
});
