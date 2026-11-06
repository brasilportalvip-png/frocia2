import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  ARTIFACT_CHUNK_CHARS,
  artifactExcerptsContext,
  memoryTruthPolicy,
  selectArtifactExcerpts,
  splitArtifactText,
} from '../server/ai/artifactChunks.js';

const repoImport = JSON.stringify({
  repository: 'dono/site',
  url: 'https://github.com/dono/site',
  defaultBranch: 'main',
  filesAvailable: 3,
  importCoverage: { complete: true },
  files: [{ path: 'package.json' }, { path: 'src/App.tsx' }, { path: 'src/services/audio.ts' }],
  importedFiles: [
    { path: 'package.json', content: '{"name":"site"}' },
    { path: 'src/App.tsx', content: 'export default function App() { return <Painel saldo={creditos} /> }' },
    { path: 'src/services/audio.ts', content: 'export function gravar() { return new MediaRecorder(stream) }' },
  ],
  readme: '# Site\nComo rodar.',
});

describe('Memória completa de anexos e repositórios', () => {
  it('repositório importado vira um trecho por arquivo, com o caminho como rótulo', () => {
    const chunks = splitArtifactText('github-repository.json', repoImport);
    const labels = chunks.map((c) => c.label);
    expect(labels).toContain('visão geral do repositório');
    expect(labels).toContain('src/App.tsx');
    expect(labels).toContain('src/services/audio.ts');
    expect(labels).toContain('README');
    expect(chunks.find((c) => c.label === 'src/App.tsx')!.content).toContain('<Painel saldo={creditos} />');
  });

  it('a pergunta seguinte que cita um arquivo recebe o CONTEÚDO dele (antes: só 6.000 caracteres do começo)', () => {
    const chunks = splitArtifactText('github-repository.json', repoImport);
    const picked = selectArtifactExcerpts(chunks, 'e no App.tsx, como aparece o saldo?');
    expect(picked.map((c) => c.label)).toContain('src/App.tsx');
    expect(picked.find((c) => c.label === 'src/App.tsx')!.content).toContain('creditos');
  });

  it('documento longo é guardado inteiro, em partes, e a parte certa volta para a pergunta', () => {
    const filler = 'Linha de texto comum sobre o contrato.\n'.repeat(Math.ceil((ARTIFACT_CHUNK_CHARS * 3) / 40));
    const text = `${filler}Cláusula 47: a multa rescisória é de 18 por cento.\n${filler}`;
    const chunks = splitArtifactText('contrato.pdf.txt', text);
    expect(chunks.length).toBeGreaterThan(4);
    expect(chunks.every((c) => c.content.length <= ARTIFACT_CHUNK_CHARS)).toBe(true);
    expect(chunks.map((c) => c.content).join('\n')).toContain('Cláusula 47');
    const picked = selectArtifactExcerpts(chunks, 'qual é a multa rescisória da cláusula 47?', 30_000);
    expect(picked.some((c) => c.content.includes('Cláusula 47: a multa rescisória'))).toBe(true);
    expect(picked.reduce((n, c) => n + c.content.length, 0)).toBeLessThanOrEqual(30_000);
  });

  it('sem pista na pergunta, entra o começo do documento, na ordem', () => {
    const chunks = splitArtifactText('notas.txt', 'a\n'.repeat(ARTIFACT_CHUNK_CHARS));
    const picked = selectArtifactExcerpts(chunks, 'oi', 30_000);
    expect(picked[0].index).toBe(0);
  });

  it('o contexto diz quantos trechos a IA está vendo e proíbe completar o resto', () => {
    const chunks = splitArtifactText('github-repository.json', repoImport);
    const context = artifactExcerptsContext('github-repository.json', chunks.slice(0, 2), chunks.length);
    expect(context).toContain(`2 de ${chunks.length} trecho(s)`);
    expect(context).toContain('não afirme o que há neles');
  });

  it('a memória de artefatos usa os trechos e marca a prévia antiga como "só o começo"', () => {
    const source = readFileSync('server/ai/artifactMemoryService.ts', 'utf8');
    expect(source).toContain("collection('chunks')");
    expect(source).toContain('attachExcerpts(relevant, input.prompt, currentTurn)');
    expect(source).toContain('SÓ O COMEÇO');
  });
});

describe('Regra de memória verdadeira', () => {
  it('vale para todos os modos e proíbe fingir que lembra', () => {
    const on = memoryTruthPolicy(true);
    expect(on).toContain('Nunca reconstrua de imaginação nem finja lembrar');
    expect(on).toContain('ATIVA');
    const off = memoryTruthPolicy(false);
    expect(off).toContain('DESLIGADA');
    const builder = readFileSync('server/ai/contextBuilder.ts', 'utf8');
    expect(builder).toContain('memoryTruthPolicy(Boolean(env.MEMORY_ENCRYPTION_KEY?.trim()))');
  });
});

describe('Verificador independente no chat', () => {
  it('roda na rota de streaming usada pela tela de chat, antes de mostrar a resposta', () => {
    const routes = readFileSync('server/routes/aiRoutes.ts', 'utf8');
    expect(routes).toContain('plan.classification.requiresIndependentVerification');
    expect(routes).toContain('IndependentResponseVerifier.verify({');
    expect(routes).toMatch(/verifyBeforeSending;\s*$/m);
  });
});
