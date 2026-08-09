import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import {
  InvalidAIAttachmentError,
  validateAIAttachments
} from '../server/validators/aiAttachmentValidators.js';
import { ExternalImportService } from '../server/services/externalImportService.js';
import {
  ZipInspectionError,
  ZipInspectionService
} from '../src/services/zipInspectionService.js';

function makeTextAttachment(content: string) {
  const bytes = Buffer.from(content, 'utf8');
  return {
    type: 'code' as const,
    name: 'exemplo.ts',
    mimeType: 'text/typescript',
    data: bytes.toString('base64'),
    sizeBytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex')
  };
}

describe('Attachment and Import Security Regression', () => {
  describe('AI attachment integrity', () => {
    it('accepts content with matching size and SHA-256', () => {
      const attachment = makeTextAttachment('export const value = 42;');

      const validated = validateAIAttachments([attachment]);

      expect(validated).toHaveLength(1);
      expect(validated[0].sha256).toBe(attachment.sha256);
    });

    it('rejects a forged SHA-256', () => {
      const attachment = {
        ...makeTextAttachment('conteudo verdadeiro'),
        sha256: '0'.repeat(64)
      };

      expect(() => validateAIAttachments([attachment])).toThrow(
        InvalidAIAttachmentError
      );

      try {
        validateAIAttachments([attachment]);
      } catch (error) {
        expect(error).toBeInstanceOf(InvalidAIAttachmentError);
        expect((error as InvalidAIAttachmentError).issues).toContain(
          'O SHA-256 não corresponde ao conteúdo enviado.'
        );
      }
    });

    it('rejects duplicate content in the same message', () => {
      const attachment = makeTextAttachment('mesmo conteudo');

      expect(() =>
        validateAIAttachments([
          attachment,
          { ...attachment, name: 'duplicado.ts' }
        ])
      ).toThrow(InvalidAIAttachmentError);
    });
  });

  describe('External import SSRF protection', () => {
    it('blocks loopback destinations before performing a fetch', async () => {
      await expect(
        ExternalImportService.import({
          type: 'url',
          url: 'http://127.0.0.1/admin'
        })
      ).rejects.toMatchObject({
        code: 'private_destination'
      });
    });

    it('blocks non-HTTP protocols', async () => {
      await expect(
        ExternalImportService.import({
          type: 'url',
          url: 'file:///etc/passwd'
        })
      ).rejects.toMatchObject({
        code: 'invalid_protocol'
      });
    });

    it('requires github.com for repository imports', async () => {
      await expect(
        ExternalImportService.import({
          type: 'github',
          url: 'https://example.com/usuario/repositorio'
        })
      ).rejects.toMatchObject({
        code: 'invalid_github_host'
      });
    });
  });

  describe('ZIP static inspection', () => {
    it('extracts real text files without executing archive code', () => {
      const archive = zipSync({
        'package.json': strToU8(
          JSON.stringify({
            dependencies: { react: '^19.0.0' },
            devDependencies: { vite: '^6.0.0', typescript: '^5.0.0' }
          })
        ),
        'src/App.tsx': strToU8(
          'export function App() { return <main>Froc.IA</main>; }'
        ),
        '.env.example': strToU8('VITE_API_URL=https://example.com')
      });

      const analysis = ZipInspectionService.inspect({
        fileName: 'projeto.zip',
        contentBase64: Buffer.from(archive).toString('base64')
      });

      expect(analysis.totalEntries).toBe(3);
      expect(analysis.detectedStack).toEqual(
        expect.arrayContaining(['React', 'Vite', 'TypeScript'])
      );
      expect(analysis.envVars).toContain('VITE_API_URL');
      expect(analysis.extractedTextFiles).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: 'src/App.tsx' })
        ])
      );
      expect(analysis.buildStatus).toBe('nao_testado');
      expect(analysis.securityChecks.codeExecuted).toBe(false);
    });

    it('rejects path traversal entries', () => {
      const archive = zipSync({
        '../arquivo-fora.txt': strToU8('conteudo inseguro')
      });

      expect(() =>
        ZipInspectionService.inspect({
          fileName: 'inseguro.zip',
          contentBase64: Buffer.from(archive).toString('base64')
        })
      ).toThrow(ZipInspectionError);
    });

    it('rejects suspicious compression ratios', () => {
      const archive = zipSync({
        'dados.txt': new Uint8Array(500_000)
      });

      expect(() =>
        ZipInspectionService.inspect({
          fileName: 'bomba.zip',
          contentBase64: Buffer.from(archive).toString('base64')
        })
      ).toThrow(ZipInspectionError);
    });
  });
});