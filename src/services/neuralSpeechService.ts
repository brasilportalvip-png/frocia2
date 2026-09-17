import { apiClient } from './apiClient';

interface NeuralSpeechResponse {
  audioBase64: string;
  mimeType: string;
}

export async function createNeuralSpeechAudio(text: string): Promise<{
  audio: HTMLAudioElement;
  objectUrl: string;
}> {
  const result = await apiClient<NeuralSpeechResponse>('/api/ai/speech', {
    method: 'POST',
    body: JSON.stringify({ text }),
  });
  const binary = atob(result.audioBase64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  const objectUrl = URL.createObjectURL(
    new Blob([bytes], { type: result.mimeType || 'audio/wav' })
  );
  return { audio: new Audio(objectUrl), objectUrl };
}
