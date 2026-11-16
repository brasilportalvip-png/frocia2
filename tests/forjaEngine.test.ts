/**
 * Criador de sites (motor Forja): leitura do streaming, compilação real com React,
 * erros legíveis para a autocorreção e limites de segurança/armazenamento.
 */
import { describe, expect, it } from 'vitest';
import { ArchitectStreamParser } from '../server/forja/streamParser';
import { compileVirtualReactProject } from '../server/forja/bundler';
import { forjaCreditCost, safeGeneratedPath, sanitizeForjaFiles, sanitizeForjaMessages } from '../server/forja/forjaStore';

const INDEX = '<!doctype html><html lang="pt-BR"><head><title>Teste</title><meta name="description" content="x"></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>';

describe('Forja: streaming do arquiteto', () => {
  it('monta os arquivos mesmo com as tags quebradas entre pedaços', () => {
    const text = `<architect_plan>Plano.</architect_plan>\n<file path="src/App.tsx">\nexport default function App(){ return <h1>Froc</h1>; }\n</file>\n<file path="index.html">\n${INDEX}\n</file>\n<summary>Pronto.</summary>`;
    const parser = new ArchitectStreamParser();
    const files: Record<string, string> = {};
    const types: string[] = [];
    const handle = (events: ReturnType<ArchitectStreamParser['push']>) => {
      for (const e of events) {
        types.push(e.type);
        if (e.type === 'file_start') files[e.path] = '';
        if (e.type === 'file_delta') files[e.path] += e.chunk;
      }
    };
    for (let i = 0; i < text.length; i += 5) handle(parser.push(text.slice(i, i + 5)));
    handle(parser.flush());
    expect(Object.keys(files).sort()).toEqual(['index.html', 'src/App.tsx']);
    expect(files['src/App.tsx']).not.toContain('</file>');
    expect(types).toContain('plan_delta');
    expect(types).toContain('summary_delta');
  });
});

describe('Forja: compilação', () => {
  it('compila React + lucide num HTML único pronto para publicar', async () => {
    const r = await compileVirtualReactProject(
      { 'index.html': INDEX, 'src/App.tsx': 'import { Check } from "lucide-react"; export default function App(){ return <h1><Check/>Froc pronto</h1>; }' },
      { withErrorBridge: false },
    );
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.html).toContain('Froc pronto');
    expect(r.html).toContain('cdn.tailwindcss.com');
    expect(r.html).not.toContain('/src/main.tsx');
  }, 30_000);

  it('devolve erros legíveis para a autocorreção', async () => {
    const missing = await compileVirtualReactProject({ 'index.html': INDEX, 'src/App.tsx': 'import X from "./nao-existe"; export default function App(){ return <X/> }' });
    expect(missing.ok).toBe(false);
    expect(missing.errors.join(' ')).toContain('nao-existe');
    const external = await compileVirtualReactProject({ 'index.html': INDEX, 'src/App.tsx': 'import axios from "axios"; export default function App(){ return <p>{String(axios)}</p> }' });
    expect(external.ok).toBe(false);
    expect(external.errors.join(' ')).toContain('não suportado');
  }, 30_000);
});

describe('Forja: limites e segurança', () => {
  it('bloqueia caminhos perigosos e .env', () => {
    expect(safeGeneratedPath('../etc/passwd')).toBeNull();
    expect(safeGeneratedPath('.env')).toBeNull();
    expect(safeGeneratedPath('./src/App.tsx')).toBe('src/App.tsx');
    const r = sanitizeForjaFiles({ 'src/a.ts': 'ok', '../x': 'no', '.env.local': 'SECRET=1', b: 3 });
    expect(r.ok && Object.keys(r.files)).toEqual(['src/a.ts']);
  });

  it('recusa projeto grande demais para o banco', () => {
    expect(sanitizeForjaFiles({ 'a.ts': 'x'.repeat(500_000) }).ok).toBe(false);
  });

  it('guarda só as últimas 40 mensagens e nunca deixa "escrevendo" preso', () => {
    const msgs = sanitizeForjaMessages(Array.from({ length: 60 }, (_, i) => ({ id: `m${i}`, role: i % 2 ? 'assistant' : 'user', content: 'x', phase: 'coding', files: [{ path: 'a', status: 'writing' }] })));
    expect(msgs).toHaveLength(40);
    expect(msgs[1].phase).toBe('done');
    expect(msgs[1].files?.[0].status).toBe('complete');
  });

  it('créditos: 95 para criar, 30 para alterar, ajustável na Vercel', () => {
    expect(forjaCreditCost(true, {})).toBe(95);
    expect(forjaCreditCost(false, {})).toBe(30);
    expect(forjaCreditCost(true, { FORJA_CREDITS_NEW: '0' })).toBe(0);
  });
});

describe('Forja: publicar com link próprio', () => {
  it('cria o projeto na Vercel, publica o index.html e devolve o link fixo', async () => {
    const { createForjaPublisher, vercelProjectName } = await import('../server/forja/forjaPublisher');
    expect(vercelProjectName('Pizzaria Bella São João!', 'AbC123xyz')).toBe('pizzaria-bella-sao-joao-abc123');
    const calls: { url: string; method: string; body?: any }[] = [];
    const reply = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
    let polls = 0;
    const fetchImpl = async (url: string, init: { method?: string; body?: string }) => {
      const method = init.method || 'GET';
      calls.push({ url, method, body: init.body ? JSON.parse(init.body) : undefined });
      if (method === 'GET' && url.includes('/v9/projects/pizzaria-bella-abc123?')) return reply(404, {});
      if (method === 'POST' && url.includes('/v10/projects')) return reply(200, { id: 'prj_1', name: 'pizzaria-bella-abc123' });
      if (method === 'PATCH') return reply(200, {});
      if (method === 'POST' && url.includes('/v13/deployments')) return reply(200, { id: 'dpl_1', readyState: 'BUILDING' });
      if (method === 'GET' && url.includes('/v13/deployments/dpl_1')) return reply(200, { readyState: ++polls > 1 ? 'READY' : 'BUILDING' });
      if (url.includes('/v9/projects/prj_1/domains')) return reply(200, { domains: [{ name: 'pizzaria-bella-abc123.vercel.app' }] });
      return reply(500, { error: 'inesperado ' + url });
    };
    const pub = createForjaPublisher({ token: 't', teamId: 'team_9', fetchImpl, sleep: async () => {} });
    const r = await pub.publish({ projectName: 'pizzaria-bella-abc123', html: '<!doctype html><html><body>oi</body></html>' });
    expect(r).toEqual({ url: 'https://pizzaria-bella-abc123.vercel.app', vercelProjectId: 'prj_1', deploymentId: 'dpl_1' });
    expect(calls.every((c) => c.url.includes('teamId=team_9'))).toBe(true);
    const patch = calls.find((c) => c.method === 'PATCH');
    expect(patch?.body).toMatchObject({ ssoProtection: null });
    const deploy = calls.find((c) => c.url.includes('/v13/deployments') && c.method === 'POST');
    expect(deploy?.body).toMatchObject({ target: 'production', project: 'prj_1', files: [{ file: 'index.html' }] });
  });

  it('sem VERCEL_TOKEN avisa o que configurar', async () => {
    const { createForjaPublisher } = await import('../server/forja/forjaPublisher');
    await expect(createForjaPublisher({}).publish({ projectName: 'x-1', html: '<html></html>' })).rejects.toThrow(/VERCEL_TOKEN/);
  });
});
