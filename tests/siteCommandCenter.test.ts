import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/apiClient', () => ({ apiClient: vi.fn(async () => ({ command: null })) }));

import {
  SITE_COMMANDS,
  acceptModelInterpretation,
  buildSiteCommandHelp,
  catalogForModel,
  looksLikeSiteCommand,
  parseSiteCommand,
  resolveNamedItem,
} from '../shared/siteCommandCatalog';
import {
  executeSiteCommandText,
  getPendingSiteCommand,
  registerSiteCommandHandler,
  setSiteCommandEnvironment,
} from '../src/services/siteCommandBus';

const cleanups: Array<() => void> = [];
const register = (id: string, handler: Parameters<typeof registerSiteCommandHandler>[1]) => {
  cleanups.push(registerSiteCommandHandler(id, handler));
};
afterEach(async () => {
  while (cleanups.length) cleanups.pop()!();
  // limpa qualquer confirmação pendente entre testes
  if (getPendingSiteCommand()) await executeSiteCommandText('cancelar');
  setSiteCommandEnvironment({ isAdmin: false, isAuthenticated: false });
});

describe('Central de Comandos do Site — interpretação em português', () => {
  const cases: Array<[string, string | null, Record<string, string>?]> = [
    ['Ok Froc, abrir preços', 'nav.pricing'],
    ['abra a página de integrações', 'nav.integrations'],
    ['abrir o painel admin', 'nav.admin'],
    ['abrir meu painel', 'nav.dashboard'],
    ['abrir métricas', 'admin.tab', { value: 'metrics' }],
    ['mostrar os logs de auditoria', 'admin.tab', { value: 'audit' }],
    ['abrir autoevolução', 'admin.tab', { value: 'selfEvolution' }],
    ['abrir registro de prompts', 'admin.prompts'],
    ['abrir feature flags', 'admin.featureFlags'],
    ['abrir backups', 'admin.disasterRecovery'],
    ['abrir observabilidade', 'admin.observability'],
    ['abrir rastros de execução', 'admin.traces'],
    ['abrir avaliações', 'admin.evaluations'],
    ['nova conversa', 'chat.new'],
    ['criar uma conversa nova', 'chat.new'],
    ['abrir a conversa sobre marketing', 'chat.open', { name: 'marketing' }],
    ['abrir a segunda conversa', 'chat.open', { name: 'segunda' }],
    ['excluir esta conversa', 'chat.delete'],
    ['apagar a conversa sobre vendas', 'chat.delete', { name: 'vendas' }],
    ['apagar todas as conversas', 'chat.deleteAll'],
    ['quais são minhas conversas', 'chat.list'],
    ['parar a resposta', 'chat.stop'],
    ['mudar para modo pesquisa', 'chat.mode', { value: 'Pesquisa' }],
    ['modo rápido', 'chat.mode', { value: 'Rápido' }],
    ['abrir a câmera', 'tool.camera'],
    ['abrir gravador', 'tool.voiceRecorder'],
    ['importar do github', 'tool.github'],
    ['abrir base de conhecimento', 'tool.knowledge'],
    ['novo site', 'site.new'],
    ['abrir o projeto loja de roupas', 'site.open', { name: 'loja de roupas' }],
    ['excluir este projeto', 'site.delete'],
    ['exportar o site', 'site.export'],
    ['mostrar o código', 'view.mode', { value: 'code' }],
    ['ver no celular', 'view.device', { value: 'mobile' }],
    ['tela cheia', 'view.fullscreen', { value: 'on' }],
    ['sair da tela cheia', 'view.fullscreen', { value: 'off' }],
    ['modo claro', 'ui.theme', { value: 'light' }],
    ['fechar o menu lateral', 'sidebar.toggle', { value: 'close' }],
    ['mostrar meus projetos', 'sidebar.section', { value: 'projects' }],
    ['abrir suporte', 'support.open'],
    ['trocar o modelo', 'header.model'],
    ['abrir memórias', 'header.memory'],
    ['sair da conta', 'auth.logout'],
    ['fechar', 'ui.close'],
    ['o que você pode fazer', 'ui.help'],
    ['testar todas as funções', 'ui.verify'],
    ['sim, pode excluir', 'confirm.yes'],
    ['cancelar', 'confirm.no'],
    // pedidos de conteúdo continuam indo para a conversa com a IA
    ['crie uma imagem de um gato', null],
    ['crie um site para minha padaria', null],
    ['qual é a capital da frança', null],
    ['abrir o site do google e pesquisar receitas de bolo', null],
  ];

  it.each(cases)('"%s"', (text, id, params) => {
    const parsed = parseSiteCommand(text);
    expect(parsed?.id ?? null).toBe(id);
    if (params) expect(parsed?.params).toMatchObject(params);
  });

  it('só manda para a IA do servidor frases com cara de ordem', () => {
    expect(looksLikeSiteCommand('abra a janela onde ficam os cupons')).toBe(true);
    expect(looksLikeSiteCommand('crie uma imagem de gato')).toBe(false);
    expect(looksLikeSiteCommand('como abro meus projetos?')).toBe(false);
  });

  it('resolve conversas e projetos por nome, número e posição', () => {
    const items = [{ t: 'Plano de marketing 2026' }, { t: 'Vendas de dezembro' }, { t: 'Marketing digital' }];
    expect(resolveNamedItem(items, 'vendas', (i) => i.t)).toEqual({ status: 'found', item: items[1] });
    expect(resolveNamedItem(items, 'segunda', (i) => i.t)).toEqual({ status: 'found', item: items[1] });
    expect(resolveNamedItem(items, 'ultima', (i) => i.t)).toEqual({ status: 'found', item: items[0] });
    expect(resolveNamedItem(items, '3', (i) => i.t)).toEqual({ status: 'found', item: items[2] });
    expect(resolveNamedItem(items, 'marketing', (i) => i.t).status).toBe('ambiguous');
    expect(resolveNamedItem(items, 'atual', (i) => i.t).status).toBe('current');
    expect(resolveNamedItem(items, 'receitas', (i) => i.t).status).toBe('not_found');
  });
});

