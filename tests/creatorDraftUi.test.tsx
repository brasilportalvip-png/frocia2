// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../src/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'user-a' }, loading: false, isAuthenticated: true }) }));
vi.mock('../src/services/apiClient', () => ({ apiClient: vi.fn(async () => ({ configured: false, connected: false })) }));
vi.mock('../src/components/MascotWidget', () => ({ MascotWidget: () => null }));
import { Sidebar } from '../src/components/Sidebar';
let element: HTMLDivElement, root: Root;
const prompt = 'Crie um site para minha empresa com galeria e contato';
const draftKey = 'frocia_creation_draft_v2_user-a';
const props: any = { onGenerateSite: vi.fn(async () => false), onRefineSite: vi.fn(), onSelectTemplate: vi.fn(),
  onLoadSavedSite: vi.fn(), onNewChat: vi.fn(), isGenerating: false, isRefining: false, savedSites: [],
  activeSite: null, chatMessages: [], errorMsg: null };
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  sessionStorage.clear(); sessionStorage.setItem(draftKey, JSON.stringify({ prompt, attachedFiles: [], autoPublish: false }));
  props.onGenerateSite = vi.fn(async () => false);
  element = document.createElement('div'); document.body.appendChild(element); root = createRoot(element);
});
afterEach(async () => { await act(async () => root.unmount()); element.remove(); vi.clearAllMocks(); });
async function openCreator() {
  await act(async () => root.render(<Sidebar {...props} />));
  const button = [...element.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Criar projeto')!;
  await act(async () => button.click());
}
describe('Rascunho de criação', () => {
  it('preserva o pedido e a opção de não publicar quando a tarefa foi bloqueada', async () => {
    await openCreator();
    const textarea = element.querySelector('form textarea') as HTMLTextAreaElement;
    expect(textarea.value).toBe(prompt);
    await act(async () => { element.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(props.onGenerateSite).toHaveBeenCalledWith(expect.objectContaining({ prompt, autoPublish: false }), []);
    expect(textarea.value).toBe(prompt);
    expect(JSON.parse(sessionStorage.getItem(draftKey)!).prompt).toBe(prompt);
  });
  it('limpa somente o pedido realmente aceito pelo servidor', async () => {
    await openCreator();
    await act(async () => { window.dispatchEvent(new CustomEvent('froc:creation-accepted', { detail: { prompt: 'outro pedido' } })); });
    expect((element.querySelector('form textarea') as HTMLTextAreaElement).value).toBe(prompt);
    await act(async () => { window.dispatchEvent(new CustomEvent('froc:creation-accepted', { detail: { prompt } })); });
    expect((element.querySelector('form textarea') as HTMLTextAreaElement).value).toBe('');
  });
});
