import { createHash, randomUUID } from 'node:crypto';
import { adminDb, isFirebaseAdminConfigured } from '../lib/firebaseAdmin.js';
import { SiteAuditService, type SiteAuditReport, type SiteAuditCheckpoint } from '../services/siteAuditService.js';
import { AutonomousBrowserValidationService, type AutonomousBrowserReport } from './autonomousBrowserValidationService.js';
import { SelfEvolutionPolicyEngine } from './selfEvolutionPolicyEngine.js';
import { RedactionService } from './redactionService.js';
import { LockService } from './lockService.js';
import { AuditService } from './auditService.js';
import type { ImprovementCandidate } from './selfEvolutionTypes.js';
import { REQUIRED_SELF_SITE_VIEWS } from '../../worker/site-navigation-audit.mjs';
import type { SelfSiteKnowledge } from './selfSiteKnowledgeService.js';

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
    const diagnosticEvents = scenario.id === 'console-errors' ? browser.consoleErrors : scenario.id === 'network-errors' ? browser.failedRequests : [];
    const diagnostic = diagnosticEvents.slice(0, 4).map(clean).join(' | ');
    findings.push({
      code: `BROWSER_${scenario.id}`, severity: 'high', url: html.origin + '/',
      message: `Falha reproduzida no navegador: ${scenario.id}.`,
      evidence: `${clean(scenario.details)}${diagnostic ? '; mensagens: ' + diagnostic : ''}; trace SHA256 ${scenario.traceSha256}`,
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
  static async summaryForContinuation(repositorySha: string) {
    const configuredUrl = process.env.SELF_EVOLUTION_TARGET_URL?.trim();
    if (!configuredUrl || !isFirebaseAdminConfigured()) throw new Error('Auditoria persistente indisponivel para retomada.');
    const target = new URL(configuredUrl);
    const id = 'site-' + createHash('sha256').update(target.origin).digest('hex').slice(0, 16);
    const saved = await adminDb.collection('self_evolution_site_audits').doc(id).get();
    const data = saved.data();
    const coverageComplete = data?.repositorySha === repositorySha && data?.status === 'complete';
    return { status: 'cached_audit', findings: Number(data?.findingsCount || 0), coverageComplete, requiresResume: !coverageComplete,
      limitations: [...(data?.limitations || []), 'Retomada da entrega usa a auditoria registrada; uma nova varredura pertence ao ciclo diario.'] };
  }
  static async discoverOne(now = new Date(), options: { force?: boolean; knowledge?: SelfSiteKnowledge } = {}): Promise<{
    status: 'created' | 'already_audited' | 'findings_recorded' | 'no_findings' | 'partial' | 'not_configured';
    candidateId?: string;
    findings?: number;
    limitations?: string[];
    requiresResume?: boolean;
    coverageComplete?: boolean;
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
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
    const id = `site-${createHash('sha256').update(target.origin).digest('hex').slice(0, 16)}`;
    const ref = adminDb.collection('self_evolution_site_audits').doc(id);
    const owner = `production-audit-${randomUUID()}`;
    const lock = await LockService.acquireLock(`site-audit-${id}`, owner, 7 * 60_000);
    if (!lock) return { status: 'partial', limitations: ['Auditoria em andamento em outro executor.'] };
    try {
      const commitSha = process.env.GITHUB_SHA?.trim();
      if (!commitSha || !/^[a-f0-9]{40}$/i.test(commitSha)) {
        throw new Error('GITHUB_SHA ausente para associar a auditoria ao checkout utilizado pelo executor.');
      }
      const prior = await ref.get();
      const continuing = !options.force && prior.exists && prior.data()?.repositorySha === commitSha &&
        (prior.data()?.dateKey === day || prior.data()?.status !== 'complete');
      if (continuing && prior.data()?.status === 'complete') {
        return { status: 'already_audited', findings: prior.data()?.findingsCount || 0,
          limitations: prior.data()?.limitations || [], requiresResume: false, coverageComplete: true };
      }
      const generation = continuing && typeof prior.data()?.generation === 'string' ? prior.data()!.generation : randomUUID();
      const detailsRef = ref.collection('generations').doc(generation);
      let checkpoint: SiteAuditCheckpoint | undefined;
      const checkpointParts = continuing ? Number(prior.data()?.checkpointParts || 0) : 0;
      if (checkpointParts) {
        let json = '';
        for (let part = 0; part < checkpointParts; part++) {
          const saved = await detailsRef.collection('checkpoint').doc(String(part)).get();
          if (typeof saved.data()?.json !== 'string') throw new Error('Checkpoint da varredura incompleto.');
          json += saved.data()!.json;
        }
        checkpoint = JSON.parse(json);
      }
      await ref.set({ status: 'running', generation, dateKey: day, repositorySha: commitSha, targetUrl: target.toString(),
        startedAt: continuing ? prior.data()?.startedAt || now.toISOString() : now.toISOString() }, { merge: true });
      const priorNavigation = continuing ? (prior.data()?.navigation || []) as NonNullable<AutonomousBrowserReport['navigation']> : [];
      const expectedViews = options.knowledge?.navigation.map(v => v.label) || REQUIRED_SELF_SITE_VIEWS;
      const knownViews = [...new Set([...expectedViews, ...(continuing ? prior.data()?.navigationCatalog || [] : [])])];
      const pendingViews = knownViews.filter(view => !priorNavigation.some(v => v.view === view && v.status !== 'external_blocker'));
      // O crawler encontra URLs; o navegador confere JS, rede, console e os cenarios de sessao.
      // Autorizacao do dono para o proprio site; o auditor de sites de terceiros conserva robots.
      const html = await SiteAuditService.audit({ url: target.toString(), maxPages: 40, fullCoverage: true, respectRobots: false, checkpoint });
      // Bloqueios transitorios voltam para a fronteira, inclusive de um dia para o seguinte.
      const retryUrls = html.failures.filter(f => f.status === null || [401, 403].includes(f.status)).map(f => f.url);
      if (html.checkpoint && retryUrls.length) {
        html.checkpoint.pendingUrls = [...new Set([...html.checkpoint.pendingUrls, ...retryUrls])];
        html.checkpoint.visitedUrls = html.checkpoint.visitedUrls.filter(url => !retryUrls.includes(url));
      }
      const browser = await AutonomousBrowserValidationService.validate({
        previewUrl: target.toString(), commitSha, candidateId: `site-audit-${id}`,
        expectedNavigationViews: expectedViews,
        ...(continuing ? { navigationViews: pendingViews } : {}),
      });
      const navigation = [...new Map([...priorNavigation, ...(browser.navigation || [])].map(v => [v.view, v])).values()];
      const navigationCatalog = [...new Set([...knownViews, ...(browser.navigationCatalog || []), ...navigation.map(v => v.view)])];
      const observedFindings = collectProductionFindings(html, browser);
      for (const finding of observedFindings) {
        const key = createHash('sha256').update(`${finding.code}|${finding.url}`).digest('hex');
        await detailsRef.collection('findings').doc(key).set({ ...finding });
      }
      const storedFindings = await detailsRef.collection('findings').get();
      const findings = storedFindings.docs.map(doc => doc.data() as ProductionFinding);
      for (const page of html.pages) {
        await detailsRef.collection('pages').doc(createHash('sha256').update(page.finalUrl).digest('hex'))
          .set({ url: safeUrl(page.finalUrl, target.origin), contentHash: page.contentHash });
      }
      const cursor = JSON.stringify(html.checkpoint || { origin: target.origin, pendingUrls: [], visitedUrls: [], pendingSitemaps: [], processedSitemaps: [], loadedSitemaps: [] });
      const parts = Math.ceil(cursor.length / 100_000);
      for (let part = 0; part < parts; part++) {
        await detailsRef.collection('checkpoint').doc(String(part)).set({ json: cursor.slice(part * 100_000, (part + 1) * 100_000) });
      }
      const limitations = [
        ...html.limitations,
        ...browser.scenarios.filter(s => s.status === 'external_blocker').map(s => `${s.id}: ${clean(s.details)}`),
        'O SHA registrado identifica o checkout; a versao publicada depende de confirmacao na Vercel.',
        'A varredura de URLs nao comprova todos os fluxos de negocio nem todas as conversas possiveis.',
      ];
      const renderedViewsCovered = navigationCatalog.every(view =>
        navigation.some(observed => observed.view === view && observed.status !== 'external_blocker'));
      const urlsPending = (html.checkpoint?.pendingUrls.length || 0) + (html.checkpoint?.pendingSitemaps.length || 0);
      const partial = urlsPending > 0 || html.status === 'blocked' || html.discovery.robotsBlockedUrls > 0 ||
        browser.scenarios.some(s => s.status === 'external_blocker') || !renderedViewsCovered ||
        Boolean(options.knowledge?.incompleteFiles.length);
      const candidateIds: string[] = [];
      // Agrupa ocorrencias repetidas; todos os grupos entram na fila, sem teto de cinco defeitos.
      const grouped = new Map<string, ProductionFinding[]>();
      for (const finding of findings) {
        const key = `${finding.code}|${finding.probableFiles.join('|')}`;
        grouped.set(key, [...(grouped.get(key) || []), finding]);
      }
      for (const [signature, issues] of grouped) {
        const first = issues[0];
        const issueHash = createHash('sha256').update(`${target.origin}|${signature}`).digest('hex');
        const candidateId = `site-${issueHash.slice(0, 32)}-${day}`;
        const riskLevel = SelfEvolutionPolicyEngine.classifyRisk(first.probableFiles);
        const candidate: ImprovementCandidate = {
          id: candidateId, title: `[Auditoria do site] ${first.code}`,
          summary: `${issues.length} ocorrencia(s) observada(s). ${first.message} A causa raiz ainda precisa ser reproduzida no codigo.`,
          evidence: [`self_evolution_site_audits/${id}/generations/${generation}`, `self_evolution_repository_index/${commitSha}`,
            ...issues.slice(0, 8).map(i => `${i.url} | ${i.evidence}`)],
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
          tx.set(signatureRef, { candidateId, issueCode: first.code, detectedAt: now.toISOString(), repositorySha: commitSha });
          return true;
        });
        if (created) candidateIds.push(candidateId);
      }
      await ref.set({
        status: partial ? 'partial' : 'complete', targetUrl: target.toString(),
        startedAt: continuing ? prior.data()?.startedAt || html.startedAt : html.startedAt,
        completedAt: browser.completedAt, repositorySha: commitSha, generation, dateKey: day, checkpointParts: parts,
        findingsCount: findings.length, candidateIds,
        coverage: { visitedUrls: html.checkpoint?.visitedUrls.length || html.pages.length, pendingUrls: urlsPending,
          viewsObserved: navigation.filter(v => v.status !== 'external_blocker').length, viewsTotal: navigationCatalog.length,
          sourceFiles: options.knowledge?.sourceFilesCount || 0, repositoryFiles: options.knowledge?.filesCount || 0 },
        scenarios: browser.scenarios.map(s => ({ id: s.id, status: s.status, traceSha256: s.traceSha256, details: clean(s.details) })),
        navigation: navigation.map(view => ({ ...view, details: clean(view.details) })), navigationCatalog, limitations,
      });
      await AuditService.logEvent({ actor: 'production-site-auditor', action: 'scan_production_site', resource: id,
        riskLevel: 'R0', result: findings.length || partial ? 'failure' : 'success', deployUrl: target.toString(),
        reason: `${html.pages.length} paginas; ${browser.scenarios.length} cenarios; ${findings.length} falhas; ${candidateIds.length} tarefas. Cobertura ${partial ? 'parcial' : 'publica concluida'}.` });
      return { status: candidateIds.length ? 'created' : partial ? 'partial' : findings.length ? 'findings_recorded' : 'no_findings',
        ...(candidateIds.length ? { candidateId: candidateIds[0] } : {}), findings: findings.length, limitations,
        coverageComplete: !partial, requiresResume: partial };
    } catch (error) {
      await ref.set({ status: 'failed', completedAt: new Date().toISOString(),
        error: clean(error instanceof Error ? error.message : String(error)) }, { merge: true });
      throw error;
    } finally {
      await LockService.releaseLock(`site-audit-${id}`, owner);
    }
  }
}
