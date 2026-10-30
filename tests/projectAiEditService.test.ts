import { beforeEach, describe, expect, it, vi } from 'vitest';

const enc = (text: string) => new TextEncoder().encode(text);

vi.mock('../server/services/githubSiteImportService.js', async () => {
  const actual = await vi.importActual<typeof import('../server/services/githubSiteImportService.js')>('../server/services/githubSiteImportService.js');
  return {
    ...actual,
    loadGithubRepo: vi.fn(async () => ({
      files: {
        'repo-main/index.html': enc('<!doctype html><html><head><title>Original</title></head><body><h1>Caça Fantasmas</h1></body></html>'),
        'repo-main/README.md': enc('# demo'),
      },
      ctx: { owner: 'dono', repo: 'repo', branch: 'main' },
      repository: 'dono/repo',
      sourceUrl: 'https://github.com/dono/repo',
      branch: 'main',
      fullDownloadUrl: 'https://github.com/dono/repo/archive/refs/heads/main.zip',
    })),
  };
});

import {
  editGithubProject,
  isEditablePath,
  parseAiEdit,
  sanitizeOverrides,
} from '../server/services/projectAiEditService';

describe('segurança dos arquivos editáveis', () => {
  it('bloqueia .env, lockfiles, package.json e caminhos fora do projeto', () => {
    expect(isEditablePath('src/App.tsx')).toBe(true);
    expect(isEditablePath('index.html')).toBe(true);
    for (const bad of ['.env', 'src/.env.local', 'package.json', 'package-lock.json', '../x.ts', 'node_modules/a/b.js', 'vite.config.ts', 'foto.png']) {
      expect(isEditablePath(bad)).toBe(false);
    }
  });

  it('sanitizeOverrides descarta entradas inválidas', () => {
    expect(sanitizeOverrides({ 'src/App.tsx': 'ok', '.env': 'SEGREDO', 'package.json': '{}', 'src/a.ts': 5 })).toEqual({ 'src/App.tsx': 'ok' });
    expect(sanitizeOverrides(null)).toEqual({});
  });

  it('parseAiEdit exige arquivos permitidos', () => {
    expect(parseAiEdit({ explanation: 'ok', files: [{ path: 'src/App.tsx', content: 'x' }] }).files).toHaveLength(1);
    expect(() => parseAiEdit({ explanation: 'x', files: [{ path: '.env', content: 'K=1' }] })).toThrow();
    expect(() => parseAiEdit({ explanation: 'x', files: [] })).toThrow();
  });
});

describe('editGithubProject', () => {
  beforeEach(() => vi.clearAllMocks());

  it('aplica a alteração da IA, recompila e devolve as alterações acumuladas', async () => {
    const html = '<!doctype html><html><head><title>Original</title></head><body><h1>Caça Fantasmas SP</h1></body></html>';
    const result = await editGithubProject(
      { url: 'https://github.com/dono/repo', instruction: 'mude o título para Caça Fantasmas SP' },
      async () => JSON.stringify({ explanation: 'Título alterado.', files: [{ path: 'index.html', content: html }] }),
    );
    expect(result.html).toContain('Caça Fantasmas SP');
    expect(result.explanation).toBe('Título alterado.');
    expect(result.overrides['index.html']).toBe(html);
    expect(result.changedFiles).toEqual(['index.html']);
  });

  it('aceita resposta da IA dentro de bloco de código markdown', async () => {
    const result = await editGithubProject(
      { url: 'https://github.com/dono/repo', instruction: 'mude o título' },
      async () => '```json\n' + JSON.stringify({ explanation: 'ok', files: [{ path: 'index.html', content: '<html><body><h1>Novo</h1></body></html>' }] }) + '\n```',
    );
    expect(result.html).toContain('Novo');
  });

  it('recusa arquivo proibido sem aplicar nada', async () => {
    await expect(
      editGithubProject(
        { url: 'https://github.com/dono/repo', instruction: 'mude a chave' },
        async () => JSON.stringify({ explanation: 'x', files: [{ path: '.env', content: 'KEY=1' }] }),
      ),
    ).rejects.toThrow(/não permitido/);
  });
});
