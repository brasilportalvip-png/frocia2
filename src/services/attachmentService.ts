import {
  AIAttachmentPayload,
  UploadedFile
} from '../types';

export const MAX_DIRECT_ATTACHMENT_BYTES = 1_000_000;
export const MAX_DIRECT_ATTACHMENTS = 5;
export const MAX_DIRECT_PAYLOAD_BYTES = 1_350_000;
export const MAX_ZIP_INSPECTION_BYTES = 10_000_000;

const TEXT_EXTENSIONS = new Set([
  'txt',
  'md',
  'markdown',
  'csv',
  'json',
  'html',
  'htm',
  'css',
  'js',
  'jsx',
  'ts',
  'tsx',
  'sql',
  'py',
  'java',
  'go',
  'rs',
  'php',
  'rb',
  'xml',
  'yaml',
  'yml',
  'toml',
  'ini',
  'env'
]);

const DIRECT_BINARY_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'audio/mpeg',
  'audio/mp4',
  'audio/ogg',
  'audio/webm',
  'audio/wav',
  'video/mp4',
  'video/webm'
]);

export class AttachmentValidationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'AttachmentValidationError';
    this.code = code;
  }
}

function extensionOf(filename: string): string {
  const parts = filename.toLowerCase().split('.');
  return parts.length > 1 ? parts.at(-1) ?? '' : '';
}

function isZipFile(file: File): boolean {
  return (
    file.type === 'application/zip' ||
    extensionOf(file.name) === 'zip'
  );
}

function isTextFile(file: File): boolean {
  return (
    file.type.startsWith('text/') ||
    TEXT_EXTENSIONS.has(extensionOf(file.name))
  );
}

function normalizedMimeType(file: File): string {
  if (file.type) {
    return file.type.toLowerCase();
  }

  if (isTextFile(file)) {
    return 'text/plain';
  }

  if (isZipFile(file)) {
    return 'application/zip';
  }

  return 'application/octet-stream';
}

function uploadedType(
  mimeType: string,
  filename: string
): UploadedFile['type'] {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType.startsWith('video/')) return 'video';
  if (
    mimeType === 'application/zip' ||
    extensionOf(filename) === 'zip'
  ) {
    return 'zip';
  }
  if (TEXT_EXTENSIONS.has(extensionOf(filename))) {
    return 'code';
  }
  return 'document';
}

function apiType(file: UploadedFile): AIAttachmentPayload['type'] {
  if (file.type === 'image' || file.type === 'camera') {
    return 'image';
  }
  if (file.type === 'audio') return 'audio';
  if (file.type === 'video') return 'video';
  if (file.type === 'code') return 'code';
  return 'document';
}

function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = '';

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function textToBase64(value: string): string {
  return bytesToBase64(new TextEncoder().encode(value));
}

async function sha256(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new AttachmentValidationError(
      'crypto_unavailable',
      'O navegador não oferece a criptografia necessária para validar o arquivo.'
    );
  }

  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    bytes
  );

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function assertSafeFilename(filename: string): void {
  const normalized = filename.trim();

  if (
    !normalized ||
    normalized.length > 180 ||
    normalized.includes('\0') ||
    normalized.includes('..') ||
    /[\\/:*?"<>|]/.test(normalized)
  ) {
    throw new AttachmentValidationError(
      'invalid_filename',
      `O nome do arquivo “${filename}” não é permitido.`
    );
  }
}

function assertSupportedFile(file: File): void {
  assertSafeFilename(file.name);

  if (file.size <= 0) {
    throw new AttachmentValidationError(
      'empty_file',
      `O arquivo “${file.name}” está vazio.`
    );
  }

  if (isZipFile(file)) {
    if (file.size > MAX_ZIP_INSPECTION_BYTES) {
      throw new AttachmentValidationError(
        'zip_too_large',
        `O ZIP “${file.name}” excede o limite de 10 MB para inspeção local.`
      );
    }
    return;
  }

  if (file.size > MAX_DIRECT_ATTACHMENT_BYTES) {
    throw new AttachmentValidationError(
      'file_too_large',
      `O arquivo “${file.name}” excede o limite de 1 MB para envio direto à IA.`
    );
  }

  const mimeType = normalizedMimeType(file);

  if (
    !isTextFile(file) &&
    !DIRECT_BINARY_MIME_TYPES.has(mimeType)
  ) {
    throw new AttachmentValidationError(
      'unsupported_file_type',
      `O formato de “${file.name}” ainda não é aceito para análise direta.`
    );
  }
}

export async function prepareNativeFiles(
  files: File[]
): Promise<UploadedFile[]> {
  if (files.length === 0) {
    return [];
  }

  if (files.length > MAX_DIRECT_ATTACHMENTS) {
    throw new AttachmentValidationError(
      'too_many_files',
      `Envie no máximo ${MAX_DIRECT_ATTACHMENTS} arquivos por mensagem.`
    );
  }

  files.forEach(assertSupportedFile);

  const directTotal = files
    .filter((file) => !isZipFile(file))
    .reduce((sum, file) => sum + file.size, 0);

  if (directTotal > MAX_DIRECT_PAYLOAD_BYTES) {
    throw new AttachmentValidationError(
      'payload_too_large',
      'O conjunto de arquivos excede o limite seguro de envio. Reduza a quantidade ou o tamanho.'
    );
  }

  return Promise.all(
    files.map(async (file, index) => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const mimeType = normalizedMimeType(file);
      const type = uploadedType(mimeType, file.name);
      const contentBase64 = bytesToBase64(bytes);
      const contentText = isTextFile(file)
        ? new TextDecoder('utf-8', { fatal: false }).decode(bytes)
        : undefined;

      return {
        id: `attachment-${Date.now()}-${index}-${crypto.randomUUID()}`,
        name: file.name,
        size: file.size,
        type,
        status: 'ready',
        progress: 100,
        mime: mimeType,
        hash: await sha256(bytes),
        dataUrl:
          type === 'image'
            ? `data:${mimeType};base64,${contentBase64}`
            : undefined,
        contentBase64,
        contentText,
        relativePath:
          file.webkitRelativePath || undefined,
        lastModified: file.lastModified,
        source: 'local'
      } satisfies UploadedFile;
    })
  );
}