describe('Central de Comandos do Site — cada função do catálogo está ligada na interface', () => {
  const root = path.resolve(process.cwd(), 'src');
  const sources: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(tsx?|jsx?)$/.test(entry)) sources.push(readFileSync(full, 'utf8'));
    }
  };
  walk(root);
  const code = sources.join('\n');
  const builtIn = new Set(['ui.help', 'ui.verify', 'confirm.yes', 'confirm.no']);

  it.each(SITE_COMMANDS.filter((c) => !builtIn.has(c.id)).map((c) => [c.id]))('%s tem ação registrada', (id) => {
    expect(code).toContain(`useSiteCommand('${id}'`);
  });

  it('todo comando tem exemplo que o próprio interpretador entende', () => {
    for (const command of SITE_COMMANDS) {
      const parsed = parseSiteCommand(command.examples[0]);
      expect(parsed?.id, `${command.id}: "${command.examples[0]}"`).toBe(command.id);
    }
  });

  it('pré-requisitos apontam para comandos existentes', () => {
    const ids = new Set(SITE_COMMANDS.map((c) => c.id));
    for (const command of SITE_COMMANDS) if (command.requires) expect(ids.has(command.requires)).toBe(true);
  });
});

describe('Central de Comandos do Site — execução, admin e confirmação', () => {
  it('bloqueia funções de administrador para usuário comum', async () => {
    const handler = vi.fn(() => ({ ok: true, message: 'aberto' }));
    register('nav.admin', handler);
    setSiteCommandEnvironment({ isAdmin: false, isAuthenticated: true });
    const outcome = await executeSiteCommandText('abrir o painel admin');
    expect(outcome?.ok).toBe(false);
    expect(outcome?.message).toMatch(/exclusiva do administrador/);
    expect(handler).not.toHaveBeenCalled();
  });

  it('administrador acessa e a tela necessária é aberta antes (painel admin → prompts)', async () => {
    setSiteCommandEnvironment({ isAdmin: true, isAuthenticated: true });
    const prompts = vi.fn(() => ({ ok: true, message: 'Abri o registro de prompts.' }));
    register('nav.admin', () => {
      // simula o AdminPanel montando depois da navegação
      setTimeout(() => register('admin.prompts', prompts), 30);
      return { ok: true, message: 'Abri o painel administrativo.' };
    });
    const outcome = await executeSiteCommandText('abrir registro de prompts');
    expect(outcome).toMatchObject({ ok: true, commandId: 'admin.prompts', message: 'Abri o registro de prompts.' });
    expect(prompts).toHaveBeenCalledTimes(1);
  });

  it('exclusão só acontece depois de "confirmar"', async () => {
    setSiteCommandEnvironment({ isAdmin: false, isAuthenticated: true });
    const calls: boolean[] = [];
    register('chat.delete', (_params, { dryRun }) => {
      calls.push(dryRun);
      return dryRun ? { ok: true, message: 'excluir a conversa "Vendas"' } : { ok: true, message: 'Conversa "Vendas" excluída.' };
    });
    const ask = await executeSiteCommandText('excluir esta conversa');
    expect(ask?.needsConfirmation).toBe(true);
    expect(ask?.message).toContain('Confirma excluir a conversa "Vendas"');
    expect(calls).toEqual([true]);

    const done = await executeSiteCommandText('confirmar');
    expect(done).toMatchObject({ ok: true, message: 'Conversa "Vendas" excluída.' });
    expect(calls).toEqual([true, false]);
  });

  it('"cancelar" desiste da exclusão', async () => {
    setSiteCommandEnvironment({ isAdmin: false, isAuthenticated: true });
    const handler = vi.fn((_p: unknown, { dryRun }: { dryRun: boolean }) => ({ ok: true, message: dryRun ? 'excluir o projeto "Loja"' : 'excluído' }));
    register('site.delete', handler as any);
    await executeSiteCommandText('excluir este projeto');
    const cancelled = await executeSiteCommandText('não');
    expect(cancelled?.message).toMatch(/Cancelado/);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('"sim" sem nada pendente segue para a conversa normal', async () => {
    expect(await executeSiteCommandText('sim')).toBeNull();
    expect(await executeSiteCommandText('me explique o que é fotossíntese')).toBeNull();
  });

  it('"fechar" fecha todas as janelas abertas e, se não houver, volta ao início', async () => {
    const a = vi.fn(() => ({ ok: true, message: '' }));
    const b = vi.fn(() => ({ ok: false, message: '' }));
    register('ui.close', a);
    register('ui.close', b);
    expect((await executeSiteCommandText('fechar tudo'))?.message).toBe('Fechei.');
    expect(a).toHaveBeenCalled();
    expect(b).toHaveBeenCalled();

    while (cleanups.length) cleanups.pop()!();
    register('ui.close', () => ({ ok: false, message: '' }));
    register('ui.back', () => ({ ok: true, message: 'Voltei para o início.' }));
    expect((await executeSiteCommandText('fechar'))?.message).toBe('Voltei para o início.');
  });

  it('ajuda lista os comandos e esconde os de admin para usuário', async () => {
    setSiteCommandEnvironment({ isAdmin: false, isAuthenticated: true });
    const help = await executeSiteCommandText('o que você pode fazer');
    expect(help?.details).toContain('Abrir preços e créditos');
    expect(help?.details).not.toContain('registro de prompts');
    expect(buildSiteCommandHelp(true)).toContain('Abrir registro de prompts');
  });
});

describe('Central de Comandos do Site — interpretação pela IA do servidor', () => {
  it('não envia comandos de admin no catálogo de um usuário comum', () => {
    expect(catalogForModel(false).some((c) => c.id.startsWith('admin.'))).toBe(false);
    expect(catalogForModel(true).some((c) => c.id === 'admin.prompts')).toBe(true);
  });

  it('valida a resposta da IA (id, papel, valor e confiança)', () => {
    expect(acceptModelInterpretation({ id: 'nav.pricing', confidence: 0.9 }, false)).toEqual({ id: 'nav.pricing', params: {} });
    expect(acceptModelInterpretation({ id: 'admin.prompts', confidence: 0.99 }, false)).toBeNull();
    expect(acceptModelInterpretation({ id: 'admin.prompts', confidence: 0.99 }, true)).toEqual({ id: 'admin.prompts', params: {} });
    expect(acceptModelInterpretation({ id: 'nav.pricing', confidence: 0.3 }, false)).toBeNull();
    expect(acceptModelInterpretation({ id: 'apagar.banco', confidence: 1 }, true)).toBeNull();
    expect(acceptModelInterpretation({ id: 'chat.mode', value: 'Turbo', confidence: 1 }, false)).toBeNull();
    expect(acceptModelInterpretation({ id: 'chat.mode', value: 'Pesquisa', confidence: 1 }, false)).toEqual({ id: 'chat.mode', params: { value: 'Pesquisa' } });
    expect(acceptModelInterpretation({ id: 'confirm.yes', confidence: 1 }, false)).toBeNull();
  });
});
