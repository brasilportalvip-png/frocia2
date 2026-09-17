import { describe, expect, it } from 'vitest';
import { CalculatorExpressionError, CalculatorService } from '../server/ai/calculatorService.js';

describe('CalculatorService', () => {
  it('respeita precedência, parênteses, potência e notação científica', () => {
    expect(CalculatorService.evaluate('2 + 3 * 4')).toBe(14);
    expect(CalculatorService.evaluate('(2 + 3) * 4')).toBe(20);
    expect(CalculatorService.evaluate('2 ^ 3 ^ 2')).toBe(512);
    expect(CalculatorService.evaluate('1.5e2 / 3')).toBe(50);
  });

  it('aceita operadores unários e módulo', () => {
    expect(CalculatorService.evaluate('-5 + +2')).toBe(-3);
    expect(CalculatorService.evaluate('10 % 4')).toBe(2);
  });

  it('bloqueia código, caracteres inválidos e divisão por zero', () => {
    for (const expression of ['process.exit()', '2; 3', '1 / 0', '(2 + 3']) {
      expect(() => CalculatorService.evaluate(expression)).toThrow(CalculatorExpressionError);
    }
  });

  it('bloqueia entradas e resultados fora dos limites', () => {
    expect(() => CalculatorService.evaluate('')).toThrow(CalculatorExpressionError);
    expect(() => CalculatorService.evaluate('9'.repeat(201))).toThrow(CalculatorExpressionError);
    expect(() => CalculatorService.evaluate('10 ^ 101')).toThrow(CalculatorExpressionError);
  });

  it('extrai somente expressões explicitamente solicitadas', () => {
    expect(CalculatorService.extractExpression('Calcule: (25 + 5) * 2')).toBe('(25 + 5) * 2');
    expect(CalculatorService.extractExpression('Quanto é 10,5 / 2?')).toBe('10.5 / 2');
    expect(CalculatorService.extractExpression('Explique juros compostos')).toBeNull();
    expect(CalculatorService.extractExpression('Calcule process.exit()')).toBeNull();
  });
});
