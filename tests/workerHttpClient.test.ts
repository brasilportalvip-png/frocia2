import { createServer, type Server, type RequestListener } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { WorkerHttpClient } from '../server/selfEvolution/workerHttpClient.js';

describe('Transporte real da chamada longa do worker', () => {
  const servers: Server[] = [];
  const timers: ReturnType<typeof setTimeout>[] = [];
  afterEach(async () => {
    for (const timer of timers.splice(0)) clearTimeout(timer);
    await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => {
      server.closeAllConnections(); server.close(() => resolve());
    })));
  });
  async function listen(handler: RequestListener) {
    const server = createServer(handler); servers.push(server);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  }
  const post = (url: string, timeoutMs = 2000) => WorkerHttpClient.postJson(url, {
    body: '{"candidateId":"test"}', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer private-test-value' },
    signal: AbortSignal.timeout(timeoutMs),
  });

  it('aguarda headers atrasados e conserva corpo UTF-8 e assinatura exatos', async () => {
    const raw = JSON.stringify({ message: 'Correção da página' });
    const url = await listen((req, res) => {
      expect(req.headers.authorization).toBe('Bearer private-test-value');
      timers.push(setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'application/json', 'x-frocia-worker-signature': 'sha256=example' });
        res.end(raw);
      }, 80));
    });
    const response = await post(url);
    expect(response.ok).toBe(true);
    expect(response.headers.get('x-frocia-worker-signature')).toBe('sha256=example');
    expect(await response.text()).toBe(raw);
  });

  it('encerra a espera no prazo configurado, mesmo sem headers', async () => {
    const url = await listen(() => undefined);
    await expect(post(url, 25)).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('aplica o mesmo prazo ao recebimento do corpo', async () => {
    const url = await listen((_req, res) => { res.writeHead(200); res.write('{'); });
    await expect(post(url, 25)).rejects.toBeDefined();
  });

  it('nao segue redirect nem envia a credencial ao destino indicado', async () => {
    let redirected = 0;
    const url = await listen((req, res) => {
      if (req.url === '/second') { redirected++; res.end('unexpected'); }
      else { res.writeHead(307, { Location: '/second' }); res.end(); }
    });
    expect((await post(url)).status).toBe(307);
    expect(redirected).toBe(0);
  });

  it('informa conexao interrompida e recusa resposta acima do limite', async () => {
    const closed = await listen((_req, res) => res.destroy());
    await expect(post(closed)).rejects.toBeDefined();
    const large = await listen((_req, res) => res.end(Buffer.alloc(16 * 1024 * 1024 + 1, 'x')));
    await expect(post(large)).rejects.toThrow('worker_response_too_large');
  });
});
