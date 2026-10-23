import { createHash, randomUUID } from 'node:crypto';
import { adminDb, isFirebaseAdminConfigured } from '../lib/firebaseAdmin.js';
import { SiteAuditService, type SiteAuditReport } from '../services/siteAuditService.js';
import { AutonomousBrowserValidationService, type AutonomousBrowserReport } from './autonomousBrowserValidationService.js';
import { SelfEvolutionPolicyEngine } from './selfEvolutionPolicyEngine.js';
import { RedactionService } from './redactionService.js';
import { LockService } from './lockService.js';
import { AuditService } from './auditService.js';
import type { ImprovementCandidate } from './selfEvolutionTypes.js';
import { REQUIRED_SELF_SITE_VIEWS } from '../../worker/site-navigation-audit.mjs';

export interface ProductionFinding {
  code: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  url: string;
  message: string;
  evidence: string;
  probableFiles: string[];
}

function safeUrl(value: string, origin: string): string | null {
  try {
    const url = new URL(value);
    if (url.origin !== origin || url.username || url.password) return null;
    url.search = ''; url.hash = '';
    return url.toString();
  } catch { return null; }
}

function clean(value: string): string {
  return RedactionService.redactSensitiveData(value).slice(0, 700);
}

/** Evidencia observada, sem pedir ao modelo que invente uma ideia ou causa raiz. */
export function collectProductionFindings(html: SiteAuditReport, browser: AutonomousBrowserReport): ProductionFinding[] {
  const findings: ProductionFinding[] = [];
  for (const page of html.pages) {
    for (const item of page.issues) {
      if (item.severity === 'info') continue;
      // A ausencia de DOM no HTML inicial de uma SPA nao comprova defeito visual.
      if (page.signals.likelyClientRendered && ['H1_COUNT', 'THIN_CONTENT', 'IMAGE_ALT_MISSING'].includes(item.code)) continue;
      const url = safeUrl(item.url, html.origin);
      if (!url) continue;
      findings.push({
        code: item.code, severity: item.severity, url,
        message: clean(item.message), evidence: `${clean(item.evidence)}; HTML SHA256 ${page.contentHash}`,
        probableFiles: item.category === 'security' ? ['vercel.json', 'server.ts'] : ['index.html', 'src/App.tsx'],
      });
    }
  }
  for (const failure of html.failures) {
    // Ausencia de acesso autenticado e bloqueio de rede nao sao bugs comprovados do codigo.
    if (failure.status === null || !([404, 410].includes(failure.status) || failure.status >= 500)) continue;
    const url = safeUrl(failure.url, html.origin);
    if (!url) continue;
    findings.push({
      code: `PAGE_HTTP_${failure.status}`, severity: failure.status >= 500 ? 'high' : 'medium',
      url, message: 'Pagina interna falhou durante a varredura.',
      evidence: `HTTP ${failure.status}; ${clean(failure.message)}`,
      probableFiles: failure.status >= 500 ? ['server.ts', 'server/routes/healthRoutes.ts'] : ['src/App.tsx', 'vercel.json'],
    });
  }
  for (const item of html.siteWideIssues) {
    const url = safeUrl(item.url, html.origin);
    if (!url || item.severity === 'info') continue;
    findings.push({ code: item.code, severity: item.severity, url,
      message: clean(item.message), evidence: `${clean(item.evidence)}; auditoria ${html.auditId}`,
      probableFiles: item.category === 'security' ? ['vercel.json', 'server.ts'] : ['index.html', 'src/App.tsx'] });
  }
  for (const scenario of browser.scenarios) {
    if (scenario.status !== 'failed') continue;
    findings.push({
      code: `BROWSER_${scenario.id}`, severity: 'high', url: html.origin + '/',
      message: `Falha reproduzida no navegador: ${scenario.id}.`,
      evidence: `${clean(scenario.details)}; trace SHA256 ${scenario.traceSha256}`,
      probableFiles: ['src/App.tsx', 'src/components/ChatCentral.tsx'],
    });
  }
  const rank = { critical: 4, high: 3, medium: 2, low: 1 };
  for (const view of browser.navigation || []) {
    if (view.status !== 'failed') continue;
    findings.push({ code: `VIEW_${view.view}`, severity: 'high', url: html.origin + '/',
      message: `A vista ${view.view} falhou na navegacao real.`,
      evidence: `${clean(view.details)}; trace SHA256 ${view.traceSha256}`,
      probableFiles: ['src/App.tsx', 'src/components/Sidebar.tsx'] });
  }
  // Erros tardios, por exemplo depois do login, podem chegar apos o cenario de console/rede.
  for (const [id, events] of [['console-errors', browser.consoleErrors], ['network-errors', browser.failedRequests]] as const) {
    if (!events.length || browser.scenarios.some(scenario => scenario.id === id && scenario.status === 'failed')) continue;
    const observed = events.slice(0, 4).map(clean).join(' | ');
    findings.push({ code: `BROWSER_${id}`, severity: 'high', url: html.origin + '/',
      message: `Falhas observadas no navegador: ${id}.`,
      evidence: `${observed}; SHA256 ${createHash('sha256').update(observed).digest('hex')}`,
      probableFiles: ['src/App.tsx', 'src/components/ChatCentral.tsx'] });
  }
  return findings.sort((a, b) => rank[b.severity] - rank[a.severity]);
}

