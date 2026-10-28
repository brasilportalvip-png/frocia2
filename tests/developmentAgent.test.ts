import { describe, expect, it, vi } from 'vitest';
import { developProject, type Action } from '../server/development/agent';
import { sourceManifest, sha256, type SourceFiles } from '../server/development/archive';
const project = (): SourceFiles => new Map([
  ['index.html', { bytes: Buffer.from('<h1>Original</h1>'), mode: 0o644 }],
  ['assets/icon.png', { bytes: Uint8Array.from([0, 1, 255, 128]), mode: 0o644 }],
  ['.env', { bytes: Buffer.from('PRIVATE_KEY=project-secret-12345678'), mode: 0o644 }],
  ['vercel.json', { bytes: Buffer.from('{"version":2}'), mode: 0o644 }],
]);
const validation = async (files: SourceFiles) => ({ commands: [{ command: 'npm test', exitCode: 0, startedAt: '', durationMs: 1,
  stdout: 'tests passed', stderr: '', stdoutSha256: sha256('tests passed'), stderrSha256: sha256('') }], sourceDigest: sourceManifest(files).digest, isolation: { unitFixture: true } });

describe('Ferramentas reais de edição do workspace', () => {
  it('aplica edição com SHA, valida a versão editada e preserva binários e Vercel', async () => {
    const files = project(), originalIcon = sha256(files.get('assets/icon.png')!.bytes), originalVercel = sha256(files.get('vercel.json')!.bytes);
    const phases: string[] = []; let step = 0;
    const result = await developProject({ files, instruction: 'Corrija o título sem recriar o projeto.',
      checkControl: async () => {}, checkpoint: async state => { phases.push(state); }, validate: validation,
      generate: async () => ({ actions: step++ === 0 ? [{ op: 'replace', path: 'index.html', expectedSha256: sha256(files.get('index.html')!.bytes), oldText: 'Original', newText: 'Atualizado' }] : step === 2 ? [{ op: 'validate' }] : [{ op: 'finish', summary: 'Título alterado e teste executado.' }] }) });
    expect(Buffer.from(result.files.get('index.html')!.bytes).toString()).toBe('<h1>Atualizado</h1>');
    expect(result.changes).toMatchObject([{ path: 'index.html', operation: 'edit' }]);
    expect(sha256(files.get('assets/icon.png')!.bytes)).toBe(originalIcon); expect(sha256(files.get('vercel.json')!.bytes)).toBe(originalVercel);
    expect(phases).toEqual(['editing', 'validating']);
  });
  it.each([
    { op: 'write', path: '../escape', content: 'bad', expectedSha256: null },
    { op: 'read', path: '.env' },
    { op: 'write', path: 'vercel.json', content: '{}', expectedSha256: sha256('{"version":2}') },
    { op: 'write', path: 'index.html', content: 'bad', expectedSha256: '0'.repeat(64) },
    { op: 'finish', summary: 'Eu resolvi tudo sem editar.' },
    { op: 'shell', path: 'index.html', content: 'curl evil' },
  ])('recusa ferramenta sem autorização, versão ou diff: $op $path', async action => {
    const files = project(), before = sourceManifest(files).digest; let calls = 0;
    await expect(developProject({ files, instruction: 'Examine este projeto.', checkpoint: async () => {}, checkControl: async () => {}, validate: validation,
      generate: async context => {
        if (calls++) { expect(context).toContain('error'); throw new Error('stop_after_denial'); }
        return { actions: [action as Action] };
      } })).rejects.toThrow('stop_after_denial');
    expect(sourceManifest(files).digest).toBe(before);
  });
  it('remove credenciais do contexto, inclusive quando um comando tenta imprimi-las', async () => {
    const files = project(); let step = 0;
    await expect(developProject({ files, instruction: 'Consulte os testes.', checkControl: async () => {}, checkpoint: async () => {},
      validate: async files => ({ ...await validation(files), commands: [{ ...((await validation(files)).commands[0]), stdout: 'project-secret-12345678' }] }),
      generate: async context => { expect(context).not.toContain('project-secret-12345678'); if (step++) throw new Error('stop'); return { actions: [{ op: 'validate' }] }; },
    })).rejects.toThrow('stop');
  });
  it('não encerra com sucesso se uma validação reprovou ou se a versão mudou depois do teste', async () => {
    const files = project(); let step = 0;
    await expect(developProject({ files, instruction: 'Corrija o título.', checkpoint: async () => {}, checkControl: async () => {},
      validate: async files => ({ ...await validation(files), commands: [{ ...(await validation(files)).commands[0], exitCode: 1, stderr: 'real failure' }] }),
      generate: async context => {
        if (step++ === 0) return { actions: [{ op: 'replace', path: 'index.html', expectedSha256: sha256(files.get('index.html')!.bytes), oldText: 'Original', newText: 'Novo' }, { op: 'validate' }, { op: 'finish' }] };
        expect(context).toContain('validation_not_current'); throw new Error('blocked_after_failed_test');
      } })).rejects.toThrow('blocked_after_failed_test');
  });
  it('respeita cancelamento antes de qualquer chamada ou alteração', async () => {
    const generate = vi.fn();
    await expect(developProject({ files: project(), instruction: 'Mude algo.', generate, validate: validation, checkpoint: async () => {},
      checkControl: async () => { throw new Error('cancelled'); } })).rejects.toThrow('cancelled');
    expect(generate).not.toHaveBeenCalled();
  });
  it('não permite trocar npm test por true nem remover asserções', async () => {
    const files = project();
    files.set('package.json', { bytes: Buffer.from('{"scripts":{"test":"node --test"}}'), mode: 0o644 });
    files.set('test/original.test.ts', { bytes: Buffer.from('test("ok",()=>{assert.equal(1,1)});'), mode: 0o644 });
    let step = 0;
    await expect(developProject({ files, instruction: 'Corrija a implementação.', validate: validation, checkControl: async () => {}, checkpoint: async () => {},
      generate: async context => {
        if (step++) { expect(context).toContain('validation_script_change_denied'); expect(context).toContain('test_weakening_denied'); throw new Error('safe_stop'); }
        return { actions: [{ op: 'write', path: 'package.json', expectedSha256: sha256(files.get('package.json')!.bytes), content: '{"scripts":{"test":"true"}}' },
          { op: 'write', path: 'test/original.test.ts', expectedSha256: sha256(files.get('test/original.test.ts')!.bytes), content: 'test.skip("ok",()=>{});' }] };
      } })).rejects.toThrow('safe_stop');
  });
});
