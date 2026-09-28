import { auth } from '../lib/firebase';
import { apiClient } from './apiClient';

interface NeuralSpeechResponse {
  audioBase64: string;
  mimeType: string;
}

const DEFAULT_STREAM_SAMPLE_RATE = 24000;
const DEFAULT_STREAM_CHANNELS = 1;

type BrowserAudioContext = AudioContext & {
  close(): Promise<void>;
};

function getAudioContextConstructor():
  | (new (options?: AudioContextOptions) => BrowserAudioContext)
  | null {
  const browserWindow = window as typeof window & {
    webkitAudioContext?: new (
      options?: AudioContextOptions
    ) => BrowserAudioContext;
  };

  return (
    window.AudioContext ||
    browserWindow.webkitAudioContext ||
    null
  );
}

function mergeBytes(
  first: Uint8Array,
  second: Uint8Array
): Uint8Array {
  const merged = new Uint8Array(
    first.length + second.length
  );

  merged.set(first, 0);
  merged.set(second, first.length);

  return merged;
}

function pcm16LeToFloat32(
  bytes: Uint8Array
): Float32Array {
  const sampleCount =
    Math.floor(bytes.length / 2);

  const samples =
    new Float32Array(sampleCount);

  const view =
    new DataView(
      bytes.buffer,
      bytes.byteOffset,
      sampleCount * 2
    );

  for (
    let index = 0;
    index < sampleCount;
    index += 1
  ) {
    const value =
      view.getInt16(
        index * 2,
        true
      );

    samples[index] =
      value < 0
        ? value / 32768
        : value / 32767;
  }

  return samples;
}

async function getAuthorizationToken(
  forceRefresh = false
): Promise<string> {
  const currentUser =
    auth?.currentUser;

  if (!currentUser) {
    throw new Error(
      'firebase_user_unavailable'
    );
  }

  return currentUser.getIdToken(
    forceRefresh
  );
}

async function openSpeechStream(
  text: string,
  signal?: AbortSignal
): Promise<Response> {
  let token =
    await getAuthorizationToken();

  const request = (
    authorizationToken: string
  ) =>
    fetch(
      '/api/ai/speech/stream',
      {
        method: 'POST',
        signal,
        headers: {
          'Content-Type':
            'application/json',
          Authorization:
            `Bearer ${authorizationToken}`,
        },
        body: JSON.stringify({
          text,
        }),
      }
    );

  let response =
    await request(token);

  if (
    response.status === 401 &&
    !signal?.aborted
  ) {
    token =
      await getAuthorizationToken(
        true
      );

    response =
      await request(token);
  }

  if (!response.ok) {
    throw new Error(
      `neural_speech_stream_http_${response.status}`
    );
  }

  if (!response.body) {
    throw new Error(
      'neural_speech_stream_body_unavailable'
    );
  }

  return response;
}

/**
 * Caminho tradicional.
 *
 * Mantido intacto como fallback.
 */
export async function createNeuralSpeechAudio(
  text: string,
  signal?: AbortSignal
): Promise<{
  audio: HTMLAudioElement;
  objectUrl: string;
}> {
  const result =
    await apiClient<NeuralSpeechResponse>(
      '/api/ai/speech',
      {
        method: 'POST',
        signal,
        body: JSON.stringify({
          text,
        }),
      }
    );

  const binary =
    atob(result.audioBase64);

  const bytes =
    new Uint8Array(
      binary.length
    );

  for (
    let index = 0;
    index < binary.length;
    index += 1
  ) {
    bytes[index] =
      binary.charCodeAt(
        index
      );
  }

  const objectUrl =
    URL.createObjectURL(
      new Blob(
        [bytes],
        {
          type:
            result.mimeType ||
            'audio/wav',
        }
      )
    );

  return {
    audio:
      new Audio(
        objectUrl
      ),
    objectUrl,
  };
}

/**
 * Novo caminho de streaming neural.
 *
 * O áudio PCM começa a ser reproduzido
 * enquanto ainda está chegando do servidor.
 *
 * Se este caminho falhar, o ChatCentral
 * continuará podendo usar
 * createNeuralSpeechAudio() como fallback.
 */
