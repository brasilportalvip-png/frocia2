import { describe, expect, it } from 'vitest';
import { isProjectEditRequest } from '../src/services/projectEditIntent';

describe('isProjectEditRequest', () => {
  it.each([
    'mude o título para Caça Fantasmas SP',
    'troque a cor do botão para verde',
    'adicione uma seção de preços',
    'remova o rodapé',
    'deixe o fundo mais escuro',
  ])('reconhece pedido de alteração: %s', (text) => {
    expect(isProjectEditRequest(text)).toBe(true);
  });

  it.each([
    'o que me diz deste site a qualidade',
    'como eu mudo a cor do botão?',
    'analise o site e diga os problemas',
    'este que esta sendo editado caça fantasma ne',
    'oi',
  ])('mantém na conversa: %s', (text) => {
    expect(isProjectEditRequest(text)).toBe(false);
  });
});
