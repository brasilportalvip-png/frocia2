import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { isMediaCreationRequest } from '../shared/frocIntentRouter';

const read = (file: string) => fs.readFileSync(path.resolve(process.cwd(), file), 'utf8');

describe('Correções do relatório do teste completo', () => {
  it('pedido de IMAGEM com "site" na frase não dispara a construção de um site', () => {
    expect(isMediaCreationRequest('cria uma imagem horizontal para o Google Ads desse site')).toBe(true);
    expect(isMediaCreationRequest('faz um banner do meu app')).toBe(true);
    expect(isMediaCreationRequest('faça uma logo para meu site')).toBe(true);
    expect(isMediaCreationRequest('quero um site com imagens de padaria')).toBe(false);
    expect(isMediaCreationRequest('cria um site simples de uma página para uma padaria chamada Pão Quente')).toBe(false);
    expect(isMediaCreationRequest('crie um aplicativo de fotos')).toBe(false);
    expect(read('src/components/ChatCentral.tsx')).toContain('!isMediaCreationRequest(textToSend) &&');
    expect(read('src/App.tsx')).toContain('!isMediaCreationRequest(text) &&');
  });

  it('pesquisa não salva campo undefined no Firestore (quebrava a pesquisa inteira)', () => {
    const research = read('server/ai/researchJobService.ts');
    expect(research).not.toMatch(/supportedText:\s*undefined/);
    expect(read('server/ai/citationService.ts')).toContain('.filter(([, value]) => value !== undefined)');
  });

  it('vídeo usa o Gemini Omni Flash (Veo 3.1 preview foi desligado em 22/10/2026)', () => {
    const media = read('server/routes/mediaRoutes.ts');
    expect(media).toContain("'gemini-omni-1.1-flash'");
    expect(media).toContain("provider: 'omni_interactions'");
    expect(media).toContain('background: true');
    expect(media).toContain('findOmniVideo(interaction)');
    expect(media).not.toContain("'veo-3.1-lite-generate-preview'");
    expect(read('server/services/capabilityRegistryService.ts')).not.toContain("'veo-3.1-lite-generate-preview'");
  });

  it('"digite X no campo nome" não acha a caixa do chat pelo texto digitado nela', () => {
    const actuator = read('src/services/siteDomActuator.ts');
    expect(actuator).toContain('element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement');
    expect(actuator).toMatch(/\^\(\?:submit\|button\|reset\)\$/);
  });
});
