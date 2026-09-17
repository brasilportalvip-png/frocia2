import {
  describe,
  expect,
  it,
} from 'vitest';
import { AIRequestClassifier } from '../server/ai/requestClassifier.js';
import {
  AIRequestOrchestrator,
  UnknownAIToolError,
} from '../server/ai/requestOrchestrator.js';
import { SafetyService } from '../server/ai/safetyService.js';
import { ToolRegistry } from '../server/ai/toolRegistry.js';

describe('AI request classification and orchestration', () => {
  it('requires current sources and stronger reasoning for health requests', () => {
    const plan = AIRequestOrchestrator.plan({
      mode: 'smart',
      prompt:
        'Qual é o tratamento atual para esta doença e qual dose devo tomar?',
    });

    expect(plan.classification.domain).toBe('health');
    expect(plan.classification.sensitivity).toBe(
      'high-stakes'
    );
    expect(plan.classification.requiresSearch).toBe(
      true
    );
    expect(plan.route.reasonCode).toBe(
      'high_stakes_reasoning'
    );
    expect(plan.tools.map((tool) => tool.name)).toContain(
      'web_search'
    );
    expect(plan.systemPolicy).toContain(
      'Não apresente diagnóstico'
    );
  });

  it('requires research for temporally unstable information', () => {
    const classification =
      AIRequestClassifier.classify({
        mode: 'smart',
        prompt:
          'Qual é o preço atual deste produto e quem é o CEO hoje?',
      });

    expect(classification.requiresSearch).toBe(true);
    expect(classification.reasons).toContain(
      'current_sources_required'
    );
  });

  it.each([
    'Como você está hoje?',
    'Está tudo bem com você hoje?',
    'Oi, como você vai hoje?',
  ])('não exige pesquisa para conversa social: %s', (prompt) => {
    const plan = AIRequestOrchestrator.plan({ mode: 'smart', prompt });
    expect(plan.classification.requiresSearch).toBe(false);
    expect(plan.tools.map((tool) => tool.name)).not.toContain('web_search');
  });

  it.each([
    'Busque na rede restaurantes abertos agora em Araraquara.',
    'Pesquise na internet as principais notícias de tecnologia.',
    'Qual foi o placar do jogo de hoje?',
    'Compare online os preços deste produto.',
    'Quais são os eventos locais deste fim de semana?',
  ])('ativa pesquisa real para pedidos universais: %s', (prompt) => {
    const plan = AIRequestOrchestrator.plan({ mode: 'smart', prompt });
    expect(plan.classification.requiresSearch).toBe(true);
    expect(plan.tools.map((tool) => tool.name)).toContain('web_search');
    expect(plan.systemPolicy).toContain('Você TEM acesso à pesquisa Google');
  });

  it.each([
    'Usando somente a planilha Excel anexada, informe o valor atual registrado.',
    'Analise apenas o CSV anexado e preserve os valores exatamente.',
    'Use exclusivamente o documento Word anexado e informe a versão.',
    'Analise somente os arquivos contidos no ZIP anexado.',
  ])('prioritizes attachment evidence over web research: %s', (prompt) => {
    const classification = AIRequestClassifier.classify({
      mode: 'research',
      prompt,
      hasFiles: true,
    });

    expect(classification.requiresSearch).toBe(false);
    expect(classification.reasons).toContain(
      'attachment_context_only'
    );
    expect(classification.reasons).not.toContain(
      'current_sources_required'
    );
  });

  it('does not run a site audit after a repository was imported as context', () => {
    const classification = AIRequestClassifier.classify({
      mode: 'research',
      prompt:
        'Analise somente o repositório https://github.com/openai/example.',
      hasFiles: true,
    });

    expect(classification.requiresSearch).toBe(false);
    expect(classification.siteAuditUrl).toBeNull();
  });

  it('selects site engineering and independent verification for a production site', () => {
    const plan = AIRequestOrchestrator.plan({
      mode: 'site-builder',
      prompt:
        'Crie um portal SaaS multiempresa pronto para produção.',
    });

    expect(plan.classification.domain).toBe(
      'site-builder'
    );
    expect(plan.classification.requiresCode).toBe(true);
    expect(
      plan.classification
        .requiresIndependentVerification
    ).toBe(true);
    expect(plan.route.requiredCapabilities.code).toBe(
      true
    );
  });

  it('adds the knowledge-base tool only when a base was selected', () => {
    const plan = AIRequestOrchestrator.plan({
      mode: 'document',
      prompt: 'Resuma os documentos selecionados.',
      hasFiles: true,
      knowledgeBaseIds: ['kb_empresa_a'],
    });

    expect(plan.tools.map((tool) => tool.name)).toContain(
      'search_knowledge_base'
    );
  });

  it('ativa a calculadora para pedidos matemáticos fora do domínio financeiro', () => {
    const plan = AIRequestOrchestrator.plan({
      mode: 'smart',
      prompt: 'Calcule (25 + 5) * 2 para mim.',
    });

    expect(plan.tools.map((tool) => tool.name)).toContain('execute_calculator');
  });

  it('rejects a requested tool that is not registered', () => {
    expect(() =>
      AIRequestOrchestrator.plan({
        mode: 'smart',
        prompt: 'Execute esta tarefa.',
        requestedTools: ['delete_everything'],
      })
    ).toThrow(UnknownAIToolError);
  });

  it('routes large contexts to the reasoning model policy', () => {
    const plan = AIRequestOrchestrator.plan({
      mode: 'smart',
      prompt: 'Analise este contexto.',
      contextSizeEstimate: 9_000,
    });

    expect(plan.classification.complexity).toBe(
      'complex'
    );
    expect(plan.route.reasonCode).toBe(
      'long_context_reasoning'
    );
  });

  it('marks personal identifiers for minimization', () => {
    const classification =
      AIRequestClassifier.classify({
        mode: 'smart',
        prompt:
          'Organize esta lista com CPF, telefone e endereço.',
      });

    expect(classification.sensitivity).toBe(
      'personal-data'
    );
    expect(classification.reasons).toContain(
      'personal_data_minimization_required'
    );
  });

  it('requires a complete operational contract for every registered tool', () => {
    for (const tool of ToolRegistry.listTools()) {
      expect(tool.parameters).toBeDefined();
      expect(tool.outputSchema).toBeDefined();
      expect(tool.authScopes.length).toBeGreaterThan(0);
      expect(tool.timeoutMs).toBeGreaterThan(0);
      expect(tool.maxRetries).toBeGreaterThanOrEqual(0);
      expect(tool.costLimitCredits).toBeGreaterThan(0);
      expect(tool.rateLimit.maxRequests).toBeGreaterThan(0);
      expect(tool.verificationStrategy).toBeDefined();
    }
  });

  it('fails closed for unknown tools and validates web search input', () => {
    expect(
      SafetyService.validateToolCall(
        'unregistered_tool',
        {}
      ).valid
    ).toBe(false);

    expect(
      SafetyService.validateToolCall('web_search', {
        query: 'notícias atuais da empresa',
      }).valid
    ).toBe(true);

    expect(
      SafetyService.validateToolCall('web_search', {
        query: '',
      }).valid
    ).toBe(false);
  });
});