export async function createTextAttachment(input: {
  name: string;
  content: string;
  mimeType?: string;
  source: UploadedFile['source'];
  type?: UploadedFile['type'];
}): Promise<UploadedFile> {
  assertSafeFilename(input.name);

  const content = input.content;
  const bytes = new TextEncoder().encode(content);

  if (bytes.length === 0) {
    throw new AttachmentValidationError(
      'empty_content',
      'O conteúdo não pode ficar vazio.'
    );
  }

  if (bytes.length > MAX_DIRECT_ATTACHMENT_BYTES) {
    throw new AttachmentValidationError(
      'content_too_large',
      'O conteúdo excede o limite de 1 MB.'
    );
  }

  return {
    id: `attachment-${Date.now()}-${crypto.randomUUID()}`,
    name: input.name,
    size: bytes.length,
    type: input.type ?? 'code',
    status: 'ready',
    progress: 100,
    mime: input.mimeType ?? 'text/plain',
    hash: await sha256(bytes),
    contentText: content,
    contentBase64: bytesToBase64(bytes),
    source: input.source
  };
}

export async function createDataUrlAttachment(input: {
  name: string;
  dataUrl: string;
  source: 'camera' | 'microphone' | 'screen';
  type: 'camera' | 'audio' | 'screen';
}): Promise<UploadedFile> {
  assertSafeFilename(input.name);

  const commaIndex = input.dataUrl.indexOf(',');
  const metadata =
    commaIndex > 5
      ? input.dataUrl.slice(5, commaIndex)
      : '';

  const metadataParts = metadata
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean);

  const mimeType =
    metadataParts.shift()?.toLowerCase() || '';

  const isBase64 = metadataParts.some(
    (part) => part.toLowerCase() === 'base64'
  );

  const contentBase64 =
    commaIndex >= 0
      ? input.dataUrl
          .slice(commaIndex + 1)
          .replace(/\s/g, '')
      : '';

  const validBase64 =
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      contentBase64
    );

  if (
    !input.dataUrl.startsWith('data:') ||
    commaIndex <= 5 ||
    !mimeType ||
    !isBase64 ||
    !validBase64
  ) {
    throw new AttachmentValidationError(
      'invalid_data_url',
      'O conteúdo capturado está em um formato inválido.'
    );
  }

  const bytes = base64ToBytes(contentBase64);

  if (
    bytes.length === 0 ||
    bytes.length > MAX_DIRECT_ATTACHMENT_BYTES
  ) {
    throw new AttachmentValidationError(
      'captured_file_too_large',
      'A captura está vazia ou excede o limite de 1 MB.'
    );
  }

  if (!DIRECT_BINARY_MIME_TYPES.has(mimeType)) {
    throw new AttachmentValidationError(
      'unsupported_capture_type',
      'O formato da captura não é aceito.'
    );
  }

  return {
    id: `attachment-${Date.now()}-${crypto.randomUUID()}`,
    name: input.name,
    size: bytes.length,
    type: input.type,
    status: 'ready',
    progress: 100,
    mime: mimeType,
    hash: await sha256(bytes),
    dataUrl: input.dataUrl,
    contentBase64,
    source: input.source
  };
}


export function toAIAttachmentPayloads(
  files: UploadedFile[]
): AIAttachmentPayload[] {
  const directFiles = files.filter((file) => file.type !== 'zip');

  if (directFiles.length > MAX_DIRECT_ATTACHMENTS) {
    throw new AttachmentValidationError(
      'too_many_files',
      `Envie no máximo ${MAX_DIRECT_ATTACHMENTS} arquivos por mensagem.`
    );
  }

  const payloads = directFiles.map((file) => {
    if (
      file.status !== 'ready' ||
      !file.contentBase64 ||
      !file.mime ||
      !file.hash
    ) {
      throw new AttachmentValidationError(
        'attachment_not_ready',
        `O anexo “${file.name}” não está pronto para envio.`
      );
    }

    return {
      type: apiType(file),
      name: file.name,
      mimeType: file.mime,
      data: file.contentBase64,
      sizeBytes: file.size,
      sha256: file.hash
    };
  });

  const totalBytes = payloads.reduce(
    (sum, payload) => sum + payload.sizeBytes,
    0
  );

  if (totalBytes > MAX_DIRECT_PAYLOAD_BYTES) {
    throw new AttachmentValidationError(
      'payload_too_large',
      'Os anexos excedem o limite seguro desta mensagem.'
    );
  }

  return payloads;
}

export function textContentAsBase64(value: string): string {
  return textToBase64(value);
}