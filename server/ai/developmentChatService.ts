import { randomUUID } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import type { ExecutionParams } from './types/ai.js';
import { DevelopmentService } from '../development/service.js';
import { DevelopmentError } from '../development/archive.js';
import { db } from '../development/persistence.js';
import { explicitOwnTarget, hasEngineeringOrder } from '../../shared/engineeringIntent.js';
import { extractGithubRepositoryUrlFromPrompt } from '../services/externalImportService.js';
import { shouldResearchGithub } from './githubResearchService.js';

/** Importing a source is an authenticated data operation, with zero model calls and no GitHub App requirement. */
export class DevelopmentChatService {
  static async respond(params: ExecutionParams) {
    if (explicitOwnTarget(params.prompt) && hasEngineeringOrder(params.prompt)) return null;
    const url = !shouldResearchGithub(params.prompt) ? extractGithubRepositoryUrlFromPrompt(params.prompt) : undefined;
    let workspace: Record<string, any> | null = null, failure: string | null = null;
    const scope = { userId: params.userId, tenantId: params.tenantId || `user:${params.userId}` };
    if (!url && !/^(?:workspace-|github-)/.test(params.projectId || '')) return null;
    if (url) {
      try { workspace = await DevelopmentService.importGithub(scope, url); }
      catch (error) { failure = error instanceof DevelopmentError ? error.message : 'A importação integral falhou. Nenhum workspace parcial foi declarado pronto.'; }
    } else {
      const project = (await db().collection('projects').doc(params.projectId!).get()).data();
      if (project?.userId !== scope.userId || project?.tenantId !== scope.tenantId) return null;
      if (project.workspaceId) workspace = await DevelopmentService.workspace(scope, project.workspaceId);
      else if (project.sourceKind === 'github' && project.githubRepositoryFullName) {
        try { workspace = await DevelopmentService.importGithub(scope, 'https://github.com/' + project.githubRepositoryFullName); }
        catch (error) { failure = error instanceof DevelopmentError ? error.message : 'Não foi possível importar a origem integral.'; }
      } else return null;
    }
    if (!workspace && !failure) return null;
    const development = workspace ? { workspaceId: workspace.id, projectId: workspace.projectId, status: workspace.status, pendingInstruction: params.prompt,
      sourceCommitSha: workspace.source?.commitSha || null, digest: workspace.digest, fileCount: workspace.fileCount } : null;
    const text = failure || [`Projeto ${workspace!.title} importado integralmente: ${workspace!.fileCount} arquivos, ${workspace!.bytes} bytes.`,
      workspace!.source?.commitSha ? `Origem: ${workspace!.source.url}, commit ${workspace!.source.commitSha}.` : 'Origem: arquivo privado do projeto.',
      `Checksum da árvore: ${workspace!.digest}.`,
      'O painel do projeto permite consultar os arquivos originais e baixar o ZIP. Para executar a alteração, confirme no painel a instrução e o limite de créditos.',
      'Nenhum comando, alteração no GitHub ou deploy foi iniciado nesta importação.'].join('\n\n');
    const executionId = 'development-' + randomUUID();
    if (params.conversationId) {
      const batch = db().batch(), timestamp = FieldValue.serverTimestamp();
      for (const [role, content] of [['user', params.prompt], ['assistant', text]]) batch.set(db().collection('messages').doc(`${executionId}-${role}`), {
        ...scope, conversationId: params.conversationId, projectId: workspace?.projectId || params.projectId || null,
        role, content, executionId, origin: 'project_development', createdAt: timestamp,
      });
      batch.update(db().collection('conversations').doc(params.conversationId), { updatedAt: timestamp }); await batch.commit();
    }
    return { text, executionId, modelUsed: 'project-import', consumedCredits: 0, citations: [], fallbackUsed: false,
      operationalControl: { development }, evidence: { sourceCount: 0, sourceDomains: [], researchStatus: 'not_requested', ragStatus: 'not_requested', socialSearchStatus: 'not_requested', siteAuditStatus: 'not_requested', siteAuditPages: 0, socialPlatforms: [] } };
  }
}
