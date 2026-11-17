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
    expect(r).toEqual({ url: 'https://pizzaria-bella-abc123.vercel.app', vercelProjectId: 'prj_1', deploymentId: 'dpl_1', teamId: 'team_9' });
    expect(calls.every((c) => c.url.includes('teamId=team_9'))).toBe(true);
    const patch = calls.find((c) => c.method === 'PATCH');
    expect(patch?.body).toMatchObject({ ssoProtection: null });
    const deploy = calls.find((c) => c.url.includes('/v13/deployments') && c.method === 'POST');
    expect(deploy?.body).toMatchObject({ target: 'production', project: 'prj_1', files: [{ file: 'index.html' }] });
  });

  const reply = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
  const html = '<!doctype html><html><body>oi</body></html>';
  const happy = (overrides: (url: string, method: string) => any) => async (url: string, init: { method?: string }) => {
    const method = init.method || 'GET';
    const o = overrides(url, method);
    if (o) return o;
    if (method === 'GET' && /\/v9\/projects\/site-1(\?|$)/.test(url)) return reply(404, {});
    if (method === 'POST' && url.includes('/v10/projects')) return reply(200, { id: 'prj_1' });
    if (method === 'PATCH') return reply(200, {});
    if (method === 'POST' && url.includes('/v13/deployments')) return reply(200, { id: 'dpl_1', readyState: 'READY' });
    if (url.includes('/domains')) return reply(200, { domains: [{ name: 'site-1.vercel.app' }] });
    return reply(500, {});
  };

  it('publica mesmo quando a Vercel não deixa mudar a proteção do projeto (plano grátis)', async () => {
    const { createForjaPublisher } = await import('../server/forja/forjaPublisher');
    const patches: any[] = [];
    const fetchImpl = happy((url, method) => {
      if (method === 'PATCH') {
        patches.push(url);
        return reply(403, { error: { code: 'forbidden', message: 'Password protection requires Pro' } });
      }
      return null;
    });
    const r = await createForjaPublisher({ token: 't', teamId: 'team_9', fetchImpl, sleep: async () => {} }).publish({ projectName: 'site-1', html });
    expect(r.url).toBe('https://site-1.vercel.app');
    expect(patches.length).toBe(1);
  });

  it('403 da Vercel não é tratado como token vencido: mostra o motivo real', async () => {
    const { createForjaPublisher } = await import('../server/forja/forjaPublisher');
    const fetchImpl = happy((url, method) => (method === 'POST' && url.includes('/v13/deployments') ? reply(403, { error: { message: 'Limite de publicações do dia atingido' } }) : null));
    await expect(createForjaPublisher({ token: 't', teamId: 'team_9', fetchImpl, sleep: async () => {} }).publish({ projectName: 'site-1', html })).rejects.toMatchObject({
      code: 'vercel_forbidden',
      message: expect.stringContaining('Limite de publicações do dia atingido'),
    });
  });

  it('só 401 vira "token recusado"', async () => {
    const { createForjaPublisher } = await import('../server/forja/forjaPublisher');
    const fetchImpl = async () => reply(401, {});
    await expect(createForjaPublisher({ token: 't', teamId: 'team_9', fetchImpl, sleep: async () => {} }).publish({ projectName: 'site-1', html })).rejects.toMatchObject({ code: 'vercel_token_refused' });
  });

  it('token conectado num lugar sem permissão de criar: tenta os outros times e publica onde pode', async () => {
    const { createForjaPublisher } = await import('../server/forja/forjaPublisher');
    const created: string[] = [];
    const fetchImpl = happy((url, method) => {
      if (url.includes('/v5/user/tokens/current')) return reply(200, { token: {} });
      if (url.includes('/v2/user')) return reply(200, { user: { username: 'ze', defaultTeamId: 'team_ok' } });
      if (url.includes('/v2/teams')) return reply(200, { teams: [{ id: 'team_view', slug: 'empresa' }, { id: 'team_ok', slug: 'ze-projects' }] });
      if (method === 'POST' && url.includes('/v10/projects')) {
        created.push(url);
        return url.includes('teamId=team_ok') ? reply(200, { id: 'prj_ok' }) : reply(403, { error: { message: "You don't have permission to create the project." } });
      }
      return null;
    });
    const r = await createForjaPublisher({ token: 't', teamId: 'team_view', fetchImpl, sleep: async () => {} }).publish({ projectName: 'site-1', html });
    expect(r).toMatchObject({ vercelProjectId: 'prj_ok', teamId: 'team_ok' });
    expect(created.length).toBe(2);
  });

  it('nenhum lugar deixa criar: explica como gerar o token certo', async () => {
    const { createForjaPublisher } = await import('../server/forja/forjaPublisher');
    const fetchImpl = happy((url, method) => {
      if (url.includes('/v5/user/tokens/current')) return reply(200, { token: {} });
      if (url.includes('/v2/user')) return reply(200, { user: { username: 'ze' } });
      if (url.includes('/v2/teams')) return reply(200, { teams: [{ id: 'team_view', slug: 'empresa' }] });
      if (method === 'POST' && url.includes('/v10/projects')) return reply(403, { error: { message: "You don't have permission to create the project." } });
      return null;
    });
    await expect(createForjaPublisher({ token: 't', teamId: 'team_view', fetchImpl, sleep: async () => {} }).publish({ projectName: 'site-1', html })).rejects.toMatchObject({
      code: 'vercel_cannot_create_project',
      message: expect.stringContaining('empresa, ze (conta pessoal)'),
    });
  });

  it('conexão antiga sem time: ao receber 403 descobre o time do token e publica lá', async () => {
    const { createForjaPublisher } = await import('../server/forja/forjaPublisher');
    const fetchImpl = happy((url) => {
      if (url.includes('/v5/user/tokens/current')) return reply(200, { token: { scopes: [{ type: 'team', teamId: 'team_z' }] } });
      if (url.includes('/v2/user')) return reply(404, {});
      if (url.includes('/v2/teams')) return reply(200, { teams: [] });
      if (url.includes('/v9/projects?limit=1&teamId=team_z')) return reply(200, { projects: [] });
      if (!url.includes('teamId=team_z')) return reply(403, { error: { message: 'Not authorized' } });
      return null;
    });
    const r = await createForjaPublisher({ token: 't', fetchImpl, sleep: async () => {} }).publish({ projectName: 'site-1', html, vercelProjectId: 'prj_old' });
    expect(r).toMatchObject({ url: 'https://site-1.vercel.app', vercelProjectId: 'prj_1', teamId: 'team_z' });
  });
});

