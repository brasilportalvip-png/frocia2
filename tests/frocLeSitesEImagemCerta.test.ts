import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { extractSiteUrl, readSiteAsContext, refersToSite, resolveSiteTarget } from '../server/services/siteReaderService';
import { extractHumanStrings } from '../server/services/externalImportService';
import { routeFrocRequest } from '../shared/frocIntentRouter';
import { classifyFrocMediaVoiceCommand } from '../src/services/voiceCommandService';

describe('A Froc abre o site que a pessoa manda (não adivinha)', () => {
  it('acha o link com ou sem https', () => {
    expect(extractSiteUrl('froc estou fazendo google ads deste site https://www.magiadascrencas.com.br/ preciso de 6 imagens')).toBe('https://www.magiadascrencas.com.br/');
    expect(extractSiteUrl('olha o www.magiadascrencas.com.br e me diz')).toBe('https://www.magiadascrencas.com.br');
    expect(extractSiteUrl('meu site é magiadascrencas.com.br.')).toBe('https://magiadascrencas.com.br');
    expect(extractSiteUrl('o app é https://play.google.com/store/apps/details?id=com.magiadascrencas.app')).toBe('https://play.google.com/store/apps/details?id=com.magiadascrencas.app');
  });

  it('não confunde e-mail, texto comum nem GitHub (que tem leitor próprio)', () => {
    expect(extractSiteUrl('meu email é fulano@gmail.com')).toBeNull();
    expect(extractSiteUrl('quero 6 imagens para o anúncio')).toBeNull();
    expect(extractSiteUrl('https://github.com/dono/repo')).toBeNull();
  });

  it('"entra no site" sem link usa o último link da conversa', () => {
    const history = [
      { role: 'user', content: 'froc estou fazendo google ads deste site https://www.magiadascrencas.com.br/' },
      { role: 'assistant', content: 'Aqui estão 6 criativos...' },
    ];
    for (const fala of ['Entra no site agora e faz o que eu te pedi.', 'Para tudo e analisa o site e fala para mim o que você achou do site.', 'Você verificou o site?', 'Quero saber o novo plano que tem lá no site']) {
      expect(refersToSite(fala)).toBe(true);
      expect(resolveSiteTarget(fala, history)).toBe('https://www.magiadascrencas.com.br/');
    }
    expect(resolveSiteTarget('me conta uma piada', history)).toBeNull();
  });

  it('lê os textos das telas de um site React (planos e preços), não o código', () => {
    const bundle = 'h("span",{className:"block text-[11px] text-white/50 mt-1",children:"Jogo de Tarot com o Cigano \\xB7 1 hora \\xB7 R$ 290"}),h("p",{className:"flex items-center gap-2",children:"Plano Especial: jogo de tarot com profissional"}),x="https://api.exemplo.com/v1",y="Erro ao consultar Cigano Pablo."';
    const texts = extractHumanStrings(bundle);
    expect(texts).toContain('Jogo de Tarot com o Cigano · 1 hora · R$ 290');
    expect(texts).toContain('Plano Especial: jogo de tarot com profissional');
    expect(texts.some((t) => t.includes('text-white') || t.includes('items-center') || t.includes('https://'))).toBe(false);
  });

  it('a conversa recebe o site lido junto com a mensagem', () => {
    const routes = fs.readFileSync(path.resolve(process.cwd(), 'server/routes/aiRoutes.ts'), 'utf8');
    expect(routes).toContain('resolveSiteTarget(sanitizedPrompt, conversationContext.recentMessages)');
    expect(routes).toContain('siteReadContext,');
    // Mesmo quando a frase pede auditoria ("analisa esse site"), os textos das telas também são lidos.
    expect(routes).not.toContain('if (!siteAuditReport) {');
    expect(routes.indexOf('const siteReadPromise')).toBeLessThan(routes.indexOf('if (plan.classification.siteAuditUrl)'));
    const rules = fs.readFileSync(path.resolve(process.cwd(), 'server/ai/contextBuilder.ts'), 'utf8');
    expect(rules).toContain('[SITES E LINKS]');
    expect(rules).toContain('Um marcador por resposta');
  });
});

describe('O verificador e as fontes recebem o site lido', () => {
  it('o site lido entra como fonte e como prova para o verificador (não troca a resposta por "sem acesso")', () => {
    const routes = fs.readFileSync(path.resolve(process.cwd(), 'server/routes/aiRoutes.ts'), 'utf8');
    expect(routes).toContain('if (siteRead.citation && !streamCitations.some(');
    expect(routes).toContain('requiresSearch: enableSearchGrounding && !siteRead.citation,');
    expect(routes.indexOf('if (siteRead.citation && !streamCitations.some(')).toBeLessThan(routes.indexOf('IndependentResponseVerifier.verify({'));
    expect(routes.indexOf('CitationService.filterDirectWebCitations(')).toBeLessThan(routes.indexOf('if (siteRead.citation && !streamCitations.some('));
  });

  it('endereço interno é recusado com o motivo, sem citação e sem inventar', async () => {
    const result = await readSiteAsContext('http://127.0.0.1/admin');
    expect(result.citation).toBeNull();
    expect(result.context).toContain('NÃO CONSEGUI');
    expect(result.context).toContain('Não invente o conteúdo do site.');
  });
});

describe('Reclamação não vira tema de imagem', () => {
  it('"faz a imagem certa, caralho" vai para a conversa (que sabe o tema)', () => {
    for (const fala of ['faz a imagem certa, caralho', 'cria a imagem de novo', 'gera a imagem que eu pedi', 'faça a imagem certo', 'cria a imagem do site']) {
      expect(routeFrocRequest(fala)).toBeNull();
      expect(classifyFrocMediaVoiceCommand(fala)).toBeNull();
    }
  });

  it('pedido de imagem de verdade continua indo direto', () => {
    expect(routeFrocRequest('cria uma imagem de um gato astronauta')).toMatchObject({ mode: 'Imagem' });
    expect(classifyFrocMediaVoiceCommand('crie uma imagem de um gato astronauta')).toMatchObject({ mode: 'Imagem', prompt: 'um gato astronauta' });
  });
});
