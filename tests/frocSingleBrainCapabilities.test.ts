import { afterEach, describe, expect, it, vi } from 'vitest';
import { AIRequestOrchestrator } from '../server/ai/requestOrchestrator.js';
import { ContextBuilder } from '../server/ai/contextBuilder.js';
import { PromptRegistry } from '../server/ai/promptRegistry.js';
import { MemoryService } from '../server/ai/memoryService.js';
import { routeFrocRequest } from '../shared/frocIntentRouter';

describe('Uma Froc só — a conversa sabe criar imagem, vídeo e site', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each(['Qualquer um, é só teste.', 'Bom dia.', 'Você lembra que te pedi uma imagem de um gato?'])(
    'a instrução de capacidades vale na conversa normal (sem modo código): %s',
    async (prompt) => {
      vi.spyOn(PromptRegistry, 'getActivePrompt').mockResolvedValue('Responda com precisao.');
      vi.spyOn(MemoryService, 'getActiveMemories').mockResolvedValue([]);
      const plan = AIRequestOrchestrator.plan({ mode: 'smart', prompt });
      const context = await ContextBuilder.assemble({ userId: 'owner', mode: plan.effectiveMode, prompt, requestPolicy: plan.systemPolicy });
      expect(context.systemInstruction).toContain('[[FROC_ACTION:image|');
      expect(context.systemInstruction).toContain('Nunca diga que não consegue');
      expect(context.systemInstruction).toContain('[Registro automático]');
    }
  );

  it('pedido de teste vira imagem limpa, sem "pra mim" e "de teste"', () => {
    expect(routeFrocRequest('crie uma imagem simples para mim de teste de um gato')).toEqual({ mode: 'Imagem', prompt: 'um gato' });
    expect(routeFrocRequest('gera uma imagem qualquer só pra testar')?.prompt).toBe('Uma imagem bonita e simples, com tema livre.');
  });
});
