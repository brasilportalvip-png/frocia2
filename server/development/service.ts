import { randomUUID } from 'node:crypto';
import { DevelopmentError, LIMITS, readArchive, writeArchive, sourceManifest, sha256, safePath, secretPath, type SourceFiles } from './archive.js';
import { publicGithubArchive, publicRepository } from './publicGithub.js';
import { db, owned, putBlob, getBlob, scopeKey, type DevelopmentScope } from './persistence.js';
import { GithubAutomationService } from '../selfEvolution/githubAutomationService.js';
import { CreditWalletService } from '../services/creditWalletService.js';
import { RedactionService } from '../selfEvolution/redactionService.js';

const now = () => new Date().toISOString();
export class DevelopmentService {
  static async workspace(scope: DevelopmentScope, id: string) { return (await owned('development_workspaces', id, scope)).data; }
  static async importGithub(scope: DevelopmentScope, url: string) {
    const repo = publicRepository(url), id = 'workspace-' + sha256(`${scopeKey(scope)}:${repo.owner.toLowerCase()}/${repo.repository.toLowerCase()}`).slice(0, 40);
    const ref = db().collection('development_workspaces').doc(id);
    const prior = (await ref.get()).data();
    if (prior?.revision) return this.workspace(scope, id);
    const lease = randomUUID();
    await db().runTransaction(async tx => {
      const old = (await tx.get(ref)).data();
      if (old?.userId && (old.userId !== scope.userId || old.tenantId !== scope.tenantId)) throw new DevelopmentError('development_not_found', 'Projeto não encontrado.', 404);
      if (old?.importLeaseUntil > Date.now()) throw new DevelopmentError('import_in_progress', 'A importação desse projeto já está em andamento. Abra o projeto para acompanhar.', 409);
      tx.set(ref, { ...scope, id, projectId: id, title: repo.repository, status: 'importing', importLease: lease, importLeaseUntil: Date.now() + 90_000, updatedAt: now() }, { merge: true });
    });
    try {
      const imported = await publicGithubArchive(url), files = readArchive(imported.archive, true);
      if ([...files.values()].some(file => Buffer.from(file.bytes.subarray(0, 100)).toString().startsWith('version https://git-lfs.github.com/spec/v1'))) {
        throw new DevelopmentError('git_lfs_unresolved', 'O repositório usa ponteiros Git LFS. A importação integral requer resolver esses objetos; não foi marcada como concluída.');
      }
      if (files.has('.gitmodules')) throw new DevelopmentError('git_submodules_unresolved', 'O projeto usa submódulos. A resolução integral ainda não está disponível; não foi criado um workspace parcial.');
      const manifest = sourceManifest(files), archive = writeArchive(files), revision = await putBlob(scope, archive);
      await db().runTransaction(async tx => {
        const current = await tx.get(ref);
        if (current.data()?.importLease !== lease) throw new DevelopmentError('import_lease_expired', 'A importação perdeu a exclusividade; tente retomá-la.', 409);
        tx.set(ref, { ...scope, id, projectId: id, title: repo.repository, source: imported.source, revision, originalRevision: revision,
          digest: manifest.digest, fileCount: manifest.fileCount, bytes: manifest.bytes, status: 'imported', paused: false,
          importLeaseUntil: 0, importLease: null, createdAt: now(), updatedAt: now() });
        tx.set(db().collection('projects').doc(id), { ...scope, id, workspaceId: id, title: repo.repository, html: '', sourceKind: 'workspace',
          sourceState: 'imported', sourceRepository: `${repo.owner}/${repo.repository}`, sourceCommitSha: imported.source.commitSha, updatedAt: now(), createdAt: now() }, { merge: true });
      });
      return this.workspace(scope, id);
    } catch (error) {
      await db().runTransaction(async tx => {
        const current = await tx.get(ref);
        if (current.data()?.importLease === lease) tx.set(ref, { status: 'blocked', importLeaseUntil: 0,
          error: error instanceof DevelopmentError ? error.message : 'Falha no download integral. Tente retomar a importação.', updatedAt: now() }, { merge: true });
      });
      throw error;
    }
  }
  static async importZip(scope: DevelopmentScope, archive: Uint8Array, name: string) {
    let files = readArchive(archive);
    const first = files.keys().next().value!, prefix = first.includes('/') ? first.slice(0, first.indexOf('/') + 1) : '';
    const rootPrefix = !files.has('package.json') && !files.has('index.html') && prefix && [...files.keys()].every(p => p.startsWith(prefix)) &&
      (files.has(prefix + 'package.json') || files.has(prefix + 'index.html')) ? prefix : '';
    if (rootPrefix) files = new Map([...files].map(([p, file]) => [p.slice(rootPrefix.length), file]));
    const manifest = sourceManifest(files), revision = await putBlob(scope, writeArchive(files));
    const id = 'workspace-' + sha256(`${scopeKey(scope)}:zip:${manifest.digest}`).slice(0, 40), ref = db().collection('development_workspaces').doc(id);
    const prior = (await ref.get()).data(); if (prior?.revision) return this.workspace(scope, id);
    const title = name.replace(/\.zip$/i, '').replace(/[<>\x00-\x1f]/g, '').slice(0, 100) || 'Projeto importado';
    await ref.set({ ...scope, id, projectId: id, title, source: { kind: 'zip', filename: name.slice(0, 120), rootPrefix }, revision, originalRevision: revision,
      digest: manifest.digest, fileCount: manifest.fileCount, bytes: manifest.bytes, status: 'imported', paused: false, createdAt: now(), updatedAt: now() });
    await db().collection('projects').doc(id).set({ ...scope, id, workspaceId: id, title, html: '', sourceKind: 'workspace', sourceState: 'imported', createdAt: now(), updatedAt: now() }, { merge: true });
    return this.workspace(scope, id);
  }
  static async importSaved(scope: DevelopmentScope, projectId: string) {
    const { data } = await owned('projects', projectId, scope);
    if (data.workspaceId) return this.workspace(scope, data.workspaceId);
    if (data.sourceRepository || data.githubRepositoryFullName) return this.importGithub(scope, `https://github.com/${data.sourceRepository || data.githubRepositoryFullName}`);
    let files: SourceFiles;
    if (data.professionalBuildId) {
      const { getProfessionalFactory } = await import('../siteFactory/professionalRuntime.js');
      const factory = getProfessionalFactory(), build = await factory.get(data.professionalBuildId, { ...scope, projectId });
      files = new Map(factory.files(build).files.map(file => [file.path, { bytes: Buffer.from(file.content), mode: 0o644 }]));
    } else if (typeof data.html === 'string' && data.html.trim()) files = new Map([['index.html', { bytes: Buffer.from(data.html), mode: 0o644 }]]);
    else throw new DevelopmentError('saved_source_unavailable', 'Este registro não contém código-fonte integral. Importe a origem original do projeto.', 409);
    return this.importZip(scope, writeArchive(files), String(data.title || 'Projeto salvo') + '.zip');
  }
  static async source(scope: DevelopmentScope, id: string, revision?: string) {
    const ws = await this.workspace(scope, id);
    if (!ws.revision) throw new DevelopmentError('import_not_ready', 'A importação integral ainda não terminou.', 409);
    if (revision && revision !== ws.revision && revision !== ws.originalRevision) throw new DevelopmentError('revision_not_authorized', 'Versão não pertence ao projeto.', 404);
    return readArchive(await getBlob(scope, revision || ws.revision));
  }
  static async manifest(scope: DevelopmentScope, id: string) { return sourceManifest(await this.source(scope, id)); }
  static async file(scope: DevelopmentScope, id: string, path: string) {
    safePath(path); if (secretPath(path)) throw new DevelopmentError('secret_content_protected', 'Credenciais são preservadas no arquivo privado e não são expostas ao agente.', 403);
    const file = (await this.source(scope, id)).get(path); if (!file) throw new DevelopmentError('file_not_found', 'Arquivo não encontrado.', 404);
    if (file.bytes.length > 512_000) throw new DevelopmentError('file_read_limit', 'Arquivo grande. Use o ZIP integral para consultá-lo.', 413);
    return { path, data: Buffer.from(file.bytes).toString('base64'), sha256: sha256(file.bytes), size: file.bytes.length };
  }
  static async job(scope: DevelopmentScope, id: string) {
    const { ref, data } = await owned('development_jobs', id, scope);
    if (data.reservationId && ['ready', 'validated', 'cancelled'].includes(data.status)) {
      await CreditWalletService.confirmConsumption({ userId: scope.userId, reservationId: data.reservationId,
        amountConsumed: Math.max(0, Number(data.consumedCredits || 0) - Number(data.reservationBaseCredits || 0)),
        operation: 'project_development', idempotencyKey: `${id}:settled:${data.reservationId}` });
      await db().runTransaction(async tx => { const current = (await tx.get(ref)).data();
        if (current?.reservationId === data.reservationId) tx.set(ref, { reservationId: null, reservationAttempt: Number(current.reservationAttempt || 0) + 1 }, { merge: true });
      });
      return (await ref.get()).data();
    }
    return data;
  }
  static async requestJob(scope: DevelopmentScope, workspaceId: string, instruction: string, idempotencyKey: string, authorizedCredits: number) {
    const ws = await this.workspace(scope, workspaceId);
    if (!ws.revision) throw new DevelopmentError('import_not_ready', 'Aguarde a importação integral antes de solicitar alterações.', 409);
    const clean = RedactionService.redactSensitiveData(instruction).trim();
    if (!clean || clean.length > 40_000 || authorizedCredits < 1 || authorizedCredits > 50) throw new DevelopmentError('development_budget_required', 'Confirme uma instrução e o limite de créditos antes da execução.');
    const id = 'devjob-' + sha256(`${scopeKey(scope)}:${workspaceId}:${idempotencyKey}`).slice(0, 40), ref = db().collection('development_jobs').doc(id);
    const instructionHash = sha256(clean);
    await db().runTransaction(async tx => {
      const prior = await tx.get(ref), current = await tx.get(db().collection('development_workspaces').doc(workspaceId));
      if (prior.exists) { if (prior.data()?.instructionHash !== instructionHash) throw new DevelopmentError('development_idempotency_conflict', 'A chave já foi usada para outra instrução.', 409); return; }
      if (current.data()?.activeJobId) throw new DevelopmentError('workspace_busy', 'Este projeto já possui uma execução ativa. Cancele ou retome essa execução.', 409);
      tx.set(ref, { ...scope, id, workspaceId, projectId: workspaceId, status: 'awaiting_dispatch', instruction: clean, instructionHash,
        baseRevision: current.data()!.revision, authorizedCredits, consumedCredits: 0, leaseUntil: 0, steps: 0,
        events: [{ state: 'persisted', at: now(), message: 'Pedido persistido; nenhum comando executado.' }], createdAt: now(), updatedAt: now() });
      tx.set(db().collection('development_workspaces').doc(workspaceId), { activeJobId: id, lastJobId: id }, { merge: true });
    });
    const current = await this.job(scope, id);
    if (current.dispatchAccepted || ['ready', 'validated', 'cancelled', 'running', 'editing', 'validating'].includes(current.status)) return current;
    return this.resumeJob(scope, id);
  }
  static async resumeJob(scope: DevelopmentScope, id: string) {
    const { ref, data: job } = await owned('development_jobs', id, scope), ws = await this.workspace(scope, job.workspaceId);
    if (['ready', 'validated', 'cancelled'].includes(job.status)) return job;
    if (job.status === 'awaiting_runner' && job.dispatchAccepted && Date.now() - Date.parse(job.dispatchReceipt?.at || '') < 600_000) return job;
    if (job.leaseUntil > Date.now()) throw new DevelopmentError('development_already_running', 'A execução já está em andamento.', 409);
    const system = (await db().collection('development_config').doc('system').get()).data();
    if (ws.paused || system?.enabled === false) { await ref.set({ status: 'paused', diagnostic: 'Pedido preservado; execução pausada pelo controle persistente.' }, { merge: true }); return this.job(scope, id); }
    const accepted = await db().runTransaction(async tx => {
      const current = (await tx.get(ref)).data();
      if (current?.dispatchLeaseUntil > Date.now()) return false;
      tx.set(ref, { dispatchLeaseUntil: Date.now() + 120_000 }, { merge: true }); return true;
    });
    if (!accepted) return this.job(scope, id);
    try {
      const remaining = job.authorizedCredits - Number(job.consumedCredits || 0);
      if (remaining < 1) throw new DevelopmentError('development_credit_limit', 'O limite autorizado foi atingido. O projeto foi preservado para uma nova tarefa.', 409);
      const attempt = Number(job.reservationAttempt || 0);
      const reservation = await CreditWalletService.reserveCredits({ userId: scope.userId, amount: remaining, operation: 'project_development', idempotencyKey: `${id}:reserve:${attempt}` });
      await ref.set({ reservationId: reservation.reservationId, reservationBaseCredits: Number(job.consumedCredits || 0), cancelRequested: false }, { merge: true });
      const dispatch = await GithubAutomationService.dispatchDevelopmentJob(id);
      if (!dispatch.success) {
        await CreditWalletService.confirmConsumption({ userId: scope.userId, reservationId: reservation.reservationId, amountConsumed: 0,
          operation: 'project_development', idempotencyKey: `${id}:settled:${reservation.reservationId}` });
      }
      await ref.set({ status: dispatch.success ? 'awaiting_runner' : 'blocked', dispatchAccepted: dispatch.success,
        ...(!dispatch.success ? { reservationId: null, reservationAttempt: attempt + 1 } : {}),
        dispatchReceipt: { ...dispatch, at: now() }, diagnostic: dispatch.message, updatedAt: now() }, { merge: true });
    } catch (error) {
      await ref.set({ status: 'blocked', diagnostic: error instanceof Error ? error.message.slice(0, 500) : 'Reserva ou dispatch não confirmado.' }, { merge: true });
      throw error;
    } finally { await ref.set({ dispatchLeaseUntil: 0 }, { merge: true }); }
    return this.job(scope, id);
  }
  static async cancel(scope: DevelopmentScope, id: string) {
    const { ref, data } = await owned('development_jobs', id, scope);
    if (['ready', 'cancelled'].includes(data.status)) return data;
    await ref.set({ cancelRequested: true, status: 'cancelling', updatedAt: now() }, { merge: true });
    if (!data.leaseUntil || data.leaseUntil < Date.now()) await this.finishCancellation(scope, id);
    return this.job(scope, id);
  }
  static async finishCancellation(scope: DevelopmentScope, id: string) {
    const { ref, data } = await owned('development_jobs', id, scope);
    if (data.reservationId) await CreditWalletService.confirmConsumption({ userId: scope.userId, reservationId: data.reservationId,
      amountConsumed: Math.max(0, Number(data.consumedCredits || 0) - Number(data.reservationBaseCredits || 0)), operation: 'project_development', idempotencyKey: `${id}:settled:${data.reservationId}` });
    await ref.set({ status: 'cancelled', leaseUntil: 0, reservationId: null, updatedAt: now() }, { merge: true });
    await db().collection('development_workspaces').doc(data.workspaceId).set({ activeJobId: null }, { merge: true });
  }
  static async pause(scope: DevelopmentScope, id: string, paused: boolean) {
    const { ref } = await owned('development_workspaces', id, scope); await ref.set({ paused, updatedAt: now() }, { merge: true });
    return this.workspace(scope, id);
  }
  static async createUpload(scope: DevelopmentScope, name: string, size: number, digest: string) {
    if (size < 1 || size > LIMITS.archive || !/^[a-f0-9]{64}$/.test(digest)) throw new DevelopmentError('upload_size_limit', 'ZIP inválido ou maior que 50 MiB.', 413);
    const id = 'upload-' + sha256(`${scopeKey(scope)}:${digest}`).slice(0, 40);
    const obsolete = await db().runTransaction(async tx => {
      const quota = db().collection('development_quotas').doc(scopeKey(scope)), current = (await tx.get(quota)).data();
      if (current?.uploadId && current.uploadId !== id && current.uploadUntil > Date.now()) throw new DevelopmentError('upload_quota', 'Há um ZIP em transferência nesta conta. Conclua esse envio antes de iniciar outro.', 409);
      if (Number(current?.bytes || 0) + size > 250 * 1024 * 1024) throw new DevelopmentError('workspace_storage_quota', 'Quota de armazenamento insuficiente para este ZIP.', 413);
      tx.set(quota, { ...scope, uploadId: id, uploadUntil: Date.now() + 3600_000 }, { merge: true });
      tx.set(db().collection('development_uploads').doc(id), { ...scope, id, name: name.slice(0, 120), size, digest, expiresAt: Date.now() + 3600_000, parts: Math.ceil(size / (384 * 1024)) });
      return current?.uploadId && current.uploadId !== id ? current.uploadId as string : null;
    });
    if (obsolete) {
      const previous = (await owned('development_uploads', obsolete, scope)).data;
      const batch = db().batch(); for (let i = 0; i < Math.min(previous.parts, 135); i++) batch.delete(db().collection('development_upload_parts').doc(`${obsolete}-${i}`));
      batch.delete(db().collection('development_uploads').doc(obsolete)); await batch.commit();
    }
    return { id, partBytes: 384 * 1024 };
  }
  static async uploadPart(scope: DevelopmentScope, id: string, index: number, data: string) {
    const upload = (await owned('development_uploads', id, scope)).data;
    if (upload.expiresAt < Date.now() || index < 0 || index >= upload.parts || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) throw new DevelopmentError('invalid_upload_part', 'Parte ou sessão de upload inválida.');
    const bytes = Buffer.from(data, 'base64'), expected = index === upload.parts - 1 ? upload.size - index * 384 * 1024 : 384 * 1024;
    if (bytes.length !== expected) throw new DevelopmentError('invalid_upload_part', 'Tamanho da parte diverge do upload.');
    await db().collection('development_upload_parts').doc(`${id}-${index}`).set({ data, sha256: sha256(bytes) });
    return { index, sha256: sha256(bytes) };
  }
  static async completeUpload(scope: DevelopmentScope, id: string) {
    const upload = (await owned('development_uploads', id, scope)).data;
    if (upload.expiresAt < Date.now()) throw new DevelopmentError('upload_expired', 'Upload expirado. Reenvie o ZIP.');
    const parts: Buffer[] = [];
    for (let i = 0; i < upload.parts; i++) {
      const part = (await db().collection('development_upload_parts').doc(`${id}-${i}`).get()).data();
      if (!part) throw new DevelopmentError('upload_incomplete', 'Upload incompleto; retome as partes pendentes.', 409);
      const bytes = Buffer.from(part.data, 'base64'); if (sha256(bytes) !== part.sha256) throw new DevelopmentError('upload_corrupted', 'Parte corrompida. Reenvie o ZIP.'); parts.push(bytes);
    }
    const bytes = Buffer.concat(parts);
    if (bytes.length !== upload.size || sha256(bytes) !== upload.digest) throw new DevelopmentError('upload_corrupted', 'Checksum do ZIP enviado diverge do original.');
    const workspace = await this.importZip(scope, bytes, upload.name);
    const batch = db().batch(); for (let i = 0; i < upload.parts; i++) batch.delete(db().collection('development_upload_parts').doc(`${id}-${i}`));
    batch.delete(db().collection('development_uploads').doc(id)); await batch.commit();
    await db().collection('development_quotas').doc(scopeKey(scope)).set({ uploadId: null, uploadUntil: 0 }, { merge: true });
    return workspace;
  }
}
