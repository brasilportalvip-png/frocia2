import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { adminDb, isFirebaseAdminConfigured } from '../lib/firebaseAdmin.js';
import { GeminiProvider } from '../ai/providers/geminiProvider.js';
import { env } from '../config/env.js';
import { SelfEvolutionPolicyEngine } from './selfEvolutionPolicyEngine.js';
import { BudgetService } from './budgetService.js';
import type { ImprovementCandidate } from './selfEvolutionTypes.js';
import {
  buildInnovationPrompt, selectInnovationAgent, validateInnovationProposal,
  type InnovationAgent, type TechnologyEvidence,
} from './innovationAgentCatalog.js';

export type InnovationDiscoveryOutcome = {
  status: 'created' | 'already_checked' | 'no_evidence' | 'no_proposal' | 'not_configured' | 'budget_exhausted';
  candidateId?: string;
  agentId: string;
};

async function trustedGitHubEvidence(repo: string): Promise<TechnologyEvidence | null> {
  if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repo)) return null;
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'FrocIA-InnovationResearch/1.0',
  };
  if (process.env.GITHUB_TOKEN?.trim()) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN.trim()}`;
  const endpoints = [
    `https://api.github.com/repos/${repo}/releases?per_page=1`,
    `https://api.github.com/repos/${repo}/commits?per_page=1`,
  ];
  for (const url of endpoints) {
    try {
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(12_000) });
      if (!response.ok) continue;
      const entries: unknown = await response.json();
      if (!Array.isArray(entries) || !entries.length) continue;
      const entry = entries[0] as Record<string, any>;
      const isRelease = url.includes('/releases?');
      const itemUrl: unknown = entry.html_url;
      const publishedAt: unknown = isRelease ? (entry.published_at || entry.created_at) : entry.commit?.committer?.date;
      const title: unknown = isRelease ? (entry.name || entry.tag_name) : entry.commit?.message?.split('\n')[0];
      if (typeof itemUrl !== 'string' || typeof publishedAt !== 'string' || typeof title !== 'string') continue;
      const parsed = new URL(itemUrl);
      if (parsed.protocol !== 'https:' || parsed.hostname !== 'github.com' ||
          !parsed.pathname.startsWith(`/${repo}/`)) continue;
      const age = Date.now() - Date.parse(publishedAt);
      if (!Number.isFinite(age) || age < -86_400_000 || age > 180 * 86_400_000) continue;
      return {
        repository: repo, title: title.slice(0, 180), url: itemUrl,
        publishedAt, description: (isRelease ? String(entry.body || '') : String(entry.commit?.message || '')).slice(0, 1000),
      };
    } catch { /* falha da fonte => tentar commit, depois nao propor */ }
  }
  return null;
}

async function localRepositoryContext(agent: InnovationAgent): Promise<Record<string, string>> {
  const snippets: Record<string, string> = {};
  for (const file of ['package.json', ...agent.targetFiles]) {
    try {
      // Caminhos sao exclusivos do catalogo estatico, nunca da saida do modelo.
      snippets[file] = (await readFile(file, 'utf8')).slice(0, file === 'package.json' ? 3800 : 6000);
    } catch {
      snippets[file] = '(arquivo nao acessivel neste ambiente)';
    }
  }
  return snippets;
}

/**
 * Executa um unico agente por dia (rodizio de 10), quando nao existem
 * candidatos operacionais. Nenhuma mudanca de codigo ou deploy e realizado
 * aqui: propostas entram na mesma fila e nos mesmos gates ja existentes.
 */
