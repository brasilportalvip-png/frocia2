/**
 * Barramento da Central de Comandos do Site.
 *
 * Cada tela registra aqui as ações que ela sabe executar (abrir, fechar,
 * excluir...). A voz (ou o texto) é interpretada pelo catálogo compartilhado e
 * o barramento chama a ação certa, aplicando:
 *  - bloqueio de funções de administrador para quem não é admin;
 *  - confirmação falada antes de excluir ou sair da conta;
 *  - abertura automática da tela necessária (ex.: painel admin antes de "abrir prompts").
 */
import { useEffect, useRef } from 'react';
import {
  SITE_COMMANDS,
  buildSiteCommandHelp,
  buildSpokenHelp,
  commandsForRole,
  getSiteCommand,
  looksLikeSiteCommand,
  parseSiteCommand,
  type ParsedSiteCommand,
  type SiteCommandParams,
} from '../../shared/siteCommandCatalog';
import { apiClient } from './apiClient';

export interface SiteCommandResult {
  ok: boolean;
  /** Texto exibido na tela. */
  message: string;
  /** Texto curto falado (se diferente do exibido). */
  spoken?: string;
  /** A própria ação já mostrou/falou algo (ex.: pediu confirmação); não emitir recibo. */
  silent?: boolean;
}

export interface SiteCommandContext {
  dryRun: boolean;
  isAdmin: boolean;
  isAuthenticated: boolean;
}

export type SiteCommandHandler = (
  params: SiteCommandParams,
  context: SiteCommandContext
) => SiteCommandResult | void | Promise<SiteCommandResult | void>;

export interface SiteCommandOutcome extends SiteCommandResult {
  commandId: string;
  /** 'system': pedido de confirmação gerado pelo próprio site (ex.: custo de imagem). */
  source: ParsedSiteCommand['source'] | 'system';
  needsConfirmation?: boolean;
  /** Ajuda completa ou relatório detalhado para exibir. */
  details?: string;
}

type Listener = (outcome: SiteCommandOutcome) => void;

const handlers = new Map<string, SiteCommandHandler[]>();
const listeners = new Set<Listener>();
const environment = { isAdmin: false, isAuthenticated: false };
interface PendingConfirmation {
  key: string;
  commandId: string;
  source: SiteCommandOutcome['source'];
  summary: string;
  expiresAt: number;
  run: () => Promise<SiteCommandResult>;
  cancel?: () => void;
}
let pending: PendingConfirmation | null = null;
const history: SiteCommandOutcome[] = [];

const CONFIRMATION_WINDOW_MS = 45_000;
const MOUNT_WAIT_MS = 3_000;
/** Comandos que todas as telas abertas executam juntas. */
const BROADCAST = new Set(['ui.close']);
/** Comandos resolvidos pelo próprio barramento. */
const BUILT_IN = new Set(['ui.help', 'ui.verify', 'confirm.yes', 'confirm.no']);

export function setSiteCommandEnvironment(next: { isAdmin: boolean; isAuthenticated: boolean }) {
  environment.isAdmin = Boolean(next.isAdmin);
  environment.isAuthenticated = Boolean(next.isAuthenticated);
}

export function registerSiteCommandHandler(id: string, handler: SiteCommandHandler): () => void {
  const list = handlers.get(id) || [];
  list.push(handler);
  handlers.set(id, list);
  return () => {
    const current = handlers.get(id) || [];
    const index = current.lastIndexOf(handler);
    if (index >= 0) current.splice(index, 1);
    if (current.length) handlers.set(id, current);
    else handlers.delete(id);
  };
}

export function hasSiteCommandHandler(id: string): boolean {
  return BUILT_IN.has(id) || (handlers.get(id)?.length ?? 0) > 0;
}

