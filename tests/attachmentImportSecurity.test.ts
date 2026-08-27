import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

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

    it('revalidates every redirect and blocks a redirect to loopback', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(null, {
          status: 302,
          headers: { Location: 'http://127.0.0.1/metadata' }
        })
      );
      vi.stubGlobal('fetch', fetchMock);

      await expect(
        ExternalImportService.import({
          type: 'url',
          url: 'https://93.184.216.34/public-page'
        })
      ).rejects.toMatchObject({ code: 'private_destination' });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: 'manual' });
    });

    it('stops streaming as soon as the response exceeds the byte limit', async () => {
      const oversizedChunk = new Uint8Array(900_001).fill(65);
      const cancel = vi.fn();
      const body = {
        getReader: () => ({
          read: vi.fn().mockResolvedValueOnce({
            done: false,
            value: oversizedChunk
          }),
          cancel
        })
      };
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          headers: new Headers({ 'Content-Type': 'text/plain' }),
          body
        })
      );

      await expect(
        ExternalImportService.import({
          type: 'url',
          url: 'https://93.184.216.34/large-document'
        })
      ).rejects.toMatchObject({
        code: 'response_too_large',
        status: 413
      });
      expect(cancel).toHaveBeenCalledOnce();
    });

    it('sanitizes executable HTML and returns only inert text', async () => {
      const html = `<!doctype html><html><head><title>Fonte segura</title></head>
        <body><h1>Notícia pública</h1><script>roubarToken()</script>
        <iframe src="https://evil.example"></iframe><p>Conteúdo verificável.</p></body></html>`;
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response(html, {
            status: 200,
            headers: { 'Content-Type': 'text/html; charset=utf-8' }
          })
        )
      );

      const imported = await ExternalImportService.import({
        type: 'url',
        url: 'https://93.184.216.34/article'
      });

      expect(imported.title).toBe('Fonte segura');
      expect(imported.content).toContain('Notícia pública');
      expect(imported.content).toContain('Conteúdo verificável.');
      expect(imported.content).not.toContain('roubarToken');
      expect(imported.content).not.toContain('iframe');
      expect(imported.mimeType).toBe('text/plain');
    });

    it('rejects binary content even when the endpoint responds successfully', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response(new Uint8Array([0, 1, 2, 3]), {
            status: 200,
            headers: { 'Content-Type': 'application/octet-stream' }
          })
        )
      );

      await expect(
        ExternalImportService.import({
          type: 'url',
          url: 'https://93.184.216.34/binary'
        })
      ).rejects.toMatchObject({
        code: 'unsupported_content',
        status: 415
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
