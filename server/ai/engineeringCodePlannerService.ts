import crypto from 'node:crypto';
import { RepositoryArchitectureService, RepositorySourceFile } from './repositoryArchitectureService.js';
import { SemanticCodeIntelligenceService } from './semanticCodeIntelligenceService.js';

export interface EngineeringPlanningRequest {
  title: string;
  summary: string;
  hypothesis: string;
  expectedBehavior: string;
  probableFiles: string[];
}

export interface EngineeringCodePlan {
  schemaVersion: 'engineering-code-plan-v1';
  planId: string;
  selectedFiles: string[];
  supportingFiles: string[];
  impactedFiles: string[];
  testFiles: string[];
  relevantSymbols: string[];
  securityFindings: string[];
  rootCauseQuestions: string[];
  requiredEvidence: string[];
  limitations: string[];
}

const MAX_SELECTED = 40;

function terms(input: EngineeringPlanningRequest): string[] {
  const ignored = new Set(['para', 'como', 'com', 'uma', 'que', 'the', 'and', 'from', 'this', 'de', 'do', 'da']);
  return [...new Set(`${input.title} ${input.summary} ${input.hypothesis} ${input.expectedBehavior}`
    .toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .match(/[a-z0-9_$-]{3,}/g)?.filter((term) => !ignored.has(term)) || [])].slice(0, 40);
}

function normalize(value: string): string {
  return value.trim().replaceAll('\\', '/').replace(/^\.\//, '');
}

export class EngineeringCodePlannerService {
  static plan(files: RepositorySourceFile[], request: EngineeringPlanningRequest): EngineeringCodePlan {
    const safeFiles = files.filter((file) => typeof file.content === 'string');
    const architecture = RepositoryArchitectureService.analyze(safeFiles, request.probableFiles);
    const semantic = SemanticCodeIntelligenceService.analyze(
      safeFiles.map((file) => ({ path: file.path, content: file.content || '' }))
    );
    const queryTerms = terms(request);
    const probable = new Set(request.probableFiles.map(normalize));
    const scores = safeFiles.map((file) => {
      const path = normalize(file.path);
      const haystack = `${path}\n${file.content}`.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      let score = probable.has(path) ? 10_000 : 0;
      for (const term of queryTerms) {
        if (path.toLowerCase().includes(term)) score += 80;
        const matches = haystack.split(term).length - 1;
        score += Math.min(matches, 20) * 3;
      }
      if (/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path)) score += 5;
      return { path, score };
    }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));

    const impacted = [...new Set([
      ...architecture.impact.directlyAffected,
      ...architecture.impact.transitivelyAffected,
    ])];
    const selectedFiles = [...new Set([
      ...request.probableFiles.map(normalize),
      ...scores.map((item) => item.path),
      ...impacted,
    ])].filter((path) => safeFiles.some((file) => normalize(file.path) === path)).slice(0, MAX_SELECTED);
    const selectedSet = new Set(selectedFiles);
    const supportingFiles = architecture.modules
      .filter((module) => selectedSet.has(module.path))
      .flatMap((module) => [...module.imports, ...module.dependents])
      .filter((path) => !selectedSet.has(path)).filter((path, index, all) => all.indexOf(path) === index).slice(0, 30);
    const testFiles = [...new Set([...selectedFiles, ...supportingFiles]
      .filter((path) => /(?:^|\/)(?:tests?|e2e|__tests__)(?:\/|$)|\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path)))];
    const relevantSymbols = semantic.symbols
      .filter((symbol) => selectedSet.has(symbol.declaration.path) || queryTerms.some((term) => symbol.name.toLowerCase().includes(term)))
      .map((symbol) => symbol.name).filter((name, index, all) => all.indexOf(name) === index).slice(0, 100);
    const planSeed = JSON.stringify({ request, selectedFiles, supportingFiles, impacted });
    return {
      schemaVersion: 'engineering-code-plan-v1',
      planId: crypto.createHash('sha256').update(planSeed).digest('hex'),
      selectedFiles, supportingFiles, impactedFiles: impacted, testFiles, relevantSymbols,
      securityFindings: semantic.securityFindings.map((finding) => `${finding.severity}:${finding.rule}:${finding.location.path}:${finding.location.line}`),
      rootCauseQuestions: [
        'Qual comportamento reproduz o defeito antes da alteração?',
        'Qual contrato ou invariável foi violado?',
        'Quais consumidores diretos e transitivos podem regredir?',
        'Que evidência diferencia causa raiz de sintoma?',
      ],
      requiredEvidence: ['reprodução antes', 'teste de regressão', 'typecheck', 'lint', 'testes', 'E2E', 'build', 'auditoria', 'diff', 'rollback'],
      limitations: [
        'O plano é estático e precisa ser confirmado pela execução isolada.',
        'Imports dinâmicos, reflexão e resolução específica de bundler podem exigir LSP e execução.',
      ],
    };
  }
}