export function onSiteCommandOutcome(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSiteCommandHistory(): SiteCommandOutcome[] {
  return [...history];
}

export function getPendingSiteCommand() {
  if (pending && pending.expiresAt < Date.now()) pending = null;
  return pending ? { id: pending.commandId, summary: pending.summary } : null;
}

/**
 * Pede uma confirmação que pode ser respondida por voz ("confirmar"/"cancelar")
 * ou pelo clique na própria janela. Retorna uma função para descartar o pedido
 * quando a janela for fechada pelo mouse.
 */
export function requestSiteConfirmation(options: {
  key: string;
  summary: string;
  spoken?: string;
  onConfirm: () => void | Promise<void>;
  onCancel?: () => void;
  confirmedMessage?: string;
}): () => void {
  pending = {
    key: options.key,
    commandId: 'confirm.request',
    source: 'system',
    summary: options.summary,
    expiresAt: Date.now() + 120_000,
    run: async () => {
      await options.onConfirm();
      return { ok: true, message: options.confirmedMessage || 'Confirmado. Já estou fazendo.' };
    },
    cancel: options.onCancel,
  };
  emit({
    commandId: 'confirm.request',
    source: 'system',
    ok: true,
    needsConfirmation: true,
    message: `Confirma ${options.summary}? Diga "confirmar" ou "cancelar".`,
    spoken: options.spoken || `Confirma ${options.summary}? Diga confirmar ou cancelar.`,
  });
  return () => {
    if (pending?.key === options.key) pending = null;
  };
}

/** Hook: registra uma ação enquanto o componente estiver montado. */
export function useSiteCommand(id: string, handler: SiteCommandHandler) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(
    () => registerSiteCommandHandler(id, (params, context) => ref.current(params, context)),
    [id]
  );
}