export class InnovationDiscoveryService {
  static async discoverOne(now = new Date()): Promise<InnovationDiscoveryOutcome> {
    const agent = selectInnovationAgent(now);
    const result = (status: InnovationDiscoveryOutcome['status'], candidateId?: string): InnovationDiscoveryOutcome =>
      ({ status, agentId: agent.id, ...(candidateId ? { candidateId } : {}) });

    if (!isFirebaseAdminConfigured() || !env.GEMINI_API_KEY) return result('not_configured');
    if (!(await SelfEvolutionPolicyEngine.isSelfEvolutionEnabledPersisted())) return result('not_configured');

    const dateKey = now.toISOString().slice(0, 10);
    const cycleRef = adminDb.collection('self_evolution_innovation_cycles').doc(dateKey);
    const prior = await cycleRef.get();
    if (prior.exists) return result('already_checked');

    const evidence = (await Promise.all(agent.sources.map(trustedGitHubEvidence)))
      .filter((item): item is TechnologyEvidence => item !== null);
    // Reserva um unico ciclo no Firestore ANTES da chamada paga ao modelo.
    const acquired = await adminDb.runTransaction(async (tx) => {
      const previous = await tx.get(cycleRef);
      if (previous.exists) return false;
      tx.create(cycleRef, { dateKey, agentId: agent.id, status: 'researching',
        recordedAt: now.toISOString() });
      return true;
    });
    if (!acquired) return result('already_checked');
    if (!evidence.length) {
      await cycleRef.update({ status: 'no_evidence' });
      return result('no_evidence');
    }

    if (!(await BudgetService.canExecuteAgentRun(1)) || !(await BudgetService.consumeBudget(1))) {
      await cycleRef.update({ status: 'budget_exhausted' });
      return result('budget_exhausted');
    }

    const context = await localRepositoryContext(agent);
    let response: Awaited<ReturnType<typeof GeminiProvider.generate>>;
    try {
      response = await GeminiProvider.generate({
      model: env.SPECIALIST_REVIEW_MODEL,
      temperature: 0.1,
      responseFormat: 'json',
      timeoutMs: 45_000,
      maxRetries: 0,
      systemInstruction: buildInnovationPrompt(agent),
      userMessage: JSON.stringify({ agent: agent.id, sources: evidence, currentProjectFiles: context,
        permittedTargetFiles: agent.targetFiles, objective: agent.acceptanceFocus }),
      });
    } catch (error) {
      await cycleRef.update({ status: 'provider_error' });
      throw error;
    }

    let parsed: unknown;
       try { parsed = JSON.parse(response.text.replace(/^```json\s*|\s*```$/g, '').trim()); }
    catch {
      await cycleRef.update({ status: 'no_proposal', reason: 'invalid_json' });
      return result('no_proposal');
    }
    const proposal = validateInnovationProposal(parsed, agent, evidence);
    if (!proposal || proposal.probableFiles.some((file) => context[file] === '(arquivo nao acessivel neste ambiente)')) {
      await cycleRef.update({ status: 'no_proposal' });
      return result('no_proposal');
    }

    const evidenceUsed = evidence.filter((item) => proposal.sourceUrls.includes(item.url));
    const sourceHash = createHash('sha256')
      .update(JSON.stringify({ role: agent.id, urls: proposal.sourceUrls, files: proposal.probableFiles, title: proposal.title }))
      .digest('hex');
    const candidateId = `innov-${sourceHash.slice(0, 40)}`;
    const riskLevel = SelfEvolutionPolicyEngine.classifyRisk(proposal.probableFiles);
    const candidate: ImprovementCandidate = {
      id: candidateId,
      title: `[Inovacao/${agent.name}] ${proposal.title}`.slice(0, 160),
      summary: `${proposal.summary} Beneficio esperado (a comprovar): ${proposal.measurableGain}`.slice(0, 2300),
      evidence: evidenceUsed.map((s) => `${s.url} | ${s.publishedAt} | ${s.title}`),
      frequency: 1, affectedUsersCount: 0, severity: 'medium', confidence: 0.6,
      affectedComponents: [agent.id], probableFiles: proposal.probableFiles,
      hypothesis: proposal.hypothesis, expectedBehavior: proposal.expectedBehavior,
      riskLevel, estimatedCostCredits: 10,
      testPlan: `${proposal.testPlan}\nCriterio: ${proposal.measurableGain}`,
      rollbackStrategy: 'Reverter a alteracao via PR e restaurar versao anterior comprovada.',
      duplicates: [], requiresApproval: riskLevel === 'R2' || riskLevel === 'R3',
      state: 'detected', createdAt: now.toISOString(), updatedAt: now.toISOString(),
    };
    const inserted = await adminDb.runTransaction(async (tx) => {
      const ref = adminDb.collection('self_evolution_candidates').doc(candidateId);
      const previous = await tx.get(ref);
      if (previous.exists) {
        tx.update(cycleRef, { status: 'duplicate', candidateId });
        return false;
      }
      tx.create(ref, candidate);
      tx.update(cycleRef, { status: 'created', candidateId, sourceUrls: proposal.sourceUrls });
      return true;
    });
    return inserted ? result('created', candidateId) : result('already_checked');
  }
}
