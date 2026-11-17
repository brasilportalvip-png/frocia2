import { SITE_KIT_SOURCE } from './kit/siteKitSource.js';

/** Arquivos do sistema dentro de cada projeto da Forja. */
export const KIT_PATH = 'src/forja/kit.tsx';
export const SITE_MANIFEST_PATH = 'forja/site.json';
export const IMAGE_LOCK_PATH = 'forja/images.lock.json';
/** Dados reais do negócio (WhatsApp, endereço...) que a pessoa preenche na janela "Dados do site". */
export const VARIABLES_PATH = 'forja/variables.json';
/** Arquivos que só o sistema escreve (a IA nunca sobrescreve). */
export const SYSTEM_FILES = [KIT_PATH, IMAGE_LOCK_PATH, VARIABLES_PATH];

export const VARIABLE_TYPES = ['text', 'tel', 'email', 'url', 'textarea'] as const;
export type VariableType = (typeof VARIABLE_TYPES)[number];
export const MAX_SITE_VARIABLES = 24;

export interface SiteVariableSpec {
  key: string;
  label: string;
  type: VariableType;
  hint: string;
  /** Valor que a pessoa já informou no pedido (pré-preenche a janela). */
  value: string;
}

export const IMAGE_ASPECTS = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'] as const;
export type ImageAspect = (typeof IMAGE_ASPECTS)[number];
export const MAX_SITE_IMAGES = 8;

export interface SiteImageSpec {
  id: string;
  aspect: ImageAspect;
  prompt: string;
  alt: string;
}

export interface SiteRoute {
  path: string;
  title: string;
}

export interface SiteManifest {
  brand: string;
  description: string;
  routes: SiteRoute[];
  images: SiteImageSpec[];
  variables: SiteVariableSpec[];
  schemaType: string;
}

export type ImageLock = Record<string, { url: string; hash: string }>;

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Lê forja/site.json (escrito pela IA). Campos inválidos são descartados, nunca quebram o site. */
export function parseSiteManifest(files: Record<string, string>): SiteManifest | null {
  const raw = files[SITE_MANIFEST_PATH];
  if (!raw) return null;
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw);
  } catch {
    // JSON malformado: o site continua, só sem fotos/rotas declaradas.
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  const seenIds = new Set<string>();
  const images: SiteImageSpec[] = [];
  for (const item of Array.isArray(data.images) ? data.images : []) {
    const id = str(item?.id, 40).toLowerCase();
    const prompt = str(item?.prompt, 1500);
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id) || !prompt || seenIds.has(id)) continue;
    const aspect = (IMAGE_ASPECTS as readonly string[]).includes(item?.aspect) ? (item.aspect as ImageAspect) : '16:9';
    seenIds.add(id);
    images.push({ id, aspect, prompt, alt: str(item?.alt, 200) });
    if (images.length >= MAX_SITE_IMAGES) break;
  }
  const routes: SiteRoute[] = [];
  const seenPaths = new Set<string>();
  for (const r of Array.isArray(data.routes) ? data.routes : []) {
    let path = str(r?.path, 80);
    if (!path.startsWith('/')) path = '/' + path;
    path = path.length > 1 ? path.replace(/\/+$/, '') : '/';
    if (!/^\/[a-z0-9\-/]*$/.test(path) || seenPaths.has(path)) continue;
    seenPaths.add(path);
    routes.push({ path, title: str(r?.title, 120) || path });
  }
  if (!seenPaths.has('/')) routes.unshift({ path: '/', title: str(data.brand, 80) || 'Início' });
  const variables: SiteVariableSpec[] = [];
  const seenKeys = new Set<string>();
  for (const v of Array.isArray(data.variables) ? data.variables : []) {
    const key = str(v?.key, 40).toLowerCase();
    if (!/^[a-z][a-z0-9_]*$/.test(key) || seenKeys.has(key)) continue;
    seenKeys.add(key);
    const type = (VARIABLE_TYPES as readonly string[]).includes(v?.type) ? (v.type as VariableType) : 'text';
    variables.push({ key, label: str(v?.label, 80) || key, type, hint: str(v?.hint, 160), value: str(v?.value, 500) });
    if (variables.length >= MAX_SITE_VARIABLES) break;
  }
  const schemaType = /^[A-Za-z]{3,40}$/.test(str(data.schemaType, 40)) ? str(data.schemaType, 40) : 'LocalBusiness';
  return { brand: str(data.brand, 80), description: str(data.description, 300), routes, images, variables, schemaType };
}