function emit(outcome: SiteCommandOutcome): SiteCommandOutcome {
  history.unshift(outcome);
  history.length = Math.min(history.length, 40);
  for (const listener of listeners) {
    try { listener(outcome); } catch { /* um ouvinte com erro não bloqueia os demais */ }
  }
  return outcome;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForHandler(id: string): Promise<boolean> {
  const deadline = Date.now() + MOUNT_WAIT_MS;
  while (Date.now() < deadline) {
    if (hasSiteCommandHandler(id)) return true;
    await sleep(60);
  }
  return hasSiteCommandHandler(id);
}

async function callHandlers(id: string, params: SiteCommandParams, dryRun: boolean): Promise<SiteCommandResult> {
  const list = [...(handlers.get(id) || [])];
  const context: SiteCommandContext = { dryRun, ...environment };
  if (BROADCAST.has(id)) {
    let closed = 0;
    for (const handler of list) {
      try {
        const result = (await handler(params, context)) as SiteCommandResult | undefined;
        if (result?.ok) closed += 1;
      } catch { /* continua fechando as outras telas */ }
    }
    if (closed > 0) return { ok: true, message: 'Fechei.' };
    const back = handlers.get('ui.back')?.at(-1);
    if (back) {
      const result = (await back(params, context)) as SiteCommandResult | undefined;
      if (result?.ok) return { ok: true, message: result.message || 'Voltei para o início.' };
    }
    return { ok: true, message: 'Não há nenhuma janela aberta para fechar.' };
  }
  const handler = list[list.length - 1];
  if (!handler) return { ok: false, message: 'Essa função não está disponível nesta tela.' };
  const result = (await handler(params, context)) as SiteCommandResult | undefined;
  return result || { ok: true, message: 'Feito.' };
}

async function verifySite(): Promise<SiteCommandOutcome> {
  const commands = commandsForRole(environment.isAdmin).filter((command) => !command.id.startsWith('confirm.'));
  const ready: string[] = [];
  const onDemand: string[] = [];
  const broken: string[] = [];
  for (const command of commands) {
    if (hasSiteCommandHandler(command.id)) ready.push(command.id);
    else if (command.requires && hasSiteCommandHandler(command.requires)) onDemand.push(command.id);
    else broken.push(command.title);
  }

  const checks: string[] = [];
  let healthy = true;
  try {
    const started = performance.now();
    const response = await fetch('/api/health', { cache: 'no-store' });
    const ms = Math.round(performance.now() - started);
    if (response.ok) checks.push(`✅ Servidor respondendo (${ms} ms).`);
    else { healthy = false; checks.push(`❌ Servidor respondeu com erro ${response.status}.`); }
  } catch {
    healthy = false;
    checks.push('❌ Não consegui falar com o servidor (verifique a internet).');
  }
  checks.push(environment.isAuthenticated ? '✅ Sessão ativa.' : '⚠️ Você não está conectado: conversas e projetos na nuvem exigem login.');
  checks.push(environment.isAdmin ? '✅ Acesso de administrador confirmado.' : 'ℹ️ Conta de usuário (funções de admin ficam ocultas).');
  const recognition = typeof window !== 'undefined' &&
    Boolean((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
  checks.push(recognition ? '✅ Reconhecimento de voz do navegador disponível.' : '⚠️ Este navegador não tem reconhecimento de voz nativo (use Chrome ou Edge).');
  checks.push(`✅ ${ready.length} comandos prontos nesta tela; ${onDemand.length} abrem a tela necessária automaticamente.`);
  if (broken.length) checks.push(`❌ Sem ligação agora: ${broken.join(', ')}.`);
  const failed = history.filter((entry) => !entry.ok).slice(0, 5);
  if (failed.length) checks.push(`ℹ️ Últimos comandos que não deram certo: ${failed.map((entry) => entry.commandId).join(', ')}.`);
  checks.push('Para auditoria profunda do código e das páginas publicadas, diga "audite o site".');

  const ok = healthy && broken.length === 0;
  return {
    ok,
    commandId: 'ui.verify',
    source: 'local',
    message: ok ? `Verifiquei: ${ready.length + onDemand.length} de ${commands.length} funções estão ligadas e o servidor está ok.` : 'Verifiquei e encontrei pontos de atenção.',
    spoken: ok
      ? `Verificação concluída. ${ready.length + onDemand.length} de ${commands.length} funções estão funcionando e o servidor respondeu.`
      : `Verificação concluída com ${broken.length + (healthy ? 0 : 1)} problema${broken.length + (healthy ? 0 : 1) === 1 ? '' : 's'}. Os detalhes estão na tela.`,
    details: checks.join('\n'),
  };
}

async function interpretRemotely(text: string): Promise<ParsedSiteCommand | null> {
  try {
    const response = await apiClient<{ command?: { id?: string; params?: SiteCommandParams } | null }>(
      '/api/site-commands/interpret',
      { method: 'POST', body: JSON.stringify({ text: text.slice(0, 300) }) }
    );
    const id = response?.command?.id;
    if (!id || !getSiteCommand(id) || id.startsWith('confirm.')) return null;
    const raw = response.command?.params || {};
    const params: SiteCommandParams = {};
    if (typeof raw.name === 'string' && raw.name.trim()) params.name = raw.name.trim().slice(0, 120);
    if (typeof raw.value === 'string' && raw.value.trim()) params.value = raw.value.trim().slice(0, 40);
    return { id, params, source: 'ai' };
  } catch {
    return null;
  }
}

export async function runSiteCommand(command: ParsedSiteCommand): Promise<SiteCommandOutcome> {
  const definition = getSiteCommand(command.id);
  const base = { commandId: command.id, source: command.source };
  if (!definition) return emit({ ...base, ok: false, message: 'Não reconheci esse comando.' });

  if (definition.audience === 'admin' && !environment.isAdmin) {
    return emit({ ...base, ok: false, message: 'Essa função é exclusiva do administrador.' });
  }

  if (command.id === 'ui.help') {
    return emit({ ...base, ok: true, message: 'Estes são os comandos que você pode falar.', spoken: buildSpokenHelp(environment.isAdmin), details: buildSiteCommandHelp(environment.isAdmin) });
  }
  if (command.id === 'ui.verify') return emit({ ...(await verifySite()), source: command.source });

  // Abre antes a tela onde a ação acontece (ex.: painel admin, estúdio).
  if (definition.requires && hasSiteCommandHandler(definition.requires)) {
    try { await callHandlers(definition.requires, {}, false); } catch { /* tenta mesmo assim */ }
  }
  if (!hasSiteCommandHandler(command.id) && !(await waitForHandler(command.id))) {
    return emit({ ...base, ok: false, message: `Não consegui executar "${definition.title}" nesta tela.` });
  }

  try {
    if (definition.destructive) {
      const preview = await callHandlers(command.id, command.params, true);
      if (!preview.ok) return emit({ ...base, ...preview });
      pending = {
        key: `${command.id}-${Date.now()}`,
        commandId: command.id,
        source: command.source,
        summary: preview.message,
        expiresAt: Date.now() + CONFIRMATION_WINDOW_MS,
        run: () => callHandlers(command.id, command.params, false),
      };
      return emit({
        ...base,
        ok: true,
        needsConfirmation: true,
        message: `Confirma ${preview.message}? Diga "confirmar" ou "cancelar".`,
        spoken: `Confirma ${preview.spoken || preview.message}? Diga confirmar ou cancelar.`,
      });
    }
    const result = await callHandlers(command.id, command.params, false);
    if (result.silent) return { ...base, ...result, message: '' };
    return emit({ ...base, ...result });
  } catch (error) {
    return emit({ ...base, ok: false, message: `Não consegui concluir: ${error instanceof Error ? error.message : 'erro inesperado'}.` });
  }
}

async function resolvePending(confirmed: boolean): Promise<SiteCommandOutcome> {
  const current = pending;
  pending = null;
  if (!current) return emit({ commandId: confirmed ? 'confirm.yes' : 'confirm.no', source: 'local', ok: false, message: 'Não há nada aguardando confirmação.' });
  if (!confirmed) {
    try { current.cancel?.(); } catch { /* a janela pode já ter sido fechada */ }
    return emit({ commandId: 'confirm.no', source: 'local', ok: true, message: `Cancelado. Não vou ${current.summary}.` });
  }
  // O resultado é falado por quem executou a confirmação; 'system' fica só para o pedido.
  const source = current.source === 'system' ? 'local' : current.source;
  try {
    const result = await current.run();
    return emit({ commandId: current.commandId, source, ...result });
  } catch (error) {
    return emit({ commandId: current.commandId, source, ok: false, message: `Não consegui concluir: ${error instanceof Error ? error.message : 'erro inesperado'}.` });
  }
}

/**
 * Tenta executar a frase como comando do site.
 * Retorna null quando a frase não é um comando (ela segue para a conversa normal).
 */
export async function executeSiteCommandText(
  text: string,
  options: { allowRemote?: boolean } = {}
): Promise<SiteCommandOutcome | null> {
  const value = String(text || '').trim();
  if (!value) return null;
  const hasPending = Boolean(getPendingSiteCommand());
  let parsed = parseSiteCommand(value);

  if (parsed?.id === 'confirm.yes' || parsed?.id === 'confirm.no') {
    return hasPending ? resolvePending(parsed.id === 'confirm.yes') : null;
  }
  if (!parsed && options.allowRemote && environment.isAuthenticated && looksLikeSiteCommand(value)) {
    parsed = await interpretRemotely(value);
  }
  if (!parsed) return null;
  // Um novo comando substitui a confirmação anterior.
  pending = null;
  return runSiteCommand(parsed);
}

/** Lista de ids do catálogo sem ação registrada (usado nos testes e no diagnóstico). */
export function listUnboundSiteCommands(): string[] {
  return SITE_COMMANDS
    .filter((command) => !command.id.startsWith('confirm.'))
    .filter((command) => !hasSiteCommandHandler(command.id))
    .map((command) => command.id);
}

if (typeof window !== 'undefined') {
  // Permite automações e testes acionarem os mesmos comandos da voz.
  (window as any).frocSiteCommand = (text: string) => executeSiteCommandText(text, { allowRemote: false });
}
