import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  IndependentResponseVerifier,
  deniesProjectAccess,
} from '../server/ai/independentResponseVerifier.js';
import { GeminiProvider } from '../server/ai/providers/geminiProvider.js';

afterEach(() => {
  vi.restoreAllMocks();
});

const projectContext =
  'CONSTRUÇÃO EM ANDAMENTO NA FÁBRICA DA FROC.IA: etapa 11 de 16, Geração do projeto. Arquivos planejados: 30; já escritos: 10.';

describe('verificador com projeto aberto no editor', () => {
  it('envia os dados do projeto ao verificador', async () => {
    const spy = vi.spyOn(GeminiProvider, 'generate').mockResolvedValueOnce({
      text: JSON.stringify({ approved: true, revisedResponse: '', reason: 'ok', risks: [] }),
      inputTokens: 1,
      outputTokens: 1,
    });
    await IndependentResponseVerifier.verify({
      prompt: 'Em que etapa está o site?',
      response: 'Está na geração do projeto: 10 de 30 arquivos.',
      domain: 'site-builder',
      sensitivity: 'normal',
      projectContext,
    });
    const call = spy.mock.calls[0][0] as any;
    expect(JSON.parse(call.userMessage).projectContext).toContain('etapa 11 de 16');
    expect(call.systemInstruction).toContain('projectContext');
  });

  it('não troca a resposta certa por "não tenho acesso ao site"', async () => {
    vi.spyOn(GeminiProvider, 'generate').mockResolvedValueOnce({
      text: JSON.stringify({
        approved: false,
        revisedResponse:
          'Como sou uma inteligência artificial, não tenho contexto sobre a qual site você está se referindo.',
        reason: 'sem evidência',
        risks: [],
      }),
      inputTokens: 1,
      outputTokens: 1,
    });
    const result = await IndependentResponseVerifier.verify({
      prompt: 'Em que etapa está o site?',
      response: 'Está na geração do projeto: 10 de 30 arquivos.',
      domain: 'site-builder',
      sensitivity: 'normal',
      projectContext,
    });
    expect(result.approved).toBe(true);
    expect(result.revisedResponse).toBeUndefined();
  });

  it('sem projeto aberto, continua aceitando a revisão', async () => {
    vi.spyOn(GeminiProvider, 'generate').mockResolvedValueOnce({
      text: JSON.stringify({ approved: false, revisedResponse: 'Correção sustentada.', reason: 'erro', risks: [] }),
      inputTokens: 1,
      outputTokens: 1,
    });
    const result = await IndependentResponseVerifier.verify({
      prompt: 'Qual a capital?',
      response: 'Errado.',
      domain: 'research',
      sensitivity: 'normal',
    });
    expect(result.revisedResponse).toBe('Correção sustentada.');
  });

  it('reconhece as respostas que negam acesso ao projeto', () => {
    expect(deniesProjectAccess('Olá! Parece que sua mensagem ficou incompleta. Você poderia me informar o nome do projeto?')).toBe(true);
    expect(deniesProjectAccess('Não tenho acesso direto ao site que você está criando.')).toBe(true);
    expect(deniesProjectAccess('Está na etapa 11: 10 de 30 arquivos já escritos.')).toBe(false);
  });
});

describe('resumo da construção para a pessoa', () => {
  it('usa só os dados reais da construção', async () => {
    const { describeFactoryStatusForPerson } = await import('../server/siteFactory/factoryChatContext.js');
    const text = describeFactoryStatusForPerson(
      'CONSTRUÇÃO EM ANDAMENTO:\n- Situação: escrevendo o código. Etapa 11 de 16: Geração do projeto.\n- Arquivos planejados: 30; já escritos: 10.'
    );
    expect(text).toContain('Etapa 11 de 16');
    expect(text).toContain('já escritos: 10');
    expect(text).not.toMatch(/não tenho acesso/i);
  });
});