export async function streamNeuralSpeechAudio(
  text: string,
  signal?: AbortSignal
): Promise<void> {
  if (signal?.aborted) {
    throw new DOMException(
      'Operação cancelada.',
      'AbortError'
    );
  }

  const AudioContextConstructor =
    getAudioContextConstructor();

  if (!AudioContextConstructor) {
    throw new Error(
      'web_audio_unavailable'
    );
  }

  const response =
    await openSpeechStream(
      text,
      signal
    );

  const sampleRateValue =
    Number(
      response.headers.get(
        'X-Froc-Audio-Sample-Rate'
      ) ||
        DEFAULT_STREAM_SAMPLE_RATE
    );

  const channelValue =
    Number(
      response.headers.get(
        'X-Froc-Audio-Channels'
      ) ||
        DEFAULT_STREAM_CHANNELS
    );

  const sampleRate =
    Number.isFinite(
      sampleRateValue
    ) &&
    sampleRateValue > 0
      ? sampleRateValue
      : DEFAULT_STREAM_SAMPLE_RATE;

  const channels =
    Number.isInteger(
      channelValue
    ) &&
    channelValue > 0
      ? channelValue
      : DEFAULT_STREAM_CHANNELS;

  if (channels !== 1) {
    throw new Error(
      'unsupported_stream_channel_count'
    );
  }

  const audioContext =
    new AudioContextConstructor({
      sampleRate,
    });

  const reader =
    response.body!
      .getReader();

  const activeSources =
    new Set<
      AudioBufferSourceNode
    >();

  let nextStartTime =
    audioContext.currentTime +
    0.04;

  let remainder =
    new Uint8Array(0);

  let lastSource:
    | AudioBufferSourceNode
    | null = null;

  let aborted =
    false;

  const stopPlayback = () => {
    aborted = true;

    for (
      const source of
      activeSources
    ) {
      try {
        source.stop();
      } catch {
        // O bloco pode já ter terminado.
      }

      try {
        source.disconnect();
      } catch {
        // Ignora desconexão já realizada.
      }
    }

    activeSources.clear();

    void reader.cancel().catch(
      () => undefined
    );

    void audioContext
      .close()
      .catch(
        () => undefined
      );
  };

  const handleAbort = () => {
    stopPlayback();
  };

  signal?.addEventListener(
    'abort',
    handleAbort,
    {
      once: true,
    }
  );

  try {
    if (
      audioContext.state ===
      'suspended'
    ) {
      await audioContext.resume();
    }

    while (true) {
      if (
        aborted ||
        signal?.aborted
      ) {
        throw new DOMException(
          'Operação cancelada.',
          'AbortError'
        );
      }

      const {
        value,
        done,
      } =
        await reader.read();

      if (done) {
        break;
      }

      if (
        !value ||
        value.length === 0
      ) {
        continue;
      }

      let bytes =
        remainder.length > 0
          ? mergeBytes(
              remainder,
              value
            )
          : value;

      if (
        bytes.length % 2 !==
        0
      ) {
        remainder =
          bytes.slice(
            bytes.length - 1
          );

        bytes =
          bytes.slice(
            0,
            bytes.length - 1
          );
      } else {
        remainder =
          new Uint8Array(0);
      }

      if (
        bytes.length === 0
      ) {
        continue;
      }

      const samples =
        pcm16LeToFloat32(
          bytes
        );

      if (
        samples.length === 0
      ) {
        continue;
      }

      const audioBuffer =
        audioContext.createBuffer(
          1,
          samples.length,
          sampleRate
        );

      audioBuffer
        .getChannelData(0)
        .set(samples);

      const source =
        audioContext
          .createBufferSource();

      source.buffer =
        audioBuffer;

      source.connect(
        audioContext.destination
      );

      const scheduledAt =
        Math.max(
          nextStartTime,
          audioContext.currentTime +
            0.01
        );

      source.start(
        scheduledAt
      );

      nextStartTime =
        scheduledAt +
        audioBuffer.duration;

      activeSources.add(
        source
      );

      lastSource =
        source;

      source.onended =
        () => {
          activeSources.delete(
            source
          );

          try {
            source.disconnect();
          } catch {
            // Já desconectado.
          }
        };
    }

    if (
      aborted ||
      signal?.aborted
    ) {
      throw new DOMException(
        'Operação cancelada.',
        'AbortError'
      );
    }

    /*
     * O servidor já terminou de enviar,
     * mas ainda pode existir áudio
     * agendado no Web Audio.
     */
    if (lastSource) {
      const remainingSeconds =
        Math.max(
          0,
          nextStartTime -
            audioContext.currentTime
        );

      if (
        remainingSeconds > 0
      ) {
        await new Promise<void>(
          (resolve) => {
            const timeout =
              window.setTimeout(
                resolve,
                Math.ceil(
                  remainingSeconds *
                    1000
                ) + 60
              );

            const previousOnEnded =
              lastSource!.onended;

            lastSource!.onended =
              (event) => {
                if (
                  typeof previousOnEnded ===
                  'function'
                ) {
                  previousOnEnded.call(
                    lastSource,
                    event
                  );
                }

                window.clearTimeout(
                  timeout
                );

                resolve();
              };
          }
        );
      }
    }
  } finally {
    signal?.removeEventListener(
      'abort',
      handleAbort
    );

    activeSources.clear();

    if (
      audioContext.state !==
      'closed'
    ) {
      await audioContext
        .close()
        .catch(
          () => undefined
        );
    }
  }
}