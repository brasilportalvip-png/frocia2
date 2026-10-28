import { describe, expect, it } from 'vitest';
import { requestMode } from '../src/services/requestIntent';

describe('Intenção de criação com recursos de mídia', () => {
  it.each([
    'Crie um site para minha loja com imagens dos produtos',
    'Gere um site para minha loja com imagens dos produtos',
    'Cria um app de reservas com fotos dos quartos',
    'Faça um sistema de vendas com vídeo de apresentação',
    'Quero um aplicativo para minha empresa',
    'Preciso de um site para meu restaurante',
    'Por favor, desenvolva um aplicativo com login e banco de dados',
    'Quero criar um site com galeria e pagamento',
    'Crie sites e aplicativos para minha empresa',
  ])('encaminha o projeto completo: %s', prompt => expect(requestMode(prompt)).toBe('Criador de projetos'));
  it('respeita imagem/vídeo como objeto principal e o modo explícito', () => {
    expect(requestMode('Crie uma imagem para meu site')).toBe('Imagem');
    expect(requestMode('Gere um vídeo para meu aplicativo')).toBe('Vídeo');
    expect(requestMode('Crie um site', 'Imagem')).toBe('Imagem');
    expect(requestMode('Pesquise ideias para um site')).toBe('Pesquisa');
    expect(requestMode('Corrija o CSS do meu site')).toBe('Inteligente');
  });
});
