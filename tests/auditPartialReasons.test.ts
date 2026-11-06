import { describe, expect, it } from 'vitest';
import { auditPartialReasons } from '../server/selfEvolution/productionSiteAuditDiscoveryService.js';
import { isAllowedDestination } from '../worker/egress-allowlist.mjs';

const base = { urlsPending: 0, crawlerBlocked: false, robotsBlockedUrls: 0, blockedScenarios: [], uncoveredViews: [], incompleteFiles: 0 };

describe('Motivos da auditoria parcial', () => {
  it('declara cobertura completa somente sem nenhum motivo', () => {
    expect(auditPartialReasons(base)).toEqual([]);
  });

  it('explica cada causa que torna a auditoria parcial', () => {
    const reasons = auditPartialReasons({
      urlsPending: 3, crawlerBlocked: true, robotsBlockedUrls: 1, incompleteFiles: 2,
      blockedScenarios: [{ id: 'authenticated-session', details: 'Credenciais E2E não configuradas.' }],
      uncoveredViews: [{ view: 'Projetos', details: 'Esta vista requer sessao autenticada de teste.' }],
    });
    expect(reasons).toHaveLength(6);
    expect(reasons.join('\n')).toContain('authenticated-session: Credenciais E2E');
    expect(reasons.join('\n')).toContain('Projetos (Esta vista requer sessao autenticada de teste.)');
    expect(reasons[0]).toContain('3 URL');
  });

  it('resume muitas vistas sem estourar a anotacao', () => {
    const uncoveredViews = Array.from({ length: 20 }, (_, i) => ({ view: `Vista ${i}`, details: 'x'.repeat(300) }));
    const [reason] = auditPartialReasons({ ...base, uncoveredViews });
    expect(reason.startsWith('vistas_nao_cobertas 20:')).toBe(true);
    expect(reason.length).toBeLessThan(800);
  });
});

describe('Proxy do worker libera os recursos declarados pelo site', () => {
  it('permite CDNs da CSP e o login do Firebase', () => {
    for (const host of ['cdn.tailwindcss.com', 'cdnjs.cloudflare.com', 'apis.google.com', 'frocia-prod.firebaseapp.com', 'x.firebaseio.com'])
      expect(isAllowedDestination(host, 443), host).toBe(true);
    expect(isAllowedDestination('firebaseapp.com.evil.io', 443)).toBe(false);
  });
});
