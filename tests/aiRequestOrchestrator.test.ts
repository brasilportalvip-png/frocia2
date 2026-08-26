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
