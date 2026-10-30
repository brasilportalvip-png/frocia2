import { describe, expect, it } from 'vitest';
import { isProjectCreationRequest } from '../src/services/projectCreationIntent.js';

describe('pedido de criacao de site ou app no chat', () => {
  it.each([
    'Crie um site para minha pizzaria',
    'Quero um site de pizzaria com cardápio e delivery',
    'Preciso de um app de controle de estoque',
    'Me faz um site para advocacia',
    'Gostaria de um aplicativo de delivery',
    'Pode criar um site pra mim?',
    'Você consegue criar um app de tarefas?',
    'Vamos criar um aplicativo de agenda',
    'Quero criar uma loja virtual de roupas',
    'Por favor, faça uma landing page para meu curso',
    'Crie um site com fotos e vídeos da minha loja',
    'Oi Froc, preciso de um novo site moderno para minha clínica',
  ])('envia ao criador: %s', text => {
    expect(isProjectCreationRequest(text)).toBe(true);
  });

  it.each([
    'Como criar um site?',
    'O que é um aplicativo web?',
    'Qual a diferença entre site e app?',
    'Quero saber como criar um site',
    'Crie uma imagem para o meu site',
    'Faça um resumo do meu site',
    'Crie uma função em Python que soma dois números',
    'Oi, tudo bem?',
    'Preciso de ajuda para criar um site',
  ])('mantem no chat comum: %s', text => {
    expect(isProjectCreationRequest(text)).toBe(false);
  });
});
