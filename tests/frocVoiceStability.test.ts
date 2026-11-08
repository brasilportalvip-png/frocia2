import { describe, expect, it } from 'vitest';
import { classifyFrocVoiceTranscript, normalizeFrocVoiceCommand } from '../src/services/voiceCommandService';
import { isSilenceCommand, meaningfulWordCount } from '../src/services/voiceBargeIn';

describe('Voz estável — conversa real do dono (08/11)', () => {
  it.each([
    ['Ok, Floki, obrigado.', 'obrigado.'],
    ['OK, Flávio, qual é a previsão em Araraquara do tempo hoje?', 'qual é a previsão em Araraquara do tempo hoje?'],
    ['Silêncio, Frank.', 'Silêncio.'],
    ['Ok, cria de uma vez, proc.', 'Ok, cria de uma vez.'],
    ['Frog, verifica para mim se a alta evolução está ligada no site.', 'verifica para mim se a autoevolução está ligada no site.'],
    ['Ok Froc, abrir preços', 'abrir preços'],
    ['Ok, obrigado.', 'Ok, obrigado.'],
    ['rock and roll é bom', 'rock and roll é bom'],
  ])('"%s" → "%s"', (heard, expected) => {
    expect(normalizeFrocVoiceCommand(heard)).toBe(expected);
  });

  it.each(['OK, Bradesco, encerrar.', 'Froc, encerrar', 'desligar a escuta', 'Froc, pare a escuta'])('"%s" desliga a escuta', (heard) => {
    expect(classifyFrocVoiceTranscript(heard, true, true)).toEqual({ type: 'stop' });
  });

  it('"silêncio" e "chega" não viram pergunta para a IA', () => {
    expect(isSilenceCommand('Silêncio.')).toBe(true);
    expect(isSilenceCommand('chega')).toBe(true);
    expect(isSilenceCommand('qual a previsão do tempo')).toBe(false);
  });

  it('conta palavras de verdade para não interromper por ruído', () => {
    expect(meaningfulWordCount('é')).toBe(0);
    expect(meaningfulWordCount('cria uma imagem')).toBe(3);
  });
});
