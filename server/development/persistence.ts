import { adminDb, isFirebaseAdminConfigured } from '../lib/firebaseAdmin.js';
import { DevelopmentError, LIMITS, sha256 } from './archive.js';
export type DevelopmentScope = { userId: string; tenantId: string };
export const scopeKey = (scope: DevelopmentScope) => sha256(JSON.stringify([scope.tenantId, scope.userId]));
export const db = () => {
  if (!isFirebaseAdminConfigured()) throw new DevelopmentError('development_database_unavailable', 'Banco de projetos indisponível. Nenhum executor foi iniciado.', 503);
  return adminDb;
};
export async function owned(collection: string, id: string, scope: DevelopmentScope) {
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(id)) throw new DevelopmentError('development_not_found', 'Projeto ou execução não encontrado.', 404);
  const ref = db().collection(collection).doc(id), snapshot = await ref.get(), data = snapshot.data();
  if (!snapshot.exists || data?.userId !== scope.userId || data?.tenantId !== scope.tenantId) throw new DevelopmentError('development_not_found', 'Projeto ou execução não encontrado.', 404);
  return { ref, data };
}

/** Source archives never enter the model context. Firestore chunks also work without a new storage service. */
export async function putBlob(scope: DevelopmentScope, bytes: Uint8Array) {
  if (bytes.length > LIMITS.archive) throw new DevelopmentError('artifact_too_large', 'O artefato ultrapassa 50 MiB.', 413);
  const digest = sha256(bytes), id = sha256(`${scopeKey(scope)}:${digest}`), reference = db().collection('development_blobs').doc(id);
  const quota = db().collection('development_quotas').doc(scopeKey(scope));
  const chunkSize = 384 * 1024, chunks = Math.ceil(bytes.length / chunkSize);
  const created = await db().runTransaction(async tx => {
    const prior = await tx.get(reference), usage = await tx.get(quota);
    if (prior.exists) return false;
    const used = Number(usage.data()?.bytes || 0);
    if (used + bytes.length > 250 * 1024 * 1024) throw new DevelopmentError('workspace_storage_quota', 'Quota de 250 MiB de arquivos persistidos atingida para esta conta.', 413);
    tx.set(reference, { ...scope, digest, size: bytes.length, chunks, ready: false, createdAt: new Date().toISOString() });
    tx.set(quota, { ...scope, bytes: used + bytes.length }, { merge: true });
    return true;
  });
  if (created || !(await reference.get()).data()?.ready) {
    // Content-addressed parts make retries deterministic even after interrupted uploads.
    for (let start = 0; start < chunks; start += 40) {
      const batch = db().batch();
      for (let i = start; i < Math.min(chunks, start + 40); i++) batch.set(db().collection('development_blob_chunks').doc(`${id}-${i}`), {
        data: Buffer.from(bytes.subarray(i * chunkSize, (i + 1) * chunkSize)).toString('base64'), digest, index: i,
      });
      await batch.commit();
    }
    await reference.set({ ready: true }, { merge: true });
  }
  return id;
}
export async function getBlob(scope: DevelopmentScope, id: string) {
  const { data } = await owned('development_blobs', id, scope);
  if (!data.ready || data.size > LIMITS.archive || data.chunks > 135) throw new DevelopmentError('artifact_incomplete', 'Artefato ainda não foi confirmado integralmente.', 409);
  const parts: Buffer[] = [];
  for (let i = 0; i < data.chunks; i++) {
    const chunk = (await db().collection('development_blob_chunks').doc(`${id}-${i}`).get()).data();
    if (chunk?.index !== i || chunk.digest !== data.digest) throw new DevelopmentError('artifact_corrupted', 'Parte do artefato indisponível.', 409);
    parts.push(Buffer.from(chunk.data, 'base64'));
  }
  const bytes = Buffer.concat(parts);
  if (bytes.length !== data.size || sha256(bytes) !== data.digest) throw new DevelopmentError('artifact_corrupted', 'Checksum do artefato diverge do registro persistido.', 409);
  return bytes;
}
