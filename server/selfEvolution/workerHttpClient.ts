import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;

/** Uma geracao/teste pode ficar minutos sem enviar headers. O prazo e o do
 * executor inteiro; o limite implicito de 300 s do fetch nao deve encurta-lo. */
export class WorkerHttpClient {
  static async postJson(url: string, input: {
    headers: Record<string, string>; body: string; signal: AbortSignal;
  }): Promise<Response> {
    const target = new URL(url);
    if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) {
      throw new Error('worker_transport_url_invalid');
    }
    return new Promise((resolve, reject) => {
      const request = target.protocol === 'https:' ? httpsRequest : httpRequest;
      const req = request(target, {
        method: 'POST', agent: false, signal: input.signal,
        headers: { ...input.headers, 'Content-Length': Buffer.byteLength(input.body) },
      }, res => {
        const chunks: Buffer[] = []; let size = 0;
        res.on('data', chunk => {
          const bytes = Buffer.from(chunk); size += bytes.length;
          if (size > MAX_RESPONSE_BYTES) {
            const error = new Error('worker_response_too_large');
            reject(error); res.destroy(error); req.destroy(error);
          } else chunks.push(bytes);
        });
        res.once('error', reject);
        res.once('aborted', () => reject(new Error('worker_response_aborted')));
        res.once('end', () => {
          const status = res.statusCode || 502;
          const headers = new Headers();
          for (const [name, value] of Object.entries(res.headers)) {
            if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
          }
          try {
            resolve(new Response([204, 205, 304].includes(status) ? null : Buffer.concat(chunks), { status, headers }));
          } catch (error) { reject(error); }
        });
      });
      req.once('error', reject);
      req.end(input.body);
    });
  }
}
