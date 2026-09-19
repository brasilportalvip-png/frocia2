import { describe, expect, it } from 'vitest';
import { ResearchLinkIntegrityService } from '../server/ai/researchLinkIntegrityService.js';
import { MessageCitation } from '../server/ai/types/ai.js';

const citation: MessageCitation = {
  title: 'Matéria comprovada',
  uri: 'https://example.com/noticias/fato-confirmado',
  sourceType: 'web',
  domain: 'example.com',
};

describe('ResearchLinkIntegrityService', () => {
  it('preserva somente links exatamente aprovados pelas citações', () => {
    const result = ResearchLinkIntegrityService.enforce(
      'Leia a [matéria](https://example.com/noticias/fato-confirmado) e o [portal](https://outro.example/).',
      [citation]
    );
    expect(result.text).toContain('[matéria](https://example.com/noticias/fato-confirmado)');
    expect(result.text).toContain('e o portal.');
    expect(result.text).not.toContain('outro.example');
    expect(result.removedLinks).toBe(1);
  });

  it('remove links inventados quando nenhuma fonte foi aprovada', () => {
    const result = ResearchLinkIntegrityService.enforce(
      'Segundo o [Veículo](https://veiculo.example/tecnologia/), houve anúncio.',
      []
    );
    expect(result.text).toBe('Segundo o Veículo, houve anúncio.');
    expect(result.removedLinks).toBe(1);
  });

  it('interpreta URLs aprovadas com parênteses sem deixar pontuação quebrada', () => {
    const complexCitation: MessageCitation = {
      ...citation,
      uri: 'https://example.com/article?context=(sc.Default)',
    };
    const result = ResearchLinkIntegrityService.enforce(
      'Fonte: [Westlaw](https://example.com/article?context=(sc.Default)).',
      [complexCitation]
    );
    expect(result.text).toBe(
      'Fonte: [Westlaw](https://example.com/article?context=(sc.Default)).'
    );
    expect(result.removedLinks).toBe(0);
  });

  it('anexa uma lista determinística composta somente por fontes aprovadas', () => {
    const result = ResearchLinkIntegrityService.enforce(
      'Conclusão verificada.',
      [citation],
      { appendVerifiedSources: true }
    );
    expect(result.text).toContain('**Links diretos verificados**');
    expect(result.text).toContain(
      '- [Matéria comprovada](https://example.com/noticias/fato-confirmado)'
    );
  });
});
