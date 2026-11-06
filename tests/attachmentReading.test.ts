import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  ATTACHMENT_ACCEPT,
  canonicalAttachmentMime,
  prepareNativeFiles,
  toAIAttachmentPayloads,
} from '../src/services/attachmentService.js';
import { validateAIAttachments } from '../server/validators/aiAttachmentValidators.js';
import { buildGeminiContents, isTextualAttachmentMime } from '../server/ai/providers/geminiProvider.js';

function payload(name: string, mimeType: string, content: string | Buffer, type: string) {
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
  return {
    type,
    name,
    mimeType,
    data: bytes.toString('base64'),
    sizeBytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

describe('A Froc.IA lê os tipos de arquivo que as pessoas realmente enviam', () => {
  it('o tipo vem da extensão, não do navegador (Windows manda .ts como vídeo)', () => {
    expect(canonicalAttachmentMime('App.ts', 'video/mp2t')).toBe('text/typescript');
    expect(canonicalAttachmentMime('App.tsx', '')).toBe('text/typescript-jsx');
    expect(canonicalAttachmentMime('dados.xml', 'text/xml')).toBe('application/xml');
    expect(canonicalAttachmentMime('config.yaml', 'application/x-yaml')).toBe('text/yaml');
    expect(canonicalAttachmentMime('app.js', 'application/javascript')).toBe('text/javascript');
    expect(canonicalAttachmentMime('index.php', 'application/x-httpd-php')).toBe('text/plain');
    expect(canonicalAttachmentMime('Main.java', 'text/x-java-source')).toBe('text/plain');
    expect(canonicalAttachmentMime('erro.log', '')).toBe('text/plain');
    expect(canonicalAttachmentMime('dados.csv', 'application/vnd.ms-excel')).toBe('text/csv');
  });

  it('áudio, vídeo e foto com tipos alternativos viram o tipo que a IA entende', () => {
    expect(canonicalAttachmentMime('gravacao.m4a', 'audio/x-m4a')).toBe('audio/mp4');
    expect(canonicalAttachmentMime('musica.mp3', 'audio/mp3')).toBe('audio/mpeg');
    expect(canonicalAttachmentMime('voz.wav', 'audio/x-wav')).toBe('audio/wav');
    expect(canonicalAttachmentMime('voz.aac', '')).toBe('audio/aac');
    expect(canonicalAttachmentMime('voz.flac', 'audio/x-flac')).toBe('audio/flac');
    expect(canonicalAttachmentMime('video.mov', 'video/quicktime')).toBe('video/mov');
    expect(canonicalAttachmentMime('foto.HEIC', '')).toBe('image/heic');
    expect(canonicalAttachmentMime('foto.jpg', 'image/jpg')).toBe('image/jpeg');
  });

  it('cada tipo canônico é aceito pelo servidor (antes .ts, .xml, .yaml, .m4a e .mov eram recusados)', () => {
    const cases: Array<[string, string, string]> = [
      ['App.ts', 'video/mp2t', 'code'],
      ['dados.xml', 'text/xml', 'code'],
      ['config.yaml', 'application/x-yaml', 'code'],
      ['app.js', 'application/javascript', 'code'],
      ['index.php', 'application/x-httpd-php', 'code'],
      ['erro.log', '', 'code'],
    ];
    for (const [name, browserType, type] of cases) {
      const mime = canonicalAttachmentMime(name, browserType);
      expect(() => validateAIAttachments([payload(name, mime, 'conteudo de teste', type)])).not.toThrow();
    }
    const media: Array<[string, string, string]> = [
      ['gravacao.m4a', 'audio/x-m4a', 'audio'],
      ['voz.aac', '', 'audio'],
      ['voz.flac', '', 'audio'],
      ['video.mov', 'video/quicktime', 'video'],
      ['foto.heic', '', 'image'],
    ];
    for (const [name, browserType, type] of media) {
      const mime = canonicalAttachmentMime(name, browserType);
      expect(() => validateAIAttachments([payload(name, mime, Buffer.from([1, 2, 3, 4]), type)])).not.toThrow();
    }
  });

  it('um .ts vindo do Windows chega à IA como código, com o nome do arquivo', async () => {
    const [prepared] = await prepareNativeFiles([
      new File(['export const x = 1;\n'], 'servico.ts', { type: 'video/mp2t' }),
    ]);
    const [sent] = toAIAttachmentPayloads([prepared]);
    expect(sent).toMatchObject({ name: 'servico.ts', mimeType: 'text/typescript', type: 'code' });
    expect(() => validateAIAttachments([sent])).not.toThrow();
  });
});

describe('Seletores de arquivo', () => {
  it('mostram Word, Excel, .m4a, .mov e fotos HEIC (antes nem apareciam para escolher)', () => {
    for (const ext of ['.docx', '.xlsx', '.pdf', '.ts', '.log']) expect(ATTACHMENT_ACCEPT.documents).toContain(ext);
    expect(ATTACHMENT_ACCEPT.images).toContain('.heic');
    expect(ATTACHMENT_ACCEPT.audio).toContain('.m4a');
    expect(ATTACHMENT_ACCEPT.video).toContain('.mov');
    expect(ATTACHMENT_ACCEPT.all).toContain('.docx');
    const menu = readFileSync('src/components/AttachmentMenu.tsx', 'utf8');
    expect(menu).toContain('accept={ATTACHMENT_ACCEPT.documents}');
    expect(menu).not.toContain('accept="video/mp4,video/webm"');
  });

  it('imagens que a IA não lê (GIF, BMP, AVIF) são marcadas para conversão', () => {
    expect(canonicalAttachmentMime('meme.gif', 'image/gif')).toBe('image/gif');
    expect(canonicalAttachmentMime('scan.bmp', '')).toBe('image/bmp');
    expect(canonicalAttachmentMime('foto.avif', 'image/avif')).toBe('image/avif');
  });
});

describe('O que a IA recebe de cada anexo', () => {
  it('arquivos de texto viram texto com o nome do arquivo (não inlineData com tipo recusável)', () => {
    const parts = buildGeminiContents('Explique os anexos', [
      { type: 'code', name: 'github-repository.json', mimeType: 'application/json', data: Buffer.from('{"repo":"x"}').toString('base64') },
      { type: 'code', name: 'dados.csv', mimeType: 'text/csv', data: Buffer.from('a,b\n1,2').toString('base64') },
    ]);
    expect(parts.some((p) => p.inlineData)).toBe(false);
    expect(parts[0].text).toContain('[ANEXO 1: github-repository.json | application/json]');
    expect(parts[0].text).toContain('{"repo":"x"}');
    expect(parts[1].text).toContain('dados.csv');
    expect(parts[1].text).toContain('a,b\n1,2');
    expect(parts.at(-1)).toEqual({ text: 'Explique os anexos' });
  });

  it('PDF, imagem, áudio e vídeo continuam como mídia, precedidos do nome', () => {
    const parts = buildGeminiContents('ok', [
      { type: 'document', name: 'contrato.pdf', mimeType: 'application/pdf', data: 'JVBERi0=' },
      { type: 'audio', name: 'nota.m4a', mimeType: 'audio/x-m4a', data: 'AAAA' },
    ]);
    expect(parts[0]).toEqual({ text: '[ANEXO 1: contrato.pdf | application/pdf]' });
    expect(parts[1]).toEqual({ inlineData: { data: 'JVBERi0=', mimeType: 'application/pdf' } });
    expect(parts[3]).toEqual({ inlineData: { data: 'AAAA', mimeType: 'audio/mp4' } });
  });

  it('classifica corretamente o que é texto', () => {
    for (const m of ['text/plain', 'text/csv', 'application/json', 'application/xml', 'text/typescript; charset=utf-8']) {
      expect(isTextualAttachmentMime(m)).toBe(true);
    }
    for (const m of ['application/pdf', 'image/png', 'audio/mpeg', 'video/mp4']) {
      expect(isTextualAttachmentMime(m)).toBe(false);
    }
  });
});
