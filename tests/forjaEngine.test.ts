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
    expect(r).toEqual({ url: 'https://pizzaria-bella-abc123.vercel.app', vercelProjectId: 'prj_1', deploymentId: 'dpl_1', teamId: 'team_9', searchEnginesNotified: false });
    expect(calls.filter((c) => c.url.includes('api.vercel.com')).every((c) => c.url.includes('teamId=team_9'))).toBe(true);
    const patch = calls.find((c) => c.method === 'PATCH');
    expect(patch?.body).toMatchObject({ ssoProtection: null });
    const deploy = calls.find((c) => c.url.includes('/v13/deployments') && c.method === 'POST');
    expect(deploy?.body).toMatchObject({ target: 'production', project: 'prj_1' });
    expect(deploy?.body.files.map((f: { file: string }) => f.file)).toEqual(expect.arrayContaining(['index.html', 'robots.txt', 'sitemap.xml', 'vercel.json']));
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

  it('sem acesso à lista de times, acha o time pelos projetos que o token enxerga', async () => {
    const { createForjaPublisher } = await import('../server/forja/forjaPublisher');
    const fetchImpl = happy((url, method) => {
      if (url.includes('/v5/user/tokens/current') || url.includes('/v2/user') || url.includes('/v2/teams')) return reply(403, {});
      if (method === 'GET' && url.includes('/v9/projects?limit=20')) return reply(200, { projects: [{ accountId: 'team_achado' }] });
      if (method === 'POST' && url.includes('/v10/projects')) return url.includes('teamId=team_achado') ? reply(200, { id: 'prj_t' }) : reply(403, { error: { message: "You don't have permission to create the project." } });
      return null;
    });
    const r = await createForjaPublisher({ token: 't', fetchImpl, sleep: async () => {} }).publish({ projectName: 'site-1', html });
    expect(r).toMatchObject({ vercelProjectId: 'prj_t', teamId: 'team_achado' });
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
    await expect(createForjaPublisher({ token: 't', teamId: 'team_view', fetchImpl, sleep: async () => {} }).publish({ projectName: 'site-1', html })).rejects.toMatchObject({
      message: expect.stringContaining('diagnóstico: token 200, usuário 200, times 200'),
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


describe('Forja: site profissional (kit, fotos, SEO)', () => {
  const manifest = JSON.stringify({
    brand: 'Bella Napoli',
    description: 'Pizza napolitana de fermentação lenta.',
    routes: [{ path: '/', title: 'Início' }, { path: '/cardapio/', title: 'Cardápio' }, { path: '/privacidade', title: 'Privacidade' }, { path: 'javascript:x', title: 'ruim' }],
    images: [
      { id: 'hero', aspect: '21:9', alt: 'Pizza saindo do forno', prompt: 'Wood-fired Neapolitan pizza leaving the oven, 35mm, warm light' },
      { id: 'forno', aspect: '9:9', alt: 'Forno', prompt: 'Brick oven with flames' },
      { id: 'Bad Id', aspect: '1:1', alt: 'x', prompt: 'x' },
    ],
  });

  it('lê forja/site.json e descarta o que é inválido', async () => {
    const { parseSiteManifest } = await import('../server/forja/siteKit');
    const m = parseSiteManifest({ 'forja/site.json': manifest })!;
    expect(m.brand).toBe('Bella Napoli');
    expect(m.routes.map((r) => r.path)).toEqual(['/', '/cardapio', '/privacidade']);
    expect(m.images.map((i) => [i.id, i.aspect])).toEqual([['hero', '21:9'], ['forno', '16:9']]);
    expect(parseSiteManifest({ 'forja/site.json': '{quebrado' })).toBe(null);
  });

  it('injeta o kit com as fotos e troca /forja-img/ID.jpg (inclusive URLs com "$&")', async () => {
    const { withSiteKit, KIT_PATH } = await import('../server/forja/siteKit');
    const url = 'https://firebasestorage.googleapis.com/v0/b/x/o/a.jpg?alt=media&token=$&abc';
    const out = withSiteKit({
      'forja/images.lock.json': JSON.stringify({ hero: { url, hash: 'h' } }),
      'index.html': '<meta property="og:image" content="/forja-img/hero.jpg"><meta content="/forja-img/outra.jpg">',
    });
    expect(out['index.html']).toContain(`content="${url}"`);
    expect(out['index.html']).toContain('/forja-img/outra.jpg');
    expect(out[KIT_PATH]).toContain(JSON.stringify({ hero: url }));
    expect(out[KIT_PATH]).not.toContain('__FORJA_IMAGES__');
  });

  it('o kit embutido é igual ao arquivo-fonte (rode scripts/build-site-kit.mjs ao mudar o kit)', async () => {
    const { readFileSync } = await import('node:fs');
    const { SITE_KIT_SOURCE } = await import('../server/forja/kit/siteKitSource');
    expect(SITE_KIT_SOURCE).toBe(readFileSync(new URL('../server/forja/kit/siteKit.source.txt', import.meta.url), 'utf8'));
  });

  it('gera só as fotos novas, salva no Storage e anota a trava; falha de uma foto não derruba as outras', async () => {
    const { forgeSiteImages, imageHash } = await import('../server/forja/imageForge');
    const { parseSiteManifest } = await import('../server/forja/siteKit');
    const m = parseSiteManifest({ 'forja/site.json': manifest })!;
    const asked: string[] = [];
    const ai = {
      models: {
        generateContent: async (req: any) => {
          const text = req.contents[0].parts[0].text as string;
          asked.push(req.config.imageConfig.aspectRatio);
          if (text.includes('Brick oven')) throw new Error('falhou');
          return { candidates: [{ content: { parts: [{ inlineData: { data: Buffer.alloc(5000, 1).toString('base64'), mimeType: 'image/jpeg' } }] } }] };
        },
      },
    };
    const saved: string[] = [];
    const store = { save: async (path: string) => { saved.push(path); return 'https://cdn.example/' + path; } };
    const files = { 'forja/site.json': manifest, 'forja/images.lock.json': JSON.stringify({ velha: { url: 'https://cdn.example/velha.jpg', hash: 'x' } }) };
    const r = await forgeSiteImages({ ai: ai as never, files, store, ownerId: 'uid/1', models: ['m1'] });
    expect(r.generated).toEqual(['hero']);
    expect(r.failed.map((f) => f.id)).toEqual(['forno']);
    expect(asked).toEqual(expect.arrayContaining(['21:9', '16:9']));
    expect(saved[0]).toMatch(/^forja-public\/uid1\/hero-[a-f0-9]{12}\.jpg$/);
    const lock = JSON.parse(r.files['forja/images.lock.json']);
    expect(Object.keys(lock)).toEqual(['hero']);
    expect(lock.hero.hash).toBe(imageHash(m.images[0]));

    // Segunda construção: a foto pronta não é gerada de novo.
    asked.length = 0;
    const again = await forgeSiteImages({ ai: ai as never, files: r.files, store, ownerId: 'uid', models: ['m1'] });
    expect(again.generated).toEqual([]);
    expect(asked).toEqual(['16:9']);
  });

  it('publicação leva robots.txt, sitemap.xml, rotas e troca __SITE_URL__ pelo endereço', async () => {
    const { buildDeployFiles, indexNowKey } = await import('../server/forja/forjaPublisher');
    const pack = buildDeployFiles({ html: '<link rel="canonical" href="__SITE_URL__/"><script>var u="__SITE_URL__"</script>', host: 'bella.vercel.app', projectName: 'bella-1', routes: ['/', '/cardapio', '/privacidade'] });
    const byName = Object.fromEntries(pack.files.map((f) => [f.file, f.data]));
    expect(byName['index.html']).toBe('<link rel="canonical" href="https://bella.vercel.app/"><script>var u="https://bella.vercel.app"</script>');
    expect(byName['robots.txt']).toContain('Sitemap: https://bella.vercel.app/sitemap.xml');
    expect(byName['sitemap.xml']).toContain('<loc>https://bella.vercel.app/cardapio</loc>');
    expect(byName[`${indexNowKey('bella-1')}.txt`]).toBe(indexNowKey('bella-1'));
    expect(JSON.parse(byName['vercel.json']).rewrites[0]).toEqual({ source: '/((?!.*\\.).*)', destination: '/index.html' });
    expect(pack.urls).toEqual(['https://bella.vercel.app/', 'https://bella.vercel.app/cardapio', 'https://bella.vercel.app/privacidade']);
  });

  it('avisa os buscadores (IndexNow) depois de publicar', async () => {
    const { createForjaPublisher } = await import('../server/forja/forjaPublisher');
    const reply = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
    let pinged: any = null;
    const fetchImpl = async (url: string, init: { method?: string; body?: string }) => {
      const method = init.method || 'GET';
      if (url.startsWith('https://api.indexnow.org')) {
        pinged = JSON.parse(init.body || '{}');
        return reply(202, {});
      }
      if (method === 'GET' && url.includes('/v9/projects/site-1?')) return reply(404, {});
      if (method === 'POST' && url.includes('/v10/projects')) return reply(200, { id: 'prj_1' });
      if (method === 'PATCH') return reply(200, {});
      if (method === 'POST' && url.includes('/v13/deployments')) return reply(200, { id: 'dpl_1', readyState: 'READY' });
      if (url.includes('/domains')) return reply(200, { domains: [{ name: 'site-1.vercel.app' }] });
      return reply(500, {});
    };
    const r = await createForjaPublisher({ token: 't', teamId: 'team_9', fetchImpl, sleep: async () => {} }).publish({ projectName: 'site-1', html: '<html><body>oi</body></html>', routes: ['/sobre'] });
    expect(r.searchEnginesNotified).toBe(true);
    expect(pinged).toMatchObject({ host: 'site-1.vercel.app', urlList: ['https://site-1.vercel.app/', 'https://site-1.vercel.app/sobre'] });
  });
});
