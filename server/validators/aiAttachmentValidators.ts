import { createHash } from 'node:crypto';
import { z } from 'zod';

const MAX_ATTACHMENT_BYTES = 1_000_000;
const MAX_ATTACHMENTS = 5;
const MAX_TOTAL_BYTES = 1_350_000;

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/json',
  'application/xml',
  'text/plain',
  'text/markdown',
  'text/csv',
  'text/html',
  'text/css',
  'text/javascript',
  'text/typescript',
  'text/typescript-jsx',
  'text/yaml',
  'text/x-sql',
  'text/x-python',
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

const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const SAFE_FILENAME_PATTERN = /^[^\\/:*?"<>|\0]+$/;

const attachmentSchema = z
  .object({
    type: z.enum([
      'image',
      'audio',
      'video',
      'document',
      'code'
    ]),
    name: z
      .string()
      .trim()
      .min(1)
      .max(180)
      .regex(SAFE_FILENAME_PATTERN)
      .refine((name) => !name.includes('..')),
    mimeType: z
      .string()
      .trim()
      .toLowerCase()
      .refine((mimeType) =>
        ALLOWED_MIME_TYPES.has(mimeType)
      ),
    data: z
      .string()
      .min(1)
      .max(Math.ceil(MAX_ATTACHMENT_BYTES / 3) * 4 + 4)
      .regex(BASE64_PATTERN),
    sizeBytes: z
      .number()
      .int()
      .positive()
      .max(MAX_ATTACHMENT_BYTES),
    sha256: z
      .string()
      .trim()
      .toLowerCase()
      .regex(SHA256_PATTERN)
  })
  .superRefine((attachment, context) => {
        const decoded = Buffer.from(attachment.data, 'base64');
    const calculatedSha256 = createHash('sha256')
      .update(decoded)
      .digest('hex');

    if (calculatedSha256 !== attachment.sha256) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sha256'],
        message: 'O SHA-256 não corresponde ao conteúdo enviado.'
      });
    }

    if (decoded.length !== attachment.sizeBytes) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sizeBytes'],
        message:
          'O tamanho declarado não corresponde ao conteúdo enviado.'
      });
    }

    const canonicalInput = attachment.data.replace(/=+$/, '');
    const canonicalDecoded = decoded
      .toString('base64')
      .replace(/=+$/, '');

    if (canonicalInput !== canonicalDecoded) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['data'],
        message: 'O Base64 informado é inválido.'
      });
    }

    if (
      attachment.type === 'image' &&
      !attachment.mimeType.startsWith('image/')
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['mimeType'],
        message: 'O MIME não corresponde a uma imagem.'
      });
    }

    if (
      attachment.type === 'audio' &&
      !attachment.mimeType.startsWith('audio/')
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['mimeType'],
        message: 'O MIME não corresponde a um áudio.'
      });
    }

    if (
      attachment.type === 'video' &&
      !attachment.mimeType.startsWith('video/')
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['mimeType'],
        message: 'O MIME não corresponde a um vídeo.'
      });
    }
  });

const attachmentsSchema = z
  .array(attachmentSchema)
  .max(MAX_ATTACHMENTS)
  .superRefine((attachments, context) => {
    const totalBytes = attachments.reduce(
      (sum, attachment) => sum + attachment.sizeBytes,
      0
    );

    if (totalBytes > MAX_TOTAL_BYTES) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'O conjunto de anexos excede o limite seguro da mensagem.'
      });
    }

    const hashes = new Set<string>();

    for (const attachment of attachments) {
      if (hashes.has(attachment.sha256)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'O mesmo conteúdo foi anexado mais de uma vez.'
        });
        break;
      }

      hashes.add(attachment.sha256);
    }
  });

export interface ValidatedAIAttachment {
  type: 'image' | 'audio' | 'video' | 'document' | 'code';
  name: string;
  mimeType: string;
  data: string;
  sizeBytes: number;
  sha256: string;
}

export class InvalidAIAttachmentError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super('invalid_ai_attachments');
    this.name = 'InvalidAIAttachmentError';
    this.issues = issues;
  }
}

export function validateAIAttachments(
  value: unknown
): ValidatedAIAttachment[] {
  if (value === undefined || value === null) {
    return [];
  }

  const result = attachmentsSchema.safeParse(value);

  if (!result.success) {
    throw new InvalidAIAttachmentError(
      result.error.issues.map((issue) => issue.message)
    );
  }

  return result.data;
}