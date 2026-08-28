import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { researchProgress } from '../server/ai/researchJobService.js';

describe('Pesquisa durável e progresso ao usuário', () => {
  it('calcula progresso com base em buscas, páginas e localização de trechos', () => {
    const progress = researchProgress('in_progress', [
      { type: 'search', query: 'primeira busca', sourceCount: 5 },
      { type: 'search', query: 'segunda busca', sourceCount: 4 },
      { type: 'open_page', url: 'https://example.com/report', sourceCount: 0 },
      { type: 'find_in_page', pattern: 'resultado', sourceCount: 0 },
    ]);

    expect(progress.searches).toBe(2);
    expect(progress.pagesOpened).toBe(1);
    expect(progress.inPageFinds).toBe(1);
    expect(progress.percent).toBeGreaterThan(20);
    expect(progress.stage).toContain('verificando');
    expect(researchProgress('completed', []).percent).toBe(100);
  });

  it('mantém jobs protegidos e expõe iniciar, consultar e cancelar', () => {
    const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
    const routes = readFileSync(
      new URL('../server/routes/aiRoutes.ts', import.meta.url),
      'utf8'
    );
    const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');

    expect(rules).toContain('match /research_jobs/{jobId}');
    expect(routes).toContain("'/research-jobs'");
    expect(routes).toContain("'/research-jobs/:jobId'");
    expect(routes).toContain("'/research-jobs/:jobId/cancel'");
    expect(routes).toContain("strategy: 'completed'");
    expect(app).toContain('researchProgressText');
    expect(app).toContain('activeResearchJobIdRef');
  });
});