describe('Forja: conectar a Vercel de cada pessoa', () => {
  const reply = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });

  it('confere o token e descobre a conta, sem precisar de time', async () => {
    const { verifyVercelToken } = await import('../server/forja/forjaPublisher');
    const r = await verifyVercelToken('abcdefghijklmnopqrstuvwx', async (url: string) =>
      url.includes('/v2/user') ? reply(200, { user: { username: 'maria' } }) : reply(200, { projects: [] }),
    );
    expect(r).toEqual({ username: 'maria', teamId: null });
  });

  it('usa o time padrão quando o token é de um time', async () => {
    const { verifyVercelToken } = await import('../server/forja/forjaPublisher');
    const r = await verifyVercelToken('abcdefghijklmnopqrstuvwx', async (url: string) => {
      if (url.includes('/v2/user')) return reply(200, { user: { username: 'joao', defaultTeamId: 'team_x' } });
      return url.includes('teamId=team_x') ? reply(200, { projects: [] }) : reply(403, {});
    });
    expect(r).toEqual({ username: 'joao', teamId: 'team_x' });
  });

  it('aceita token de time (conta nova "...-projects"), em que /v2/user responde 404', async () => {
    const { verifyVercelToken } = await import('../server/forja/forjaPublisher');
    const r = await verifyVercelToken('abcdefghijklmnopqrstuvwx', async (url: string) => {
      if (url.includes('/v2/user')) return reply(404, { error: { code: 'not_found', message: 'User not found' } });
      if (url.includes('/v5/user/tokens/current')) return reply(200, { token: { scopes: [{ type: 'team', teamId: 'team_y' }] } });
      if (url.includes('/v2/teams')) return reply(200, { teams: [{ id: 'team_y', slug: 'fulano-1234s-projects' }] });
      return url.includes('teamId=team_y') ? reply(200, { projects: [] }) : reply(403, {});
    });
    expect(r).toEqual({ username: 'fulano-1234s-projects', teamId: 'team_y' });
  });

  it('prefere o time do token mesmo se a conta pessoal também listar projetos', async () => {
    const { verifyVercelToken } = await import('../server/forja/forjaPublisher');
    const r = await verifyVercelToken('abcdefghijklmnopqrstuvwx', async (url: string) => {
      if (url.includes('/v2/user')) return reply(200, { user: { username: 'ana', defaultTeamId: 'team_a' } });
      if (url.includes('/v5/user/tokens/current')) return reply(200, { token: {} });
      if (url.includes('/v2/teams')) return reply(200, { teams: [{ id: 'team_a' }] });
      return reply(200, { projects: [] });
    });
    expect(r).toEqual({ username: 'ana', teamId: 'team_a' });
  });

  it('recusa token inválido ou recusado com mensagem clara', async () => {
    const { verifyVercelToken } = await import('../server/forja/forjaPublisher');
    await expect(verifyVercelToken('curto')).rejects.toThrow(/token da Vercel/);
    await expect(verifyVercelToken('abcdefghijklmnopqrstuvwx', async () => reply(401, {}))).rejects.toThrow(/recusou/);
  });

  it('sem conta conectada, publicar pede para conectar', async () => {
    const { createForjaPublisher } = await import('../server/forja/forjaPublisher');
    await expect(createForjaPublisher({}).publish({ projectName: 'x-1', html: '<html></html>' })).rejects.toMatchObject({ code: 'vercel_not_connected' });
  });
});

