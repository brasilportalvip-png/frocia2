import net from 'node:net';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { isAllowedDestination, isForbiddenAddress } from '../worker/egress-allowlist.mjs';
import { createEgressProxy } from '../worker/egress-proxy.mjs';
import { browserProxyOptions, proxyEnv } from '../worker/egress-env.mjs';

function connectThrough(port: number, target: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1', () => socket.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`));
    let data = '';
    socket.on('data', chunk => {
      data += chunk.toString();
      if (data.includes('\r\n\r\n')) { socket.destroy(); resolve(data.split('\r\n')[0]); }
    });
    socket.on('error', reject);
  });
}

describe('Allowlist de saida do worker', () => {
  it('libera somente os destinos listados na porta 443', () => {
    expect(isAllowedDestination('generativelanguage.googleapis.com', 443)).toBe(true);
    expect(isAllowedDestination('frocia2.vercel.app', 443)).toBe(true);
    expect(isAllowedDestination('GitHub.com.', 443)).toBe(true);
    expect(isAllowedDestination('example.com', 443)).toBe(false);
    expect(isAllowedDestination('github.com', 80)).toBe(false);
    expect(isAllowedDestination('github.com', 22)).toBe(false);
    expect(isAllowedDestination('evilgithub.com', 443)).toBe(false);
    expect(isAllowedDestination('vercel.app', 443)).toBe(false);
    expect(isAllowedDestination('github.com.evil.io', 443)).toBe(false);
    expect(isAllowedDestination('1.1.1.1', 443)).toBe(false);
    expect(isAllowedDestination('[::1]', 443)).toBe(false);
  });

  it('recusa enderecos internos e de metadados', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.17.0.1', '192.168.0.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', '::ffff:127.0.0.1', 'fd00::1'])
      expect(isForbiddenAddress(ip), ip).toBe(true);
    for (const ip of ['142.250.79.10', '140.82.112.3', '104.16.1.1'])
      expect(isForbiddenAddress(ip), ip).toBe(false);
  });
});

describe('Proxy de saida do worker', () => {
  let server: ReturnType<typeof createEgressProxy> | undefined;
  afterEach(() => new Promise<void>(resolve => (server ? server.close(() => resolve()) : resolve())));

  async function start(lookup: (...args: unknown[]) => Promise<{ address: string; family: number }[]>, connect?: typeof net.connect) {
    server = createEgressProxy({ lookup, ...(connect ? { connect } : {}) } as never);
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', () => resolve()));
    return (server!.address() as AddressInfo).port;
  }

  it('bloqueia destino fora da allowlist sem resolver DNS', async () => {
    let looked = false;
    const port = await start(async () => { looked = true; return [{ address: '93.184.216.34', family: 4 }]; });
    expect(await connectThrough(port, 'example.com:443')).toContain('403');
    expect(await connectThrough(port, '1.1.1.1:443')).toContain('403');
    expect(looked).toBe(false);
  });

  it('bloqueia nome liberado que resolve para endereco interno', async () => {
    const port = await start(async () => [{ address: '169.254.169.254', family: 4 }]);
    expect(await connectThrough(port, 'api.github.com:443')).toContain('502');
  });

  it('abre tunel para destino liberado', async () => {
    const upstream = net.createServer(socket => socket.end());
    await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', () => resolve()));
    const upstreamPort = (upstream.address() as AddressInfo).port;
    const fakeConnect = ((opts: net.NetConnectOpts) => net.connect({ ...(opts as net.TcpNetConnectOpts), host: '127.0.0.1', port: upstreamPort })) as typeof net.connect;
    const port = await start(async () => [{ address: '140.82.112.3', family: 4 }], fakeConnect);
    expect(await connectThrough(port, 'github.com:443')).toBe('HTTP/1.1 200 Connection Established');
    upstream.close();
  });

  it('recusa HTTP em texto puro', async () => {
    const port = await start(async () => []);
    const response = await fetch(`http://127.0.0.1:${port}/`, { headers: { host: 'example.com' } });
    expect(response.status).toBe(403);
  });
});

describe('Repasse do proxy para subprocessos e navegador', () => {
  it('repassa apenas variaveis de proxy', () => {
    expect(proxyEnv({ HTTPS_PROXY: 'http://172.30.0.2:3128', NODE_USE_ENV_PROXY: '1', GEMINI_API_KEY: 'segredo' }))
      .toEqual({ HTTPS_PROXY: 'http://172.30.0.2:3128', NODE_USE_ENV_PROXY: '1' });
  });

  it('configura o Chromium somente quando ha proxy', () => {
    expect(browserProxyOptions({})).toEqual({});
    expect(browserProxyOptions({ HTTPS_PROXY: 'http://172.30.0.2:3128', NO_PROXY: 'localhost' }))
      .toEqual({ proxy: { server: 'http://172.30.0.2:3128', bypass: 'localhost' } });
  });
});
