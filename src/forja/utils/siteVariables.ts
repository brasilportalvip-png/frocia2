/** Campos da janela "Dados do site", lidos de forja/site.json (declarados pela IA). */
export const SITE_MANIFEST_FILE = 'forja/site.json';
export const SITE_VARIABLES_FILE = 'forja/variables.json';

export type SiteVariableType = 'text' | 'tel' | 'email' | 'url' | 'textarea';

export interface SiteVariableField {
  key: string;
  label: string;
  type: SiteVariableType;
  hint: string;
  /** Valor informado no pedido (sugestão inicial). */
  value: string;
}

const TYPES: SiteVariableType[] = ['text', 'tel', 'email', 'url', 'textarea'];

export function readSiteVariableFields(files: Record<string, string>): SiteVariableField[] {
  const raw = files[SITE_MANIFEST_FILE];
  if (!raw) return [];
  try {
    const data = JSON.parse(raw) as { variables?: unknown };
    const out: SiteVariableField[] = [];
    const seen = new Set<string>();
    for (const item of Array.isArray(data.variables) ? (data.variables as Record<string, unknown>[]) : []) {
      const key = String(item?.key || '').trim().toLowerCase();
      if (!/^[a-z][a-z0-9_]*$/.test(key) || seen.has(key)) continue;
      seen.add(key);
      const type = TYPES.includes(item?.type as SiteVariableType) ? (item.type as SiteVariableType) : 'text';
      out.push({ key, label: String(item?.label || key).slice(0, 80), type, hint: String(item?.hint || '').slice(0, 160), value: String(item?.value || '').slice(0, 500) });
      if (out.length >= 24) break;
    }
    return out;
  } catch {
    // site.json ainda incompleto ou inválido: sem campos por enquanto.
    return [];
  }
}

export function readSiteVariableValues(files: Record<string, string>): Record<string, string> {
  const raw = files[SITE_VARIABLES_FILE];
  if (!raw) return {};
  try {
    const data = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(data || {})) if (typeof v === 'string') out[k] = v;
    return out;
  } catch {
    // Arquivo de dados inválido: começa com os campos vazios.
    return {};
  }
}

/** Valor que vale hoje para cada campo (preenchido > informado no pedido). */
export function effectiveSiteValues(files: Record<string, string>): Record<string, string> {
  const values = readSiteVariableValues(files);
  const out: Record<string, string> = {};
  for (const f of readSiteVariableFields(files)) out[f.key] = values[f.key] ?? f.value;
  return out;
}

export function missingSiteVariables(files: Record<string, string>): number {
  const values = effectiveSiteValues(files);
  return Object.values(values).filter((v) => !v.trim()).length;
}

/** Confere o formato do que foi digitado (mensagem em português ou null se estiver ok). */
export function validateSiteValue(field: SiteVariableField, value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  if (field.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) return 'E-mail inválido.';
  if (field.type === 'tel' && v.replace(/\D/g, '').length < 10) return 'Informe o número com DDD.';
  if (field.type === 'url' && !/^https?:\/\/[^\s.]+\.[^\s]{2,}/i.test(v)) return 'Comece com https://';
  if (/<\s*script/i.test(v)) return 'Texto não permitido.';
  return null;
}
