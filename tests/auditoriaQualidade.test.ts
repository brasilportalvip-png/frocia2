/**
 * Auditoria de 16/11/2026: data e hora para a IA, padrão de qualidade das respostas e
 * rotas internas fechadas quando o segredo de produção não foi configurado.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContextBuilder, currentDateTimeSection } from '../server/ai/contextBuilder.js';
import { PromptRegistry } from '../server/ai/promptRegistry.js';
import { MemoryService } from '../server/ai/memoryService.js';
import { RAGService } from '../server/ai/ragService.js';
import { DEV_INTERNAL_CRON_SECRET, requireCronSecret } from '../server/routes/internalRoutes.js';

describe('A IA sabe que dia e que hora é', () => {
  it('data em português, horário de Brasília e período certo para o cumprimento', () => {
    const noite = currentDateTimeSection(new Date('2026-11-16T22:40:00Z'));
    expect(noite).toContain('segunda-feira, 16 de novembro de 2026');
    expect(noite).toContain('19:40');
    expect(noite).toContain('boa noite');
    expect(currentDateTimeSection(new Date('2026-11-16T12:00:00Z'))).toContain('bom dia');
    expect(currentDateTimeSection(new Date('2026-11-16T17:00:00Z'))).toContain('boa tarde');
  });
});

describe('Toda conversa recebe data, hora e o padrão de qualidade', () => {
  afterEach(() => vi.restoreAllMocks());

  it('entra no contexto normal e não promete "faz tudo"', async () => {
    vi.spyOn(PromptRegistry, 'getActivePrompt').mockResolvedValue('Responda com precisão.');
    vi.spyOn(MemoryService, 'getActiveMemories').mockResolvedValue([]);
    vi.spyOn(RAGService, 'retrieveRelevantChunks').mockResolvedValue([]);
    const ctx = await ContextBuilder.assemble({ userId: 'u-1', mode: 'smart', prompt: 'Que dia é hoje?' });
    expect(ctx.systemInstruction).toContain('[DATA E HORA ATUAIS]');
    expect(ctx.systemInstruction).toContain('[PADRÃO DE QUALIDADE DAS RESPOSTAS]');
    expect(ctx.systemInstruction).toContain('Não bajule');
    expect(ctx.systemInstruction).not.toContain('faz tudo');
  });
});

describe('Rotas internas: o segredo de desenvolvimento não vale em produção', () => {
  it('recusa o segredo público quando roda na Vercel', () => {
    const previous = process.env.VERCEL;
    process.env.VERCEL = '1';
    try {
      const res = { statusCode: 0, status(code: number) { this.statusCode = code; return this; }, json() { return this; } };
      const next = vi.fn();
      requireCronSecret({ headers: { 'x-cron-secret': DEV_INTERNAL_CRON_SECRET } } as never, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(401);
    } finally {
      if (previous === undefined) delete process.env.VERCEL;
      else process.env.VERCEL = previous;
    }
  });
});
