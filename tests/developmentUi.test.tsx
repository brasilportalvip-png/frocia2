// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../src/services/apiClient', () => ({ apiClient: vi.fn() }));
vi.mock('../src/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'alice', role: 'user' } }) }));
vi.mock('../src/components/GithubConnectionPanel', () => ({ GithubConnectionPanel: () => <div>Conexão opcional para entrega</div> }));
import { apiClient } from '../src/services/apiClient';
import { DevelopmentImporter } from '../src/components/DevelopmentImporter';
import { DevelopmentPanel } from '../src/components/DevelopmentPanel';
import { PreviewFrame } from '../src/components/PreviewFrame';
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
let root: Root, container: HTMLDivElement;
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.resetAllMocks(); });
describe('Interface de projeto existente, sem prévia vazia ou falsa execução', () => {
  it('importa o GitHub público sem exigir instalação do App', async () => {
    vi.mocked(apiClient).mockResolvedValue({ workspace: { id: 'workspace-one' } });
    const listener = vi.fn(); window.addEventListener('froc:development-workspace', listener);
    await act(async () => root.render(<DevelopmentImporter />));
    const input = container.querySelector('input[type=url]') as HTMLInputElement;
    await act(async () => { const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!; setter.call(input, 'https://github.com/a/b'); input.dispatchEvent(new Event('input', { bubbles: true })); });
    await act(async () => { (container.querySelector('button') as HTMLButtonElement).click(); await tick(); });
    expect(apiClient).toHaveBeenCalledWith('/api/development/imports/github', expect.objectContaining({ method: 'POST' }));
    expect(listener).toHaveBeenCalled(); expect(container.textContent).toContain('não exige instalar GitHub App');
    window.removeEventListener('froc:development-workspace', listener);
  });
  it('mostra o bloqueio persistido com tarefa e arquivos, sem dizer que está executando', async () => {
    vi.mocked(apiClient).mockImplementation(async endpoint => {
      if (endpoint.endsWith('/manifest')) return { fileCount: 100, bytes: 12345, digest: 'real-digest', files: [{ path: 'server/main.ts', size: 123 }] } as any;
      if (endpoint.includes('/jobs/')) return { job: { id: 'devjob-real', status: 'blocked', diagnostic: 'Workflow central desabilitado.', authorizedCredits: 50, consumedCredits: 0 } } as any;
      return { workspace: { id: 'workspace-one', title: 'Projeto original', status: 'imported', revision: 'bytes-version', activeJobId: 'devjob-real' } } as any;
    });
    await act(async () => { root.render(<DevelopmentPanel workspaceId="workspace-one" onClose={() => {}} />); await tick(); });
    expect(container.textContent).toContain('Bloqueado'); expect(container.textContent).toContain('Workflow central desabilitado.');
    expect(container.textContent).toContain('devjob-real'); expect(container.textContent).toContain('server/main.ts');
    expect(container.querySelector('iframe')).toBeNull();
    const confirm = [...container.querySelectorAll('button')].find(button => button.textContent === 'Confirmar desenvolvimento')!;
    expect(confirm.disabled).toBe(true); expect(apiClient).not.toHaveBeenCalledWith(expect.stringContaining('/jobs'), expect.objectContaining({ method: 'POST' }));
  });
  it('troca o iframe vazio por uma indicação explícita do workspace', async () => {
    await act(async () => root.render(<PreviewFrame site={{ id: 'workspace-one', workspaceId: 'workspace-one', sourceKind: 'workspace', title: 'Original', html: '' } as any}
      deviceView="desktop" isGenerating={false} onOpenFullscreen={() => {}} onRefresh={() => {}} />));
    expect(container.textContent).toContain('Projeto importado: Original');
    expect(container.textContent).toContain('Abrir arquivos e estado da execução'); expect(container.querySelector('iframe')).toBeNull();
  });
});
