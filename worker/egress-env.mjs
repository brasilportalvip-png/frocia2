// Repasse das variaveis do proxy de saida para subprocessos e navegador.
export const PROXY_ENV_KEYS = Object.freeze([
  'HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'NO_PROXY', 'no_proxy', 'NODE_USE_ENV_PROXY',
]);

export function proxyEnv(source = process.env) {
  const env = {};
  for (const key of PROXY_ENV_KEYS) if (source[key]) env[key] = source[key];
  return env;
}

// Opcoes do chromium.launch: o Chromium nao le HTTPS_PROXY sozinho.
export function browserProxyOptions(source = process.env) {
  const server = source.HTTPS_PROXY || source.https_proxy;
  if (!server) return {};
  return { proxy: { server, bypass: source.NO_PROXY || source.no_proxy || 'localhost,127.0.0.1' } };
}
