import { describe, expect, it } from 'vitest';
import { collectProductionFindings } from '../server/selfEvolution/productionSiteAuditDiscoveryService.js';
import type { SiteAuditReport, SiteAuditPage } from '../server/services/siteAuditService.js';
import type { AutonomousBrowserReport } from '../server/selfEvolution/autonomousBrowserValidationService.js';

function html(overrides: Partial<SiteAuditReport> = {}): SiteAuditReport {
  return { origin: 'https://froc.example.com', pages: [], failures: [], siteWideIssues: [], ...overrides } as SiteAuditReport;
}
function browser(scenarios: AutonomousBrowserReport['scenarios'] = []): AutonomousBrowserReport {
  return { scenarios, consoleErrors: [], failedRequests: [] } as AutonomousBrowserReport;
}
function page(overrides: Partial<SiteAuditPage> = {}): SiteAuditPage {
  return {
    contentHash: 'a'.repeat(64), signals: { likelyClientRendered: false },
    issues: [{ code: 'META_DESCRIPTION_MISSING', severity: 'medium', category: 'seo',
      url: 'https://froc.example.com/', message: 'Meta description ausente.', evidence: 'description nao encontrada' }],
    ...overrides,
  } as SiteAuditPage;
}

describe('Falhas reais do site alimentam os agentes', () => {
  it('gera evidencia acionavel mesmo sem cinco erros anteriores na telemetria', () => {
    const findings = collectProductionFindings(html({ pages: [page()] }), browser());
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ code: 'META_DESCRIPTION_MISSING', probableFiles: ['index.html', 'src/App.tsx'] });
    expect(findings[0].evidence).toContain('a'.repeat(64));
  });

  it('nao inventa defeito de H1 ou conteudo a partir do HTML vazio de uma SPA', () => {
    const original = page();
    const spa = page({ signals: { likelyClientRendered: true } as SiteAuditPage['signals'],
      issues: [
        { ...original.issues[0], code: 'H1_COUNT', category: 'accessibility' },
        { ...original.issues[0], code: 'THIN_CONTENT', category: 'content' },
        original.issues[0],
      ] });
    expect(collectProductionFindings(html({ pages: [spa] }), browser()).map(f => f.code))
      .toEqual(['META_DESCRIPTION_MISSING']);
  });

  it('encaminha falhas confirmadas pelo navegador, mas trata falta de login como bloqueio externo', () => {
    const report = browser([
      { id: 'console-errors', status: 'failed', details: 'uncaught exception', durationMs: 1, traceSha256: 'b'.repeat(64) },
      { id: 'authenticated-session', status: 'external_blocker', details: 'Credenciais ausentes', durationMs: 0, traceSha256: 'c'.repeat(64) },
    ]);
    const findings = collectProductionFindings(html(), report);
    expect(findings).toHaveLength(1);
    expect(findings[0].code).toBe('BROWSER_console-errors');
    expect(findings[0].evidence).toContain('b'.repeat(64));
  });

  it('preserva defeitos reais de uma página estática mesmo com um script de analytics', () => {
    const source = page({ signals: { likelyClientRendered: false, scripts: 1 } as SiteAuditPage['signals'] });
    const codes = ['H1_COUNT', 'THIN_CONTENT', 'IMAGE_ALT_MISSING'];
    source.issues = codes.map(code => ({ ...source.issues[0], code,
      evidence: '<body><p>Olá</p><img src="foto.png"><script>console.log("analytics")</script></body>' }));
    expect(collectProductionFindings(html({ pages: [source] }), browser()).map(finding => finding.code).sort())
      .toEqual([...codes].sort());
  });

  it('encaminha paginas internas quebradas e erros 5xx sem transformar 401/403 em bugs', () => {
    const failures = [401, 403, 404, 500].map(status => ({
      status, code: `http_${status}`, url: `https://froc.example.com/pagina-${status}`, message: `HTTP ${status}`,
    }));
    expect(collectProductionFindings(html({ failures }), browser()).map(f => f.code))
      .toEqual(['PAGE_HTTP_500', 'PAGE_HTTP_404']);
  });

  it('remove parametros de URL e segredos das evidencias enviadas a fila', () => {
    const source = page();
    source.issues[0] = { ...source.issues[0],
      url: 'https://froc.example.com/?token=private#fragment',
      evidence: 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz',
    };
    const finding = collectProductionFindings(html({ pages: [source] }), browser())[0];
    expect(finding.url).toBe('https://froc.example.com/');
    expect(finding.evidence).not.toContain('abcdefghijklmnopqrstuvwxyz');
    expect(finding.evidence).toContain('[REDACTED_SECRET]');
  });

  it('nao abre uma tarefa com pagina externa fora do site configurado', () => {
    const source = page();
    source.issues[0].url = 'https://unrelated.example.com/';
    expect(collectProductionFindings(html({ pages: [source] }), browser())).toEqual([]);
  });

  it('nao perde erros de console que chegaram depois do cenario inicial', () => {
    const report = browser([
      { id: 'console-errors', status: 'passed', details: 'ok', durationMs: 1, traceSha256: 'b'.repeat(64) },
    ]);
    report.consoleErrors = ['TypeError tardio ao abrir uma vista'];
    expect(collectProductionFindings(html(), report).map(f => f.code)).toEqual(['BROWSER_console-errors']);
  });
  it('preserva o erro exato quando o cenario informa apenas a contagem, mascarando segredos', () => {
    const report = browser([{ id: 'console-errors', status: 'failed', details: '1-console-errors', durationMs: 1, traceSha256: 'b'.repeat(64) }]);
    report.consoleErrors = ['TypeError: cannot read property at ChatCentral.tsx:123; Authorization: Bearer abcdefghijklmnopqrstuvwxyz'];
    const findings = collectProductionFindings(html(), report);
    expect(findings).toHaveLength(1);
    expect(findings[0].evidence).toContain('TypeError: cannot read property at ChatCentral.tsx:123');
    expect(findings[0].evidence).not.toContain('abcdefghijklmnopqrstuvwxyz');
  });
});
