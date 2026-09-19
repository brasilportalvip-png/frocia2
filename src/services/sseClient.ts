import { auth } from '../lib/firebase';
import { ApiClientError } from './apiClient';

export interface SseEvent<T = unknown> {
  event: string;
  data: T;
}

export function parseSseBlock(block: string): SseEvent | null {
  let event = 'message';
  const data: string[] = [];

  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
  }

  if (data.length === 0) return null;

  const rawData = data.join('\n');
  try {
    return { event, data: JSON.parse(rawData) };
  } catch {
    return { event, data: rawData };
  }
}

export async function streamApiEvents(
  endpoint: string,
  body: unknown,
  options: {
    signal?: AbortSignal;
    onEvent: (event: SseEvent) => void;
  }
): Promise<void> {
  if (!auth?.currentUser) {
    throw new ApiClientError(
      'Faça login novamente para conversar com a Froc.IA.',
      401,
      'firebase_user_unavailable'
    );
  }

  const token = await auth.currentUser.getIdToken();
  const response = await fetch(endpoint, {
    method: 'POST',
    signal: options.signal,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok || !response.body) {
    let message = `Erro na transmissão (${response.status}).`;
    try {
      const payload = await response.json();
      message = payload?.error?.message || payload?.error || message;
    } catch {
      // Mantém a mensagem segura quando a resposta não for JSON.
    }
    throw new ApiClientError(message, response.status, 'stream_request_failed');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });

    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() || '';

    for (const block of blocks) {
      const event = parseSseBlock(block);
      if (event) options.onEvent(event);
    }

    if (done) break;
  }

  const finalEvent = parseSseBlock(buffer);
  if (finalEvent) options.onEvent(finalEvent);
}