describe('Forja: revisão dos especialistas', () => {
  it('lê a resposta do especialista mesmo com texto em volta e limita a 5 pontos', async () => {
    const { parseSpecialistIssues, issuesToFix, buildSpecialistFixContents, SPECIALISTS } = await import('../server/forja/specialists');
    expect(SPECIALISTS.map((s) => s.id)).toEqual(['design', 'conteudo', 'seguranca']);
    const raw = 'Segue:\n```json\n{"issues":[{"severity":"high","file":"src/App.tsx","problem":"Menu não abre no celular","fix":"Ligar o botão ao estado open"},{"severity":"low","problem":"Cor","fix":"Escurecer"},{"problem":"","fix":"x"}]}\n```';
    const issues = parseSpecialistIssues(raw);
    expect(issues).toHaveLength(2);
    expect(issues[0]).toMatchObject({ severity: 'alta', file: 'src/App.tsx' });
    expect(parseSpecialistIssues('sem json')).toEqual([]);
    const fixes = issuesToFix([{ id: 'design', name: 'Design', status: 'issues', issues }]);
    expect(fixes).toHaveLength(1); // "baixa" é só sugestão, não chama o arquiteto
    const contents = buildSpecialistFixContents({ originalPrompt: 'pizzaria', currentFiles: { 'src/App.tsx': 'x' }, fixes });
    expect(contents[0].parts[0].text).toContain('Menu não abre no celular');
    expect(contents[0].parts[0].text).toContain('<current_file path="src/App.tsx">');
  });

  it('a revisão fica salva na conversa do projeto', () => {
    const msgs = sanitizeForjaMessages([{ id: 'a', role: 'assistant', content: '', phase: 'done', review: [{ id: 'design', name: 'Design', status: 'issues', issues: [{ severity: 'alta', problem: 'p', fix: 'f' }] }] }]);
    expect(msgs[0].review?.[0]).toMatchObject({ id: 'design', status: 'issues' });
  });
});

