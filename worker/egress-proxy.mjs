// Proxy de saida do worker: aceita somente CONNECT para destinos da allowlist.
// Roda em container proprio; o worker fica numa rede sem rota direta para a internet.
import http from 'node:http';
import net from 'node:net';
import dns from 'node:dns/promises';
import { isAllowedDestination, isForbiddenAddress, normalizeHost } from './egress-allowlist.mjs';

const PORT = Number(process.env.EGRESS_PROXY_PORT || 3128);
const CONNECT_TIMEOUT_MS = 15_000;
const IDLE_TIMEOUT_MS = 10 * 60_000;

function log(event) {
  process.stdout.write(`${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`);
}

function parseTarget(value) {
  const match = /^([^:\s/]+|\[[^\]]+\]):(\d{1,5})$/.exec(String(value || ''));
  if (!match) return null;
  return { host: normalizeHost(match[1]), port: Number(match[2]) };
}

export async function resolvePublicAddress(host, lookup = dns.lookup) {
  const results = await lookup(host, { all: true, family: 4 });
  const addresses = results.map(r => r.address);
  if (!addresses.length) throw new Error('dns_empty');
  const forbidden = addresses.find(isForbiddenAddress);
  if (forbidden) throw new Error(`forbidden_address:${forbidden}`);
  return addresses[0];
}

export function createEgressProxy({ lookup = dns.lookup, connect = net.connect } = {}) {
  const server = http.createServer((req, res) => {
    // Apenas tuneis HTTPS; requisicoes HTTP em texto puro nao sao encaminhadas.
    if (req.url === '/health') { res.writeHead(200).end('ok'); return; }
    log({ decision: 'deny', reason: 'plain_http', target: String(req.headers.host || '').slice(0, 200) });
    res.writeHead(403, { 'content-type': 'text/plain' }).end('egress_denied');
  });

  server.on('connect', async (req, clientSocket, head) => {
    clientSocket.on('error', () => {});
    const target = parseTarget(req.url);
    const deny = (reason, code = 403) => {
      log({ decision: 'deny', reason, target: String(req.url).slice(0, 200) });
      clientSocket.end(`HTTP/1.1 ${code} Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`);
    };
    if (!target || !isAllowedDestination(target.host, target.port)) return deny('not_in_allowlist');
    let address;
    try { address = await resolvePublicAddress(target.host, lookup); }
    catch (error) { return deny(String(error.message || 'dns_failed').slice(0, 120), 502); }

    const upstream = connect({ host: address, port: target.port });
    upstream.setTimeout(CONNECT_TIMEOUT_MS, () => upstream.destroy(new Error('connect_timeout')));
    upstream.once('connect', () => {
      upstream.setTimeout(IDLE_TIMEOUT_MS, () => upstream.destroy());
      clientSocket.setTimeout(IDLE_TIMEOUT_MS, () => clientSocket.destroy());
      log({ decision: 'allow', target: `${target.host}:${target.port}`, address });
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head?.length) upstream.write(head);
      upstream.pipe(clientSocket); clientSocket.pipe(upstream);
    });
    upstream.on('error', error => {
      log({ decision: 'error', target: `${target.host}:${target.port}`, reason: String(error.code || error.message).slice(0, 120) });
      if (clientSocket.writable && !clientSocket.destroyed) clientSocket.end('HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n');
    });
    clientSocket.on('close', () => upstream.destroy());
  });
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  createEgressProxy().listen(PORT, '0.0.0.0', () => log({ event: 'listening', port: PORT }));
}
