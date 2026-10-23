import { createHash, randomUUID } from 'node:crypto';
import { adminDb, isFirebaseAdminConfigured } from '../lib/firebaseAdmin.js';
import type { PatchResult } from './codeAgentService.js';
import { EngineeringSandboxEvidenceService } from './engineeringSandboxEvidenceService.js';

const digest = (text: string) => createHash('sha256').update(text).digest('hex');
const CHUNK_SIZE = 100_000;

/** Conserva o patch ja certificado se GitHub, CI ou o processo precisarem retomar. */
export class CertifiedPatchCheckpointService {
  static async save(candidateId: string, patch: PatchResult): Promise<void> {
    if (!isFirebaseAdminConfigured()) throw new Error('Checkpoint do patch exige Firestore persistente.');
    if (!patch.success || !EngineeringSandboxEvidenceService.isCompleteEvidence(patch.executionEvidence, candidateId, patch.baseSha)) {
      throw new Error('Nao e permitido persistir um patch sem certificacao completa.');
    }
    const json = JSON.stringify(patch);
    if (json.length > 16 * 1024 * 1024) throw new Error('Checkpoint do patch excedeu o limite.');
    const root = adminDb.collection('self_evolution_patch_checkpoints').doc(candidateId);
    const generation = randomUUID();
    const parts = Math.ceil(json.length / CHUNK_SIZE);
    for (let offset = 0; offset < parts; offset += 20) {
      const batch = adminDb.batch();
      for (let part = offset; part < Math.min(parts, offset + 20); part++) {
        batch.set(root.collection(generation).doc(String(part)), { json: json.slice(part * CHUNK_SIZE, (part + 1) * CHUNK_SIZE) });
      }
      await batch.commit();
    }
    // O ponteiro so muda quando todas as partes foram gravadas.
    await root.set({ candidateId, generation, parts, sha256: digest(json), baseSha: patch.baseSha,
      certifiedAt: new Date().toISOString() });
  }

  static async load(candidateId: string): Promise<PatchResult | null> {
    if (!isFirebaseAdminConfigured()) throw new Error('Checkpoint do patch exige Firestore persistente.');
    const root = adminDb.collection('self_evolution_patch_checkpoints').doc(candidateId);
    const record = await root.get();
    if (!record.exists) return null;
    const data = record.data()!;
    if (data.candidateId !== candidateId || typeof data.generation !== 'string' ||
        !Number.isSafeInteger(data.parts) || data.parts < 1 || data.parts > 170) throw new Error('Manifesto do checkpoint invalido.');
    const refs = Array.from({ length: data.parts }, (_, part) => root.collection(data.generation).doc(String(part)));
    const chunks = await adminDb.getAll(...refs);
    if (chunks.some(doc => typeof doc.data()?.json !== 'string')) throw new Error('Checkpoint do patch incompleto.');
    const json = chunks.map(doc => doc.data()!.json).join('');
    if (digest(json) !== data.sha256) throw new Error('Hash do checkpoint do patch nao corresponde ao conteudo.');
    const patch = JSON.parse(json) as PatchResult;
    if (!patch.success || patch.baseSha !== data.baseSha ||
        !EngineeringSandboxEvidenceService.isCompleteEvidence(patch.executionEvidence, candidateId, patch.baseSha)) {
      throw new Error('Certificacao do checkpoint do patch invalida.');
    }
    return patch;
  }
}
