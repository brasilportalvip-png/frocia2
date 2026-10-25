// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../src/lib/firebase', () => ({ auth: null }));
vi.mock('../src/services/apiClient', () => ({ apiClient: vi.fn() }));
import { apiClient } from '../src/services/apiClient';
import { SelfEvolutionDashboard } from '../src/components/self-evolution/SelfEvolutionDashboard';

const candidates = [
  { id: 'site-audit-one', title: 'Auditoria do site', summary: 'Erro de console', riskLevel: 'R1', state: 'detected' },
  { id: 'owner-task-two', title: 'Investigar e corrigir o próprio site', summary: 'Pedido do proprietário', riskLevel: 'R2', state: 'failed' },
];
const incomplete = { commitSha: null, reviews: [], gate: { status: 'incomplete', approved: false, reason: 'O commit ainda não foi registrado.' } };
const blocked = { commitSha: 'a'.repeat(40), gate: { status: 'blocked', approved: false, reason: 'Revisão requer correção.' },
  reviews: [{ id: 'qa-test', role: 'qa', actorUid: 'reviewer-qa', verdict: 'changes_required', summary: 'Falta um teste de regressão específico.',
    fileRefs: ['server/fix.ts'], testRefs: [], evidenceRefs: ['ci:test'], risks: ['Cobertura insuficiente.'] }] };
let container: HTMLDivElement;
let root: Root;
function button(label: string, index = 0): HTMLButtonElement {
  const matches = [...container.querySelectorAll('button')].filter(item => item.textContent?.trim() === label);
  if (!matches[index]) throw new Error('Botão não encontrado: ' + label);
  return matches[index];
}
async function click(element: HTMLElement) { await act(async () => { element.focus(); element.click(); }); }
async function mount() { await act(async () => root.render(<SelfEvolutionDashboard />)); }

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  history.replaceState(null, '', '/');
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith('/status')
    ? { enabled: true, autonomousProductionDeployAllowed: true, candidatesCount: 2,
      budget: { dailyCreditLimit: 500, dailyCreditsUsed: 40, dailyAgentRunsCount: 1, dailyMaxAgentRuns: 10 } }
    : { candidates }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks();
});

describe('Clique real nos controles da fila', () => {
  it('abre o comitê da tarefa escolhida em uma janela, limpa a seleção anterior e mostra carregamento', async () => {
    let resolve: (value: unknown) => void = () => {};
    vi.mocked(apiClient).mockResolvedValueOnce(incomplete).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    await mount();
    await click(button('Ver Comitê', 0));
    expect(container.querySelector('dialog')?.open).toBe(true);
    expect(container.textContent).toContain('site-audit-one');
    expect(container.textContent).toContain('Esta tarefa ainda não tem um commit');
    await click(button('Fechar comitê'));
    const trigger = button('Ver Comitê', 1);
    await click(trigger);
    expect(container.textContent).toContain('Carregando pareceres desta tarefa');
    expect(container.textContent).not.toContain('O commit ainda não foi registrado.');
    expect(apiClient).toHaveBeenLastCalledWith('/api/admin/self-evolution/committee/owner-task-two/reviews', expect.objectContaining({ method: 'GET' }));
    await act(async () => resolve(blocked));
    const dialog = container.querySelector('dialog')!;
    expect(dialog.textContent).toContain('owner-task-two');
    expect(dialog.textContent).toContain('Falta um teste de regressão específico.');
    expect(dialog.textContent).toContain('CHANGES_REQUIRED');
    expect(dialog.querySelector('a')?.href).toContain('committee=owner-task-two');
    await click(button('Fechar comitê'));
    expect(container.querySelector('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
  it('mostra falha da consulta no próprio comitê e permite tentar novamente', async () => {
    vi.mocked(apiClient).mockRejectedValueOnce(new Error('Sessão expirada. Entre novamente.')).mockResolvedValueOnce(blocked);
    await mount(); await click(button('Ver Comitê', 1));
    expect(container.querySelector('[role=alert]')?.textContent).toContain('Sessão expirada');
    expect(container.querySelector('dialog')?.open).toBe(true);
    await click(button('Tentar novamente'));
    expect(container.textContent).toContain('Falta um teste de regressão específico.');
    expect(container.querySelector('[role=alert]')).toBeNull();
  });
  it('termina uma consulta presa sem manter o botão desabilitado indefinidamente', async () => {
    vi.useFakeTimers();
    vi.mocked(apiClient).mockImplementation(() => new Promise(() => {}));
    await mount(); await click(button('Ver Comitê', 1));
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(container.querySelector('[role=alert]')?.textContent).toContain('demorou mais');
    expect(button('Tentar novamente').disabled).toBe(false);
    await click(button('Fechar comitê'));
    expect(container.querySelector('dialog')).toBeNull();
  });
  it('um link direto consulta a tarefa correta ao carregar o painel', async () => {
    history.replaceState(null, '', '/?view=admin&tab=selfEvolution&committee=owner-task-two');
    vi.mocked(apiClient).mockResolvedValue(blocked);
    await mount();
    expect(apiClient).toHaveBeenCalledWith('/api/admin/self-evolution/committee/owner-task-two/reviews', expect.anything());
    expect(container.querySelector('dialog')?.textContent).toContain('owner-task-two');
  });
  it('confirma a identidade do item, permite cancelar e exclui somente a tarefa selecionada', async () => {
    vi.mocked(apiClient).mockResolvedValue({ deleted: true, candidateId: 'owner-task-two' });
    await mount(); await click(button('Excluir', 1));
    expect(container.querySelector('dialog')?.textContent).toContain('owner-task-two');
    await click(button('Cancelar'));
    expect(apiClient).not.toHaveBeenCalled();
    expect(container.querySelectorAll('button').length).toBeGreaterThan(0);
    await click(button('Excluir', 1)); await click(button('Excluir tarefa'));
    expect(apiClient).toHaveBeenCalledWith('/api/admin/self-evolution/candidates/owner-task-two', expect.objectContaining({
      method: 'DELETE', body: JSON.stringify({ confirmation: 'owner-task-two' }),
    }));
    expect(container.querySelector('dialog')).toBeNull();
    expect(container.textContent).not.toContain('Pedido do proprietário');
    expect(container.textContent).toContain('Erro de console');
    expect(container.querySelector('[role=status]')?.textContent).toContain('Histórico de auditoria preservado');
  });
  it('exibe o bloqueio de uma tarefa em execução e a conserva na fila', async () => {
    vi.mocked(apiClient).mockRejectedValue(new Error('Esta tarefa está em execução. Aguarde a conclusão para excluí-la.'));
    await mount(); await click(button('Excluir', 1)); await click(button('Excluir tarefa'));
    expect(container.querySelector('dialog')?.querySelector('[role=alert]')?.textContent).toContain('em execução');
    expect(container.textContent).toContain('Pedido do proprietário');
    expect(button('Excluir tarefa').disabled).toBe(false);
  });
});
