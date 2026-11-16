import { describe, expect, it } from 'vitest';
import { plainSupportedText } from '../src/services/citationText';

describe('Fontes: o trecho confirmado aparece limpo', () => {
  it('tira negrito e marcadores e corta textos longos', () => {
    expect(plainSupportedText('**Retorno de Lula:** O presidente voltou')).toBe('Retorno de Lula: O presidente voltou');
    expect(plainSupportedText('- item **um**\n- item dois')).toBe('item um item dois');
    const long = plainSupportedText('a'.repeat(400));
    expect(long.length).toBeLessThanOrEqual(220);
    expect(long.endsWith('…')).toBe(true);
  });
});
