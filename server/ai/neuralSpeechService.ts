import { GoogleGenAI } from '@google/genai';

const MAX_SPEECH_CHARACTERS = 5000;
const DEFAULT_MODEL = 'gemini-3.1-flash-tts-preview';
const DEFAULT_VOICE = 'Charon';

export interface NeuralSpeechResult {
  audioBase64: string;
  mimeType: string;
  model: string;
  voice: string;
}

function cleanSpeechText(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/<\/?fala>/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_SPEECH_CHARACTERS);
}

export function buildHumanizedSpeechPrompt(text: string): string {
  const transcript = cleanSpeechText(text);
  if (!transcript) throw new Error('speech_text_empty');
  return [
    'Leia exatamente o conteúdo delimitado ao final, sem acrescentar explicações.',
    'Fale em português brasileiro com voz masculina adulta, natural, calorosa e amigável.',
    'Soa como um amigo próximo conversando com tranquilidade: ritmo humano, entonação acolhedora, pausas discretas e nenhuma voz de locutor ou robô.',
    `<fala>${transcript}</fala>`,
  ].join('\n');
}

export function pcm16ToWavBase64(
  pcmBase64: string,
  sampleRate = 24000,
  channels = 1
): string {
  const pcm = Buffer.from(pcmBase64, 'base64');
  const header = Buffer.alloc(44);
  const blockAlign = channels * 2;
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * blockAlign, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]).toString('base64');
}

export class NeuralSpeechService {
  static async synthesize(text: string): Promise<NeuralSpeechResult> {
    const apiKey = process.env.GEMINI_API_KEY?.trim();
    if (!apiKey) throw new Error('gemini_tts_not_configured');

    const model = process.env.GEMINI_TTS_MODEL?.trim() || DEFAULT_MODEL;
    const voice = process.env.GEMINI_TTS_VOICE?.trim() || DEFAULT_VOICE;
    const ai = new GoogleGenAI({ apiKey });
    const interaction = await ai.interactions.create({
      model,
      input: buildHumanizedSpeechPrompt(text),
      response_format: { type: 'audio' },
      generation_config: {
        speech_config: [{ voice, language: 'pt-BR' }],
      },
    });
    const audio = interaction.output_audio;
    if (!audio?.data) throw new Error('gemini_tts_empty_audio');

    const providerMimeType = audio.mime_type || 'audio/l16';
    const isRawPcm = /(?:l16|pcm)/i.test(providerMimeType);
    return {
      audioBase64: isRawPcm
        ? pcm16ToWavBase64(audio.data, audio.sample_rate || 24000, audio.channels || 1)
        : audio.data,
      mimeType: isRawPcm ? 'audio/wav' : providerMimeType,
      model,
      voice,
    };
  }
}
