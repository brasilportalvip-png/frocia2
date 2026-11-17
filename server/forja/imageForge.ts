import { createHash, randomUUID } from 'node:crypto';
import type { GoogleGenAI } from '@google/genai';
import { IMAGE_LOCK_PATH, parseImageLock, parseSiteManifest, type ImageLock, type SiteImageSpec } from './siteKit.js';

/*
 * Fotos ultrarrealistas dos sites da Forja.
 * A IA do site declara as fotos em forja/site.json (id, formato e descrição em inglês); aqui cada
 * foto nova é gerada pelo modelo de imagem do Gemini, salva no Firebase Storage (link público
 * permanente) e anotada em forja/images.lock.json. Em alterações, só fotos novas ou com
 * descrição mudada são geradas de novo.
 */

const PHOTO_STYLE =
  'Ultra-realistic professional photograph. Shot on a full-frame camera with a prime lens, natural cinematic lighting, ' +
  'high dynamic range, rich true-to-life colors and textures, crisp focus with gentle depth of field, premium commercial ' +
  'and editorial quality, as seen in a top advertising campaign. Absolutely no text, letters, words, logos, watermarks, ' +
  'signage, frames or borders anywhere in the image. No identifiable real people or celebrities. Scene: ';

export function imageModels(envVars: Record<string, string | undefined> = process.env): string[] {
  const list = [envVars.FORJA_IMAGE_MODEL, envVars.GEMINI_IMAGE_MODEL, 'gemini-3.1-flash-image', 'gemini-2.5-flash-image']
    .map((m) => String(m || '').trim())
    .filter(Boolean);
  return [...new Set(list)];
}

export function imageHash(spec: SiteImageSpec): string {
  return createHash('sha256').update(spec.aspect + '\n' + spec.prompt).digest('hex').slice(0, 32);
}

/** Fotos que ainda não existem (ou cuja descrição mudou). */
export function pendingImages(files: Record<string, string>): SiteImageSpec[] {
  const manifest = parseSiteManifest(files);
  if (!manifest) return [];
  const lock = parseImageLock(files);
  return manifest.images.filter((img) => lock[img.id]?.hash !== imageHash(img));
}

export interface ImageStore {
  save(objectPath: string, bytes: Buffer, mime: string): Promise<string>;
}

/** Firebase Storage com link de download permanente (não depende das regras do Storage). */
export function firebaseImageStore(bucket: {
  name: string;
  file(path: string): { save(data: Buffer, options: Record<string, unknown>): Promise<unknown> };
}): ImageStore {
  return {
    async save(objectPath, bytes, mime) {
      const token = randomUUID();
      await bucket.file(objectPath).save(bytes, {
        resumable: false,
        contentType: mime,
        metadata: { cacheControl: 'public,max-age=31536000,immutable', metadata: { firebaseStorageDownloadTokens: token } },
      });
      return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(objectPath)}?alt=media&token=${token}`;
    },
  };
}

type ImageClient = Pick<GoogleGenAI, 'models'>;

async function generateOne(ai: ImageClient, models: string[], spec: SiteImageSpec, timeoutMs: number) {
  let lastError: unknown = null;
  for (const model of models) {
    try {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const response = (await Promise.race([
        ai.models.generateContent({
          model,
          contents: [{ role: 'user', parts: [{ text: PHOTO_STYLE + spec.prompt }] }],
          config: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: spec.aspect } } as never,
        }),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('tempo esgotado gerando a foto')), timeoutMs);
        }),
      ]).finally(() => clearTimeout(timer))) as { candidates?: { content?: { parts?: { inlineData?: { data?: string; mimeType?: string } }[] } }[] };
      const parts = response?.candidates?.[0]?.content?.parts || [];
      const inline = parts.find((p) => p?.inlineData?.data)?.inlineData;
      if (inline?.data) return { bytes: Buffer.from(inline.data, 'base64'), mime: inline.mimeType || 'image/png', model };
      lastError = new Error(`o modelo ${model} não devolveu imagem`);
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError ?? new Error('nenhum modelo de imagem respondeu');
}

export interface ForgeImagesResult {
  files: Record<string, string>;
  generated: string[];
  failed: { id: string; reason: string }[];
}

/**
 * Gera as fotos pendentes (em paralelo) e devolve os arquivos com a trava atualizada.
 * Falha de uma foto não derruba o site: o kit mostra um fundo elegante no lugar.
 */
export async function forgeSiteImages(params: {
  ai: ImageClient;
  files: Record<string, string>;
  store: ImageStore;
  ownerId: string;
  models?: string[];
  timeoutMs?: number;
  concurrency?: number;
  onProgress?: (done: number, total: number) => void;
}): Promise<ForgeImagesResult> {
  const pending = pendingImages(params.files);
  const manifest = parseSiteManifest(params.files);
  const keep = new Set((manifest?.images || []).map((i) => i.id));
  const previous = parseImageLock(params.files);
  const lock: ImageLock = {};
  for (const [id, v] of Object.entries(previous)) if (keep.has(id)) lock[id] = v;

  const models = params.models && params.models.length ? params.models : imageModels();
  const generated: string[] = [];
  const failed: { id: string; reason: string }[] = [];
  const queue = [...pending];
  let done = 0;
  const owner = String(params.ownerId || 'anonimo').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) || 'anonimo';

  const worker = async () => {
    for (let spec = queue.shift(); spec; spec = queue.shift()) {
      const hash = imageHash(spec);
      try {
        const img = await generateOne(params.ai, models, spec, params.timeoutMs ?? 75_000);
        if (img.bytes.length < 1000 || img.bytes.length > 25_000_000) throw new Error('arquivo de imagem inválido');
        const ext = /jpe?g/.test(img.mime) ? 'jpg' : /webp/.test(img.mime) ? 'webp' : 'png';
        const url = await params.store.save(`forja-public/${owner}/${spec.id}-${hash.slice(0, 12)}.${ext}`, img.bytes, img.mime);
        lock[spec.id] = { url, hash };
        generated.push(spec.id);
      } catch (e) {
        failed.push({ id: spec.id, reason: String((e as Error)?.message || e).slice(0, 200) });
      }
      done += 1;
      params.onProgress?.(done, pending.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(params.concurrency ?? 4, Math.max(pending.length, 1)) }, worker));

  const files = { ...params.files };
  if (Object.keys(lock).length > 0) files[IMAGE_LOCK_PATH] = JSON.stringify(lock, null, 2);
  else delete files[IMAGE_LOCK_PATH];
  return { files, generated, failed };
}
