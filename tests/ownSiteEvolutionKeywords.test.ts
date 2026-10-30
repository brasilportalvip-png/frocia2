import { describe, expect, it } from 'vitest';
import {
  isEvolutionRequest,
  isOwnSiteCapabilityQuestion,
  isOwnSiteRequest,
  requestsOwnSiteAction,
} from '../server/selfEvolution/selfSiteOwnerService.js';

describe('Palavras-chave ampliadas da autoevolucao', () => {
  it.each([
    'Faça uma atualização pela autoevolução',
    'atualize o site pela autoevolução',
    'Execute a autoevolução agora',
    'use a autoevolução para atualizar',
    'Quero uma atualização pela auto evolução',
    'rode o ciclo de manutenção autônoma',
    'peço uma atualização pelo autoevolução',
    'pode executar a autoevolução?',
    'dispare o agente de evolução',
  ])('reconhece pedido de execucao: %s', prompt => {
    expect(isEvolutionRequest(prompt)).toBe(true);
    expect(isOwnSiteRequest(prompt)).toBe(true);
    expect(requestsOwnSiteAction(prompt)).toBe(true);
  });

  it.each([
    'Como funciona a autoevolução?',
    'Qual o status da autoevolução?',
    'A autoevolução executou ontem?',
    'não execute a autoevolução',
    'O que é autoevolução?',
    'verifique se a autoevolução está ativa',
  ])('nao inicia manutencao em pergunta, status ou negativa: %s', prompt => {
    expect(requestsOwnSiteAction(prompt)).toBe(false);
  });

  it.each([
    'Qual o status da autoevolução?',
    'A autoevolução está ativa?',
    'Mostre o último relatório da autoevolução',
  ])('trata status da autoevolucao como consulta real: %s', prompt => {
    expect(isOwnSiteCapabilityQuestion(prompt)).toBe(true);
  });

  it.each([
    'Crie um site de pizzaria',
    'atualize meu site com um botão azul',
    'melhore o texto da página inicial',
    'preciso de manutenção do site da minha loja',
  ])('nao sequestra pedidos comuns de clientes: %s', prompt => {
    expect(isEvolutionRequest(prompt)).toBe(false);
    expect(requestsOwnSiteAction('melhore o texto da página inicial')).toBe(false);
  });
});