export class ProductionSiteAuditDiscoveryService {
  static async discoverOne(now = new Date(), options: { force?: boolean } = {}): Promise<{
    status: 'created' | 'already_audited' | 'no_findings' | 'partial' | 'not_configured';
    candidateId?: string;
    findings?: number;
    limitations?: string[];
  }> {
    const configuredUrl = process.env.SELF_EVOLUTION_TARGET_URL?.trim();
    if (!configuredUrl) return { status: 'not_configured', limitations: ['SELF_EVOLUTION_TARGET_URL ausente.'] };
    const target = new URL(configuredUrl);
    if (target.protocol !== 'https:' || target.username || target.password || target.search || target.hash) {
      throw new Error('A auditoria de producao exige URL HTTPS sem credenciais ou parametros.');
    }
    if (!isFirebaseAdminConfigured()) throw new Error('Auditoria de producao exige Firestore persistente.');
    if (!(await SelfEvolutionPolicyEngine.isSelfEvolutionEnabledPersisted())) {
      return { status: 'not_configured', limitations: ['Autoevolucao desativada pela configuracao persistente.'] };
    }
    const day = now.toISOString().slice(0, 10);
    const id = `${day}-${createHash('sha256').update(target.origin).digest('hex').slice(0, 16)}`;
    const ref = adminDb.collection('self_evolution_site_audits').doc(id);
    const owner = `production-audit-${randomUUID()}`;
    const lock = await LockService.acquireLock(`site-audit-${id}`, owner, 7 * 60_000);
    if (!lock) return { status: 'partial', limitations: ['Auditoria em andamento em outro executor.'] };
    try {
      const prior = await ref.get();
      if (!options.force && prior.exists && ['complete', 'partial'].includes(prior.data()?.status)) {
        return { status: prior.data()?.status === 'partial' ? 'partial' : 'already_audited', findings: prior.data()?.findingsCount || 0,
          limitations: prior.data()?.limitations || [] };
      }
      await ref.set({ status: 'running', targetUrl: target.toString(), startedAt: now.toISOString() });
      const commitSha = process.env.GITHUB_SHA?.trim();
      if (!commitSha || !/^[a-f0-9]{40}$/i.test(commitSha)) {
        throw new Error('GITHUB_SHA ausente para associar a auditoria ao checkout utilizado pelo executor.');
      }
      // O crawler encontra URLs; o navegador confere JS, rede, console e os cenarios de sessao.
      const html = await SiteAuditService.audit({ url: target.toString(), maxPages: 40 });
      const browser = await AutonomousBrowserValidationService.validate({
        previewUrl: target.toString(), commitSha, candidateId: `site-audit-${id}`,
      });
      const findings = collectProductionFindings(html, browser);
      const limitations = [
        ...html.limitations,
        ...browser.scenarios.filter(s => s.status === 'external_blocker').map(s => `${s.id}: ${clean(s.details)}`),
        'O SHA registrado identifica o checkout; a versao publicada depende de confirmacao na Vercel.',
        'A varredura de URLs nao comprova todos os fluxos de negocio nem todas as conversas possiveis.',
      ];
      const renderedViewsCovered = REQUIRED_SELF_SITE_VIEWS.every(view =>
        browser.navigation?.some(observed => observed.view === view && observed.status === 'passed'));
      const partial = html.status !== 'complete' || browser.scenarios.some(s => s.status === 'external_blocker') ||
        (html.pages.some(p => p.signals.likelyClientRendered) && !renderedViewsCovered);
      const candidateIds: string[] = [];
      // Agrupa o mesmo defeito em varias paginas e preserva uma fila limitada por auditoria.
      const grouped = new Map<string, ProductionFinding[]>();
      for (const finding of findings) {
        const key = `${finding.code}|${finding.probableFiles.join('|')}`;
        grouped.set(key, [...(grouped.get(key) || []), finding]);
      }
      for (const [signature, issues] of grouped) {
        if (candidateIds.length === 5) break;
        const first = issues[0];
        const issueHash = createHash('sha256').update(`${target.origin}|${signature}`).digest('hex');
        const candidateId = `site-${issueHash.slice(0, 32)}-${day}`;
        const riskLevel = SelfEvolutionPolicyEngine.classifyRisk(first.probableFiles);
        const candidate: ImprovementCandidate = {
          id: candidateId, title: `[Auditoria do site] ${first.code}`,
          summary: `${issues.length} ocorrencia(s) observada(s). ${first.message} A causa raiz ainda precisa ser reproduzida no codigo.`,
          evidence: [`self_evolution_site_audits/${id}`, ...issues.slice(0, 8).map(i => `${i.url} | ${i.evidence}`)],
          frequency: issues.length, affectedUsersCount: 0, severity: first.severity, confidence: 0.9,
          affectedComponents: ['production-site', first.code], probableFiles: first.probableFiles,
          hypothesis: `A auditoria observou ${first.code}; investigar o codigo e os dependentes antes de propor a correcao.`,
          expectedBehavior: 'O cenario observado deve passar no navegador sem introduzir novas falhas.',
          riskLevel, estimatedCostCredits: 10,
          testPlan: `Reproduzir ${first.code}, adicionar teste de regressao que falhe antes da correcao e executar lint, testes, build e navegador.`,
          rollbackStrategy: 'Reverter o PR e restaurar o deployment anterior verificado.',
          duplicates: [], requiresApproval: riskLevel === 'R2' || riskLevel === 'R3',
          state: 'detected', createdAt: now.toISOString(), updatedAt: now.toISOString(),
        };
        const candidateRef = adminDb.collection('self_evolution_candidates').doc(candidateId);
        const signatureRef = adminDb.collection('self_evolution_site_issue_signatures').doc(issueHash);
        const created = await adminDb.runTransaction(async tx => {
          const previous = await tx.get(signatureRef);
          const existing = await tx.get(candidateRef);
          const lastId = previous.data()?.candidateId;
          if (typeof lastId === 'string' && lastId !== candidateId) {
            const last = await tx.get(adminDb.collection('self_evolution_candidates').doc(lastId));
            // Uma correcao aceita que voltou a falhar em outro dia pode ser investigada novamente.
            // Falhas e rejeicoes existentes continuam visiveis, sem nova cobranca automatica.
            if (last.exists && last.data()?.state !== 'accepted') return false;
          }
          // Um defeito pendente ou que ja falhou nao deve cobrar outro patch a cada agendamento.
          if (existing.exists) return false;
          tx.create(candidateRef, candidate);
          tx.set(signatureRef, { candidateId, issueCode: first.code, detectedAt: now.toISOString() });
          return true;
        });
        if (created) candidateIds.push(candidateId);
      }
      await ref.set({
        status: partial ? 'partial' : 'complete', targetUrl: target.toString(),
        startedAt: html.startedAt, completedAt: browser.completedAt, repositorySha: commitSha,
        findingsCount: findings.length, candidateIds,
        pages: html.pages.map(p => ({ url: safeUrl(p.finalUrl, target.origin), contentHash: p.contentHash })),
        scenarios: browser.scenarios.map(s => ({ id: s.id, status: s.status, traceSha256: s.traceSha256, details: clean(s.details) })),
        navigation: (browser.navigation || []).map(view => ({ ...view, details: clean(view.details) })),
        findings: findings.slice(0, 100), limitations,
      });
      await AuditService.logEvent({ actor: 'production-site-auditor', action: 'scan_production_site', resource: id,
        riskLevel: 'R0', result: findings.length || partial ? 'failure' : 'success', deployUrl: target.toString(),
        reason: `${html.pages.length} paginas; ${browser.scenarios.length} cenarios; ${findings.length} falhas; ${candidateIds.length} tarefas. Cobertura ${partial ? 'parcial' : 'publica concluida'}.` });
      return { status: candidateIds.length ? 'created' : partial || findings.length ? 'partial' : 'no_findings',
        ...(candidateIds.length ? { candidateId: candidateIds[0] } : {}), findings: findings.length, limitations };
    } catch (error) {
      await ref.set({ status: 'failed', completedAt: new Date().toISOString(),
        error: clean(error instanceof Error ? error.message : String(error)) }, { merge: true });
      throw error;
    } finally {
      await LockService.releaseLock(`site-audit-${id}`, owner);
    }
  }
}
