import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PatchResult } from '../server/selfEvolution/codeAgentService.js';
import { REQUIRED_ENGINEERING_COMMANDS } from '../server/selfEvolution/engineeringSandboxEvidenceService.js';

const fixture = vi.hoisted(() => {
  const records = new Map<string, any>();
  const snapshot = (p: string) => ({ exists: records.has(p), data: () => records.get(p) });
  const doc = (p: string): any => ({ path: p, get: async () => snapshot(p), set: async (v: any) => records.set(p, v),
    collection: (name: string) => ({ doc: (id: string) => doc(`${p}/${name}/${id}`) }) });
  let failBatch = false;
  const db = { collection: (name: string) => ({ doc: (id: string) => doc(`${name}/${id}`) }),
    getAll: async (...refs: any[]) => refs.map(ref => snapshot(ref.path)),
    batch: () => {
      const updates: any[] = [];
      return { set: (ref: any, value: any) => updates.push([ref.path, value]), commit: async () => {
        if (failBatch) { failBatch = false; throw new Error('fixture_write_failed'); }
        for (const [p, value] of updates) records.set(p, value);
      } };
    } };
  return { records, db, failNextBatch: () => { failBatch = true; } };
});
vi.mock('../server/lib/firebaseAdmin.js', () => ({ adminDb: fixture.db, isFirebaseAdminConfigured: () => true }));
import { CertifiedPatchCheckpointService } from '../server/selfEvolution/certifiedPatchCheckpointService.js';
function patch(): PatchResult {
  return { status: 'success', success: true, baseSha: 'a'.repeat(40), filesModified: ['src/fix.ts'],
    files: [{ path: 'src/fix.ts', content: 'x'.repeat(250_000) }], linesAdded: 1, linesRemoved: 0,
    executionEvidence: { schemaVersion: 'engineering-sandbox-v1', candidateId: 'candidate', baseSha: 'a'.repeat(40), networkPolicy: 'restricted', rollbackVerified: true,
      commands: REQUIRED_ENGINEERING_COMMANDS.map(id => ({ id, exitCode: 0 })) } as any };
}
describe('Checkpoint do patch certificado', () => {
  beforeEach(() => fixture.records.clear());
  it('conserva o patch completo em partes menores que um documento Firestore', async () => {
    const original = patch();
    await CertifiedPatchCheckpointService.save('candidate', original);
    expect(fixture.records.size).toBeGreaterThan(3);
    expect(await CertifiedPatchCheckpointService.load('candidate')).toEqual(original);
  });
  it('recusa partes ausentes e conteudo alterado', async () => {
    await CertifiedPatchCheckpointService.save('candidate', patch());
    const part = [...fixture.records.keys()].find(key => key.endsWith('/0'))!;
    fixture.records.get(part).json += 'alterado';
    await expect(CertifiedPatchCheckpointService.load('candidate')).rejects.toThrow('Hash');
    fixture.records.delete(part);
    await expect(CertifiedPatchCheckpointService.load('candidate')).rejects.toThrow('incompleto');
  });
  it('preserva o ponteiro anterior quando uma gravacao intermediaria falha', async () => {
    const original = patch(); await CertifiedPatchCheckpointService.save('candidate', original);
    fixture.failNextBatch();
    await expect(CertifiedPatchCheckpointService.save('candidate', { ...original, linesAdded: 5 })).rejects.toThrow('fixture_write_failed');
    expect(await CertifiedPatchCheckpointService.load('candidate')).toEqual(original);
  });
  it('nao grava patch reprovado ou de outro candidato', async () => {
    await expect(CertifiedPatchCheckpointService.save('candidate', { ...patch(), success: false })).rejects.toThrow('certificacao');
    await expect(CertifiedPatchCheckpointService.save('other', patch())).rejects.toThrow('certificacao');
    expect(fixture.records.size).toBe(0);
  });
});
