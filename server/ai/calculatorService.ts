const MAX_EXPRESSION_LENGTH = 200;
const MAX_ABSOLUTE_RESULT = 1e100;

type Token =
  | { type: 'number'; value: number }
  | { type: 'operator'; value: '+' | '-' | '*' | '/' | '%' | '^' }
  | { type: 'left' }
  | { type: 'right' };

export class CalculatorExpressionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CalculatorExpressionError';
  }
}

function tokenize(expression: string): Token[] {
  const source = expression.trim();
  if (!source || source.length > MAX_EXPRESSION_LENGTH) {
    throw new CalculatorExpressionError('A expressão deve conter entre 1 e 200 caracteres.');
  }

  const tokens: Token[] = [];
  let index = 0;

  while (index < source.length) {
    const char = source[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (/[0-9.]/.test(char)) {
      const match = source.slice(index).match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/);
      if (!match) throw new CalculatorExpressionError('Número inválido na expressão.');
      const value = Number(match[0]);
      if (!Number.isFinite(value)) throw new CalculatorExpressionError('Número fora do limite permitido.');
      tokens.push({ type: 'number', value });
      index += match[0].length;
      continue;
    }
    if ('+-*/%^'.includes(char)) {
      tokens.push({ type: 'operator', value: char as '+' | '-' | '*' | '/' | '%' | '^' });
      index += 1;
      continue;
    }
    if (char === '(') tokens.push({ type: 'left' });
    else if (char === ')') tokens.push({ type: 'right' });
    else throw new CalculatorExpressionError(`Caractere não permitido: ${char}`);
    index += 1;
  }

  return tokens;
}

export class CalculatorService {
  static extractExpression(text: string): string | null {
    const labelled = text.match(/(?:calcule|calcular|quanto (?:é|e)|resultado de)\s*[:=]?\s*([\d\s.,+\-*/%^()eE]+)/i);
    const candidate = labelled?.[1]?.trim().replace(/,(?=\d)/g, '.') || '';
    if (!candidate || !/[+\-*/%^]/.test(candidate) || !/\d/.test(candidate)) return null;
    try {
      this.evaluate(candidate);
      return candidate;
    } catch {
      return null;
    }
  }

  static evaluate(expression: string): number {
    const tokens = tokenize(expression);
    let position = 0;

    const current = () => tokens[position];
    const parsePrimary = (): number => {
      const token = current();
      if (token?.type === 'operator' && (token.value === '+' || token.value === '-')) {
        position += 1;
        const value = parsePrimary();
        return token.value === '-' ? -value : value;
      }
      if (token?.type === 'number') {
        position += 1;
        return token.value;
      }
      if (token?.type === 'left') {
        position += 1;
        const value = parseAdditive();
        if (current()?.type !== 'right') throw new CalculatorExpressionError('Parênteses não balanceados.');
        position += 1;
        return value;
      }
      throw new CalculatorExpressionError('Expressão matemática inválida.');
    };

    const parsePower = (): number => {
      const left = parsePrimary();
      const token = current();
      if (token?.type === 'operator' && token.value === '^') {
        position += 1;
        return Math.pow(left, parsePower());
      }
      return left;
    };

    const parseMultiplicative = (): number => {
      let value = parsePower();
      while (current()?.type === 'operator' && ['*', '/', '%'].includes((current() as { value: string }).value)) {
        const operator = (current() as { value: '*' | '/' | '%' }).value;
        position += 1;
        const right = parsePower();
        if ((operator === '/' || operator === '%') && right === 0) {
          throw new CalculatorExpressionError('Divisão por zero não é permitida.');
        }
        value = operator === '*' ? value * right : operator === '/' ? value / right : value % right;
      }
      return value;
    };

    const parseAdditive = (): number => {
      let value = parseMultiplicative();
      while (current()?.type === 'operator' && ['+', '-'].includes((current() as { value: string }).value)) {
        const operator = (current() as { value: '+' | '-' }).value;
        position += 1;
        const right = parseMultiplicative();
        value = operator === '+' ? value + right : value - right;
      }
      return value;
    };

    const result = parseAdditive();
    if (position !== tokens.length) throw new CalculatorExpressionError('Expressão matemática inválida.');
    if (!Number.isFinite(result) || Math.abs(result) > MAX_ABSOLUTE_RESULT) {
      throw new CalculatorExpressionError('Resultado fora do limite permitido.');
    }
    return Object.is(result, -0) ? 0 : result;
  }
}