describe('Forja: pacotes do site sem node_modules (como na Vercel)', () => {
  it('baixa React e só os ícones usados do esm.sh, com uma cópia só do React e cache', async () => {
    const { compileVirtualReactProject, lucideImportsIn } = await import('../server/forja/bundler');
    const seen: string[] = [];
    const original = globalThis.fetch;
    const body = (url: string) =>
      url.includes('lucide-react') ? 'import "react"; export const Check = () => null; export const Menu = () => null;'
        : url.includes('jsx-runtime') ? 'export function jsx(t,p){return {t,p}} export const jsxs = jsx; export const Fragment = "f";'
          : url.includes('react-dom') ? 'import "react"; export function createRoot(){ return { render(){} } }'
            : 'export function useState(v){return [v,()=>{}]} export default { useState }';
    globalThis.fetch = (async (url: string) => {
      seen.push(String(url));
      return { ok: true, status: 200, text: async () => body(String(url)) };
    }) as never;
    try {
      const files = {
        'index.html': INDEX,
        'src/App.tsx': 'import { useState } from "react";\nimport { Check, Menu as M } from "lucide-react";\nexport default function App(){ const [a] = useState(1); return <div><Check/><M/>Froc teste remoto {a}</div>; }',
      };
      expect(lucideImportsIn(files)).toEqual(['Check', 'Menu']);
      const r = await compileVirtualReactProject(files, { withErrorBridge: false, skipLocalPackages: true });
      expect(r.errors).toEqual([]);
      expect(r.html).toContain('Froc teste remoto');
      expect(seen.some((u) => u.includes('lucide-react@0.546.0') && u.includes('exports=Check,Menu'))).toBe(true);
      expect(seen.some((u) => u.includes('react-dom@19.1.0/client'))).toBe(true);
      const count = seen.length;
      await compileVirtualReactProject(files, { withErrorBridge: false, skipLocalPackages: true });
      expect(seen.length).toBe(count);
    } finally {
      globalThis.fetch = original;
    }
  }, 30_000);
});

describe('Forja: resposta cortada no meio de um arquivo', () => {
  it('o arquivo incompleto nunca vira arquivo pronto', () => {
    const parser = new ArchitectStreamParser();
    const events = [
      ...parser.push('<file path="src/App.tsx">\nexport default function App(){ return null }\n</file>\n<file path="src/components/Footer.tsx">\nimport React from \'rea'),
      ...parser.flush(),
    ];
    const types = events.map((e) => `${e.type}:${'path' in e ? e.path : ''}`);
    expect(types).toContain('file_end:src/App.tsx');
    expect(types).toContain('file_truncated:src/components/Footer.tsx');
    expect(types).not.toContain('file_end:src/components/Footer.tsx');
  });
});

describe('Forja: o HTML final não pede scripts locais', () => {
  it('remove ./src/main.tsx, importmap e CSS local e mantém CDNs', async () => {
    const { stripLocalScripts } = await import('../server/forja/bundler');
    const out = stripLocalScripts('<head><script type="importmap">{}</script><script src="https://cdn.tailwindcss.com"></script><link rel="stylesheet" href="./src/index.css"></head><body><script type="module" src="./src/main.tsx"></script><script src="app.js"></script></body>');
    expect(out).not.toContain('importmap');
    expect(out).not.toContain('main.tsx');
    expect(out).not.toContain('app.js');
    expect(out).not.toContain('./src/index.css');
    expect(out).toContain('cdn.tailwindcss.com');
  });
});

describe('Forja: código com "$&" não é corrompido ao montar o HTML', () => {
  it('mantém o JavaScript e o CSS exatamente como vieram', async () => {
    const { assembleCompiledHtml } = await import('../server/forja/bundler');
    // O React minificado tem trechos como `s=$&&s[$]`: com replace de texto, "$&" virava "</body>".
    const js = 'var s=$&&s[$];var t="$\'";var u="$`";var v="$$";';
    const html = assembleCompiledHtml({ indexHtml: '<!doctype html><html><head></head><body><div id="root"></div></body></html>', compiledJs: js, customCss: 'a{b:$&}', withErrorBridge: false });
    expect(html).toContain(js);
    expect(html).toContain('a{b:$&}');
    expect(html).not.toContain('</body>&');
  });
});
