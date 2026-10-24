import { describe, expect, it } from 'vitest';
import { buildSelfSiteKnowledge, isSelfSourceReadable, splitSelfSource } from '../server/selfEvolution/selfSiteKnowledgeService.js';
import { RepositoryArchitectureService } from '../server/ai/repositoryArchitectureService.js';
import { buildEngineeringContext } from '../worker/engineering-context.mjs';
import { isOwnSiteRequest, requestsOwnSiteAction, requestedOwnSiteToggle, SelfSiteOwnerService } from '../server/selfEvolution/selfSiteOwnerService.js';

describe('Conhecimento do proprio site e controle do proprietario', () => {
  it('mapeia todos os arquivos, as rotas, o menu e os 85 agentes', () => {
    const files = [
      ...Array.from({ length: 125 }, (_, i) => ({ path: `server/services/module${i}.ts`, content: `export const module${i} = true;` })),
      { path: 'server/routes/products.ts', content: `productRouter.get('/products/:id', requireAuth, handler); productRouter.post('/products', requireAuth, create);` },
      { path: 'src/components/Sidebar.tsx', content: `const unrelated = [{id:'not-navigation', label:'Nao clicar'}]; const menuItems = [{id:'home', label:'Início'}, {id:'extra', label:'Nova tela'}];` },
    ];
    const map = buildSelfSiteKnowledge(files, 'a'.repeat(40));
    expect(map.filesCount).toBe(127);
    expect(map.agents).toHaveLength(85);
    expect(new Set(map.agents.map(a => a.id)).size).toBe(85);
    expect(map.navigation.map(v => v.label)).toEqual(['Início', 'Nova tela']);
    expect(map.routes).toEqual(expect.arrayContaining([
      expect.objectContaining({ method: 'GET', path: '/products/:id', file: 'server/routes/products.ts', line: 1 }),
      expect.objectContaining({ method: 'POST', path: '/products' }),
    ]));
  });

  it('reconstroi integralmente um arquivo grande com caracteres fora do BMP', () => {
    const source = 'x'.repeat(99_999) + '🔧'.repeat(120_000) + '\nfinal';
    const parts = splitSelfSource(source);
    expect(parts.length).toBeGreaterThan(2);
    expect(parts.map(p => Buffer.from(p).toString()).join('')).toBe(source);
    expect(parts.every(p => Buffer.byteLength(p) < 1_000_000)).toBe(true);
  });

  it('mantem acesso a codigo de agentes e workflows sem expor credenciais ou escapar do repositorio', () => {
    for (const p of ['worker/server.mjs', '.github/workflows/ci.yml', 'server/selfEvolution/codeAgentService.ts']) expect(isSelfSourceReadable(p)).toBe(true);
    for (const p of ['../private', '/etc/passwd', '..\\private', '.env.production', 'config/service-account.json', 'private.key', 'C:/private']) expect(isSelfSourceReadable(p)).toBe(false);
  });

  it('resolve imports ESM .js para o TypeScript versionado e encontra dependentes reais', () => {
    const files = [
      { path: 'server/service.ts', content: 'export const action = true;' },
      { path: 'server/route.ts', content: `import { action } from './service.js'; export const run = action;` },
    ];
    const report = RepositoryArchitectureService.analyze(files, ['server/service.ts']);
    expect(report.impact.directlyAffected).toContain('server/route.ts');
    const context = buildEngineeringContext(files, { title: 'action' }, ['server/service.ts']);
    expect(context.repositoryInventory.find(f => f.path === 'server/service.ts')?.dependents).toContain('server/route.ts');
  });

  it('consulta o inventario inteiro e permite manutencao do codigo dos agentes quando autorizada', () => {
    const files = [
      { path: 'worker/server.mjs', content: 'export const agentMaintenance = true;' },
      { path: '.github/workflows/ci.yml', content: 'name: agentMaintenance' },
    ];
    const context = buildEngineeringContext(files, { title: 'agentMaintenance' }, [], { allowRepositoryMaintenance: true });
    expect(context.repositoryCoverage.indexedFiles).toBe(2);
    expect(context.editablePaths).toEqual(expect.arrayContaining(files.map(f => f.path)));
  });

  it('separa uma pergunta de uma ordem de manutencao e respeita a negacao', () => {
    expect(isOwnSiteRequest('Como a Froc IA conhece seu site?')).toBe(true);
    expect(requestsOwnSiteAction('O que uma varredura no meu site faz?')).toBe(false);
    expect(requestsOwnSiteAction('Não corrija meu site agora')).toBe(false);
    expect(requestsOwnSiteAction('Corrija os erros do meu site Froc IA')).toBe(true);
    expect(requestsOwnSiteAction('Faça uma varredura completa no meu site')).toBe(true);
    expect(requestsOwnSiteAction('Corrija o site de outra empresa')).toBe(false);
  });

  it('nao disponibiliza conhecimento ou acoes administrativas a um usuario comum', async () => {
    expect(await SelfSiteOwnerService.context({ role: 'user', userId: 'user', prompt: 'Corrija meu site Froc IA' })).toContain('administrator_required');
  });
  it('reconhece pausa e retomada do proprietario sem inverter uma negacao', () => {
    expect(requestedOwnSiteToggle('Pause os meus agentes')).toBe(false);
    expect(requestedOwnSiteToggle('Ative a autonomia do meu site')).toBe(true);
    expect(requestedOwnSiteToggle('Não ative a autonomia do meu site')).toBeNull();
    expect(requestedOwnSiteToggle('Como funciona a autonomia do meu site?')).toBeNull();
  });
});
