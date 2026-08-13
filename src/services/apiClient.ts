import { auth } from '../lib/firebase';

export interface ApiClientOptions extends RequestInit {
  headers?: Record<string, string>;
}

export class ApiClientError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly correlationId?: string;

  constructor(
    message: string,
    status: number,
    code?: string,
    correlationId?: string
  ) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
    this.correlationId = correlationId;
  }
}

function getErrorDetails(
  payload: any,
  status: number
): {
  message: string;
  code?: string;
  correlationId?: string;
} {
  const error = payload?.error;

  if (typeof error === 'string') {
    return {
      message: error,
      correlationId: payload?.correlationId,
    };
  }

  if (error && typeof error === 'object') {
    return {
      message:
        typeof error.message === 'string'
          ? error.message
          : `Erro na requisição (${status})`,
      code:
        typeof error.code === 'string'
          ? error.code
          : undefined,
      correlationId:
        typeof error.correlationId === 'string'
          ? error.correlationId
          : payload?.correlationId,
    };
  }

  if (typeof payload?.message === 'string') {
    return {
      message: payload.message,
      code:
        typeof payload?.code === 'string'
          ? payload.code
          : undefined,
      correlationId: payload?.correlationId,
    };
  }

  if (typeof payload === 'string' && payload.trim()) {
    return {
      message: payload.trim(),
    };
  }

  if (status === 401) {
    return {
      message:
        'Sessão expirada ou não autorizada. Faça login novamente.',
    };
  }

  if (status === 403) {
    return {
      message:
        'Acesso negado. Você não possui permissão para esta operação.',
    };
  }

  return {
    message: `Erro na requisição (${status})`,
  };
}

async function parseResponseBody(
  response: Response
): Promise<any> {
  if (response.status === 204) {
    return null;
  }

  const rawBody = await response.text();

  if (!rawBody) {
    return null;
  }

  const contentType =
    response.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    try {
      return JSON.parse(rawBody);
    } catch {
      throw new ApiClientError(
        'O servidor retornou uma resposta JSON inválida.',
        response.status
      );
    }
  }

  return rawBody;
}

export async function apiClient<T = any>(
  endpoint: string,
  options: ApiClientOptions = {}
): Promise<T> {
  const headers = new Headers(options.headers);

  if (
    options.body &&
    !(options.body instanceof FormData) &&
    !headers.has('Content-Type')
  ) {
    headers.set('Content-Type', 'application/json');
  }

  if (auth.currentUser) {
    try {
      const token =
        await auth.currentUser.getIdToken();

      headers.set(
        'Authorization',
        `Bearer ${token}`
      );
    } catch {
      throw new ApiClientError(
        'Não foi possível validar sua sessão. Entre novamente.',
        401,
        'firebase_token_unavailable'
      );
    }
  }

  let response: Response;

  try {
    response = await fetch(endpoint, {
      ...options,
      headers,
    });
   } catch (error) {
    if (
      options.signal?.aborted ||
      (
        error instanceof DOMException &&
        error.name === 'AbortError'
      )
    ) {
      throw new ApiClientError(
        'Requisição cancelada pelo usuário.',
        499,
        'request_aborted'
      );
    }

    throw new ApiClientError(
      'Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.',
      0,
      'network_error'
    );
  }

  const payload = await parseResponseBody(response);

  if (!response.ok) {
    const details = getErrorDetails(
      payload,
      response.status
    );

    throw new ApiClientError(
      details.message,
      response.status,
      details.code,
      details.correlationId
    );
  }

  return payload as T;
}



export async function apiClientBlob(
  endpoint: string,
  options: ApiClientOptions = {}
): Promise<Blob> {
  const headers = new Headers(options.headers);

  if (!auth.currentUser) {
    throw new ApiClientError(
      'Faça login novamente para acessar este arquivo.',
      401,
      'firebase_user_unavailable'
    );
  }

  try {
    const token =
      await auth.currentUser.getIdToken();

    headers.set(
      'Authorization',
      `Bearer ${token}`
    );
  } catch {
    throw new ApiClientError(
      'Não foi possível validar sua sessão. Entre novamente.',
      401,
      'firebase_token_unavailable'
    );
  }

  let response: Response;

  try {
    response = await fetch(endpoint, {
      ...options,
      headers,
    });
  } catch (error) {
    if (
      options.signal?.aborted ||
      (
        error instanceof DOMException &&
        error.name === 'AbortError'
      )
    ) {
      throw new ApiClientError(
        'Download cancelado pelo usuário.',
        499,
        'request_aborted'
      );
    }

    throw new ApiClientError(
      'Não foi possível baixar o arquivo.',
      0,
      'network_error'
    );
  }

  if (!response.ok) {
    const payload =
      await parseResponseBody(response);

    const details = getErrorDetails(
      payload,
      response.status
    );

    throw new ApiClientError(
      details.message,
      response.status,
      details.code,
      details.correlationId
    );
  }

  const blob = await response.blob();

  if (
    blob.size === 0 ||
    !blob.type.toLowerCase().startsWith('video/')
  ) {
    throw new ApiClientError(
      'O servidor não retornou um arquivo de vídeo válido.',
      502,
      'invalid_video_blob'
    );
  }

  return blob;
}