export function parseImageLock(files: Record<string, string>): ImageLock {
  const raw = files[IMAGE_LOCK_PATH];
  if (!raw) return {};
  try {
    const data = JSON.parse(raw);
    const out: ImageLock = {};
    for (const [id, v] of Object.entries(data || {})) {
      const url = str((v as { url?: unknown })?.url, 2000);
      if (/^https:\/\//.test(url)) out[id] = { url, hash: str((v as { hash?: unknown })?.hash, 80) };
    }
    return out;
  } catch {
    // Trava de imagens corrompida: as fotos são geradas de novo na próxima construção.
    return {};
  }
}

/** Valores preenchidos na janela "Dados do site" (texto curto, sem HTML). */
export function parseVariableValues(files: Record<string, string>): Record<string, string> {
  const raw = files[VARIABLES_PATH];
  if (!raw) return {};
  try {
    const data = JSON.parse(raw);
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(data || {})) {
      if (/^[a-z][a-z0-9_]*$/.test(k) && typeof v === 'string') out[k] = v.trim().slice(0, 2000);
    }
    return out;
  } catch {
    // Arquivo de dados corrompido: o site continua, com os campos vazios.
    return {};
  }
}

/** Dados que o site usa: o que a pessoa preencheu, senão o que ela informou no pedido. */
export function resolveSiteData(files: Record<string, string>) {
  const manifest = parseSiteManifest(files);
  const values = parseVariableValues(files);
  const vars: Record<string, string> = {};
  for (const v of manifest?.variables || []) vars[v.key] = values[v.key] ?? v.value;
  for (const [k, v] of Object.entries(values)) if (!(k in vars)) vars[k] = v;
  return {
    vars,
    site: { brand: manifest?.brand || '', description: manifest?.description || '', schemaType: manifest?.schemaType || 'LocalBusiness' },
  };
}

/** Código do kit com fotos, dados do negócio e informações da marca já embutidos. */
export function buildSiteKit(lock: ImageLock, data: ReturnType<typeof resolveSiteData> = { vars: {}, site: { brand: '', description: '', schemaType: 'LocalBusiness' } }): string {
  const map: Record<string, string> = {};
  for (const [id, v] of Object.entries(lock)) map[id] = v.url;
  // "<" escapado: um valor digitado não pode fechar o <script> do site.
  const json = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c');
  // Funções de troca: "$&" em URLs/textos não pode ser interpretado como padrão de String.replace.
  return SITE_KIT_SOURCE.replace('__FORJA_IMAGES__', () => json(map))
    .replace('__FORJA_VARS__', () => json(data.vars))
    .replace('__FORJA_SITE__', () => json(data.site));
}

const IMAGE_REF = /(?:\.{0,2}\/)?forja-img\/([a-z0-9][a-z0-9-]*)\.(?:jpe?g|png|webp)/gi;

/** Troca "/forja-img/ID.jpg" pela URL real da foto (no HTML e no código). */
export function resolveImageRefs(text: string, lock: ImageLock): string {
  return text.replace(IMAGE_REF, (match, id: string) => lock[id.toLowerCase()]?.url || match);
}

/** Prepara os arquivos para compilar: injeta o kit do sistema e resolve as fotos. */
export function withSiteKit(files: Record<string, string>): Record<string, string> {
  const lock = parseImageLock(files);
  const out: Record<string, string> = {};
  for (const [path, content] of Object.entries(files)) {
    out[path] = /\.(tsx?|jsx?|html|css)$/i.test(path) && path !== KIT_PATH ? resolveImageRefs(content, lock) : content;
  }
  out[KIT_PATH] = buildSiteKit(lock, resolveSiteData(files));
  return out;
}
