import { describe, expect, it } from 'vitest';
import { routeFrocRequest } from '../shared/frocIntentRouter';
import { decideBargeIn, isLikelyEcho } from '../src/services/voiceBargeIn';

describe('Roteador único da Froc.IA — pedido em qualquer ponto da conversa', () => {
  const topic = 'plano de marketing para padaria';
  const cases: Array<[string, string | null, string?]> = [
    ['crie uma imagem de um gato astronauta', 'Imagem', 'um gato astronauta'],
    ['a gente tava falando de vendas, agora cria uma imagem de um gato astronauta', 'Imagem', 'um gato astronauta'],
    ['estamos falando de marketing e agora cria uma imagem de um logo moderno', 'Imagem', 'um logo moderno'],
    ['legal, me faz uma foto de uma praia ao pôr do sol', 'Imagem', 'uma praia ao pôr do sol'],
    ['quero uma imagem de um carro vermelho', 'Imagem', 'um carro vermelho'],
    ['Froc, gera uma imagem realista de uma floresta', 'Imagem', 'uma floresta'],
    ['desenha um dragão', 'Imagem', 'um dragão'],
    ['me manda uma imagem de um cachorro', 'Imagem', 'um cachorro'],
    ['uma imagem de um leão na savana', 'Imagem', 'um leão na savana'],
    ['faz uma imagem disso', 'Imagem', `Imagem sobre: ${topic}`],
    ['ok, agora crie um vídeo curto mostrando café sendo servido', 'Vídeo', 'café sendo servido'],
    ['quero um vídeo de um cachorro correndo na praia', 'Vídeo', 'um cachorro correndo na praia'],
    ['consegue fazer uma imagem de um bolo de chocolate', 'Imagem', 'um bolo de chocolate'],
    ['crie uma imagem de um pôr do sol', 'Imagem', 'um pôr do sol'],
    ['gere um vídeo sobre uma cidade futurista', 'Vídeo', 'uma cidade futurista'],
    ['cria a imagem de uma floresta', 'Imagem', 'uma floresta'],
    ['pesquise as últimas notícias sobre IA', 'Pesquisa'],
    ['então, faz uma pesquisa sobre preço do dólar', 'Pesquisa'],
    ['o que é uma imagem vetorial', null],
    ['como faço uma foto melhor com celular', null],
    ['analise esta imagem', null],
    ['descreva a foto que te mandei', null],
    ['qual o melhor formato de vídeo para o instagram', null],
    ['eu gosto muito de fotografia', null],
    ['me explica o que você disse sobre vendas', null],
    ['o vídeo que vi ontem era muito bom', null],
    ['quero saber sobre direitos de imagem', null],
    ['desenhe a arquitetura do sistema', null],
    ['explique energia solar', null],
  ];

  it.each(cases)('"%s"', (text, mode, prompt) => {
    const routed = routeFrocRequest(text, { previousTopic: topic });
    expect(routed?.mode ?? null).toBe(mode);
    if (prompt) expect(routed?.prompt).toBe(prompt);
  });

  it('com anexo, "analise" não vira geração de imagem', () => {
    expect(routeFrocRequest('analise esta imagem e me diga o que tem', { hasAttachments: true })).toBeNull();
  });
});

describe('Interrupção em tempo real — ouvir enquanto a Froc fala', () => {
  const spoken = 'Claro! O marketing digital para padarias funciona melhor com fotos dos produtos, promoções semanais e presença no Instagram.';

  it.each([
    ['marketing digital para padarias funciona', false, 'ignore'],
    ['fotos dos produtos promoções', true, 'ignore'],
    ['Instagram', true, 'ignore'],
    ['para', true, 'stop-only'],
    ['Froc, para', false, 'stop-only'],
    ['chega', true, 'stop-only'],
    ['espera aí', true, 'stop-only'],
    ['cria uma imagem de um gato', false, 'interrupt'],
    ['cria uma', false, 'ignore'],
    ['qual o horário de funcionamento', true, 'interrupt'],
    ['abrir preços', true, 'interrupt'],
  ] as const)('"%s" (final=%s) → %s', (heard, isFinal, expected) => {
    expect(decideBargeIn(heard, isFinal, spoken)).toBe(expected);
  });

  it('reconhece o próprio eco da Froc', () => {
    expect(isLikelyEcho('presença no instagram', spoken)).toBe(true);
    expect(isLikelyEcho('quero um vídeo de cachorro', spoken)).toBe(false);
  });
});
