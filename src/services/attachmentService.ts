import {
  AIAttachmentPayload,
  UploadedFile
} from '../types';
import { unzipSync } from 'fflate';

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

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MAX_OFFICE_UNCOMPRESSED_BYTES = 15_000_000;
const MAX_EXTRACTED_TEXT_BYTES = 750_000;

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
  const extension = extensionOf(file.name);
  if (extension === 'docx') return DOCX_MIME;
  if (extension === 'xlsx') return XLSX_MIME;
  if (extension === 'csv') return 'text/csv';
  if (extension === 'pdf') return 'application/pdf';
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

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_match, code) =>
      String.fromCodePoint(Number(code))
    )
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) =>
      String.fromCodePoint(Number.parseInt(code, 16))
    );
}

function xmlText(value: string): string {
  return decodeXmlEntities(
    value.replace(/<[^>]+>/g, '')
  ).trim();
}

function unzipOfficeDocument(bytes: Uint8Array): Record<string, Uint8Array> {
  let expandedBytes = 0;
  try {
    return unzipSync(bytes, {
      filter(file) {
        expandedBytes += file.originalSize;
        if (expandedBytes > MAX_OFFICE_UNCOMPRESSED_BYTES) {
          throw new AttachmentValidationError(
            'office_expands_too_much',
            'O documento compactado excede o limite seguro de 15 MB após a extração.'
          );
        }
        return true;
      }
    });
  } catch (error) {
    if (error instanceof AttachmentValidationError) throw error;
    throw new AttachmentValidationError(
      'invalid_office_document',
      'O documento Word ou Excel está corrompido ou não possui uma estrutura Open XML válida.'
    );
  }
}

function decodeUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new AttachmentValidationError(
      'invalid_text_encoding',
      'O arquivo de texto não está em UTF-8. Salve-o como UTF-8 e tente novamente.'
    );
  }
}

function limitExtractedText(text: string): string {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length > MAX_EXTRACTED_TEXT_BYTES) {
    throw new AttachmentValidationError(
      'extracted_text_too_large',
      'O texto extraído do documento excede o limite seguro de 750 KB.'
    );
  }
  if (!text.trim()) {
    throw new AttachmentValidationError(
      'document_has_no_text',
      'O documento não contém texto extraível.'
    );
  }
  return text;
}

function extractDocxText(bytes: Uint8Array): string {
  const archive = unzipOfficeDocument(bytes);
  const document = archive['word/document.xml'];
  if (!document) {
    throw new AttachmentValidationError(
      'invalid_docx',
      'O arquivo não contém o documento principal esperado de um DOCX.'
    );
  }
  const xml = decodeUtf8(document)
    .replace(/<w:tab\b[^>]*\/>/g, '\t')
    .replace(/<w:br\b[^>]*\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n');
  return limitExtractedText(xmlText(xml).replace(/\n{3,}/g, '\n\n'));
}

function extractXlsxText(bytes: Uint8Array): string {
  const archive = unzipOfficeDocument(bytes);
  const sharedXml = archive['xl/sharedStrings.xml'];
  const sharedStrings = sharedXml
    ? [...decodeUtf8(sharedXml).matchAll(/<(?:[A-Za-z_][\w.-]*:)?si\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?si>/g)]
        .map((match) => xmlText(match[1]))
    : [];
  const sheets = Object.entries(archive)
    .filter(([path]) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(path))
    .sort(([left], [right]) => left.localeCompare(right, undefined, { numeric: true }));
  if (sheets.length === 0) {
    throw new AttachmentValidationError(
      'invalid_xlsx',
      'O arquivo não contém planilhas legíveis no formato XLSX.'
    );
  }
  const output = sheets.map(([path, content], sheetIndex) => {
    const rows = [...decodeUtf8(content).matchAll(/<(?:[A-Za-z_][\w.-]*:)?row\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?row>/g)]
      .map((row) => [...row[1].matchAll(/<(?:[A-Za-z_][\w.-]*:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?c>)/g)]
        .map((cell) => {
          const body = cell[2] ?? '';
          const value = body.match(/<(?:[A-Za-z_][\w.-]*:)?v\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?v>/)?.[1]
            ?? body.match(/<(?:[A-Za-z_][\w.-]*:)?t\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?t>/)?.[1]
            ?? '';
          if (/\bt=["']s["']/.test(cell[1])) {
            return sharedStrings[Number(value)] ?? '';
          }
          return decodeXmlEntities(value.trim());
        }).join('\t'))
      .join('\n');
    return `Planilha ${sheetIndex + 1} (${path.split('/').at(-1)}):\n${rows}`;
  }).join('\n\n');
  return limitExtractedText(output);
}

function assertPdfSignature(bytes: Uint8Array): void {
  const signature = new TextDecoder('ascii').decode(bytes.subarray(0, 5));
  if (signature !== '%PDF-') {
    throw new AttachmentValidationError(
      'invalid_pdf',
      'O arquivo não possui uma assinatura PDF válida.'
    );
  }
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

  const extension = extensionOf(file.name);
  if (extension === 'doc' || extension === 'xls') {
    throw new AttachmentValidationError(
      'legacy_office_unsupported',
      `O formato “.${extension}” não possui extração segura neste ambiente. Converta para ${extension === 'doc' ? 'DOCX' : 'XLSX'} e tente novamente.`
    );
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
    extension !== 'docx' &&
    extension !== 'xlsx' &&
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
      const originalMimeType = normalizedMimeType(file);
      const extension = extensionOf(file.name);
      if (extension === 'pdf') assertPdfSignature(bytes);
      const extractedText = extension === 'docx'
        ? extractDocxText(bytes)
        : extension === 'xlsx'
          ? extractXlsxText(bytes)
          : isTextFile(file)
            ? limitExtractedText(decodeUtf8(bytes))
            : undefined;
      const convertedOffice = extension === 'docx' || extension === 'xlsx';
      const payloadBytes = convertedOffice
        ? new TextEncoder().encode(extractedText)
        : bytes;
      const mimeType = convertedOffice ? 'text/plain' : originalMimeType;
      const payloadName = convertedOffice ? `${file.name}.txt` : file.name;
      const type = convertedOffice
        ? 'document'
        : uploadedType(mimeType, payloadName);
      const contentBase64 = bytesToBase64(payloadBytes);

      return {
        id: `attachment-${Date.now()}-${index}-${crypto.randomUUID()}`,
        name: payloadName,
        size: payloadBytes.length,
        type,
        status: 'ready',
        progress: 100,
        mime: mimeType,
        hash: await sha256(payloadBytes),
        dataUrl:
          type === 'image'
            ? `data:${mimeType};base64,${contentBase64}`
            : undefined,
        contentBase64,
        contentText: extractedText,
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
  const archive = files.find((file) => file.type === 'zip');
  if (archive) {
    throw new AttachmentValidationError(
      'zip_requires_inspection',
      `O ZIP “${archive.name}” precisa ser inspecionado e convertido em um relatório textual antes de ser enviado à IA.`
    );
  }
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
