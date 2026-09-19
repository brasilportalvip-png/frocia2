import { describe, expect, it } from 'vitest';
import { parseSseBlock } from '../src/services/sseClient.js';

describe('cliente SSE', () => {
  it('interpreta tokens e eventos concluídos', () => {
    expect(parseSseBlock('event: token\ndata: {"text":"Olá"}')).toEqual({
      event: 'token',
      data: { text: 'Olá' },
    });
    expect(parseSseBlock('event: completed\ndata: {"executionId":"exec-1"}')).toEqual({
      event: 'completed',
      data: { executionId: 'exec-1' },
    });
  });

  it('preserva dados textuais e ignora blocos sem data', () => {
    expect(parseSseBlock('event: aviso\ndata: texto')).toEqual({
      event: 'aviso',
      data: 'texto',
    });
    expect(parseSseBlock(': keep-alive')).toBeNull();
  });
});
