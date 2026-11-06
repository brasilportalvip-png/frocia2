// Destinos que o worker pode alcancar pelo proxy de saida (somente HTTPS/443).
// "*.dominio" libera apenas subdominios; o dominio raiz precisa constar separadamente.
// Para liberar um destino novo, inclua-o aqui: o proxy registra cada bloqueio no log.
export const ALLOWED_EGRESS_HOSTS = Object.freeze([
  // GitHub (clone do repositorio)
  'github.com',
  'api.github.com',
  'codeload.github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
  // npm e binarios nativos
  'registry.npmjs.org',
  'nodejs.org',
  // Playwright
  'cdn.playwright.dev',
  'playwright.download.prss.microsoft.com',
  'playwright.azureedge.net',
  // Google / Gemini / Firebase
  'generativelanguage.googleapis.com',
  'firestore.googleapis.com',
  'oauth2.googleapis.com',
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
  'storage.googleapis.com',
  'www.googleapis.com',
  'fonts.googleapis.com',
  '*.googleapis.com',
  'accounts.google.com',
  'www.gstatic.com',
  'fonts.gstatic.com',
  '*.gstatic.com',
  // Site e previews
  'portalvipbrasil.com.br',
  'vercel.com',
  'api.vercel.com',
  '*.vercel.com',
  '*.vercel.app',
]);

export const ALLOWED_EGRESS_PORTS = Object.freeze([443]);

export function normalizeHost(host) {
  return String(host || '').trim().toLowerCase().replace(/\.$/, '');
}

export function isAllowedDestination(host, port, list = ALLOWED_EGRESS_HOSTS) {
  const name = normalizeHost(host);
  if (!name || !ALLOWED_EGRESS_PORTS.includes(Number(port))) return false;
  // IP literal nunca e liberado: a decisao e sempre por nome.
  if (/^[\d.]+$/.test(name) || name.includes(':') || name.startsWith('[')) return false;
  return list.some(entry => {
    const rule = normalizeHost(entry);
    if (rule.startsWith('*.')) {
      const base = rule.slice(2);
      return name.endsWith(`.${base}`) && name.length > base.length + 1;
    }
    return name === rule;
  });
}

// Enderecos internos, de metadados ou reservados: bloqueados mesmo quando o nome e liberado.
export function isForbiddenAddress(address) {
  const ip = String(address || '');
  if (ip.includes(':')) {
    const v6 = ip.toLowerCase();
    if (v6.startsWith('::ffff:')) return isForbiddenAddress(v6.slice(7));
    return v6 === '::' || v6 === '::1' || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6);
  }
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 192 && b === 0)
    || (a === 198 && (b === 18 || b === 19));
}
