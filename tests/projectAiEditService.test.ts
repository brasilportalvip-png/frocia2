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

import { detectEnvVariables, exportEditedProject, parseReview } from '../server/services/projectAiEditService';
import { unzipSync } from 'fflate';

describe('revisão de qualidade', () => {
  it('só aprova quando approved=true e sem problemas', () => {
    expect(parseReview({ approved: true, issues: [] }).approved).toBe(true);
    expect(parseReview({ approved: true, issues: ['botão sem contraste'] }).approved).toBe(false);
    expect(parseReview({ approved: false, issues: ['x'] }).issues).toEqual(['x']);
    expect(parseReview(null).approved).toBe(false);
  });

  it('reprova uma tentativa, corrige e devolve a versão aprovada', async () => {
    const bad = '<html><body><h1>Ruim</h1></body></html>';
    const good = '<html><body><h1>Bom</h1></body></html>';
    const calls: string[] = [];
    const result = await editGithubProject(
      { url: 'https://github.com/dono/repo', instruction: 'mude o título' },
      async ({ system }) => {
        const isReview = system.includes('revisora de qualidade');
        calls.push(isReview ? 'review' : 'edit');
        if (isReview) {
          const reviewCount = calls.filter((c) => c === 'review').length;
          return JSON.stringify(reviewCount === 1 ? { approved: false, issues: ['título sem destaque'] } : { approved: true, issues: [] });
        }
        const editCount = calls.filter((c) => c === 'edit').length;
        return JSON.stringify({ explanation: 'ok', files: [{ path: 'index.html', content: editCount === 1 ? bad : good }] });
      },
    );
    expect(calls).toEqual(['edit', 'review', 'edit', 'review']);
    expect(result.html).toContain('Bom');
    expect(result.reviewNotes).toEqual([]);
  });

  it('se a revisão continuar reprovando na última tentativa, entrega com avisos', async () => {
    const result = await editGithubProject(
      { url: 'https://github.com/dono/repo', instruction: 'mude o título' },
      async ({ system }) =>
        system.includes('revisora de qualidade')
          ? JSON.stringify({ approved: false, issues: ['pouco contraste'] })
          : JSON.stringify({ explanation: 'ok', files: [{ path: 'index.html', content: '<html><body><h1>Teste</h1></body></html>' }] }),
    );
    expect(result.reviewNotes).toEqual(['pouco contraste']);
  });
});

describe('exportação do projeto', () => {
  it('detecta variáveis de ambiente sem valores', () => {
    const files = new Map<string, Uint8Array>([
      ['src/firebase.ts', enc('const k = import.meta.env.VITE_FIREBASE_API_KEY; const m = import.meta.env.MODE; const p = process.env.STRIPE_KEY;')],
    ]);
    expect(detectEnvVariables(files)).toEqual(['STRIPE_KEY', 'VITE_FIREBASE_API_KEY']);
  });

  it('gera o ZIP com as alterações aplicadas e .env.example', async () => {
    const exported = await exportEditedProject('https://github.com/dono/repo', { 'index.html': '<html><body>EDITADO</body></html>' });
    const files = unzipSync(exported.zip);
    expect(new TextDecoder().decode(files['index.html'])).toContain('EDITADO');
    expect(files['README.md']).toBeDefined();
    expect(exported.filename).toBe('repo-editado.zip');
  });
});
