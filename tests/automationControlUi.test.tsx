// @vitest-environment happy-dom
import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AutomationControl } from '../src/components/self-evolution/AutomationControl';

let container: HTMLDivElement;
let root: Root;
const headers = async () => ({ Authorization: 'Bearer admin-test-token' });
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
const toggle = () => container.querySelector('[role="switch"]') as HTMLButtonElement;

describe('Liga/desliga no painel administrativo', () => {
  it('envia desligamento autenticado, espera o recibo e exibe o estado relido', async () => {
    let complete!: (value: Response) => void;
    const fetch = vi.fn(() => new Promise<Response>(resolve => { complete = resolve; }));
    vi.stubGlobal('fetch', fetch);
    function Panel() {
      const [enabled, setEnabled] = useState(true);
      return <AutomationControl enabled={enabled} getAuthHeader={headers} onChanged={async () => { setEnabled(false); }} />;
    }
    await act(async () => root.render(<Panel />));
    expect(toggle().getAttribute('aria-checked')).toBe('true');
    await act(async () => toggle().click());
    expect(toggle().disabled).toBe(true);
    expect(toggle().getAttribute('aria-checked')).toBe('true');
    expect(fetch).toHaveBeenCalledWith('/api/admin/self-evolution/control/enabled', expect.objectContaining({
      method: 'POST', headers: expect.objectContaining({ Authorization: 'Bearer admin-test-token' }), body: '{"enabled":false}',
    }));
    await act(async () => complete(Response.json({ enabled: false, workflowControl: { success: true }, message: 'Agendamento desabilitado.' })));
    expect(toggle().getAttribute('aria-checked')).toBe('false');
    expect(container.querySelector('[role="status"]')?.textContent).toContain('desabilitado');
  });
  it('não mostra ligado quando o servidor recusou a ativação e permite recuperar falha de pausa', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ message: 'GitHub recusou.' }, { status: 503 })));
    const refresh = vi.fn(async () => {});
    await act(async () => root.render(<AutomationControl enabled={false} getAuthHeader={headers} onChanged={refresh} />));
    await act(async () => toggle().click());
    expect(toggle().getAttribute('aria-checked')).toBe('false');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('GitHub recusou');
    expect(refresh).toHaveBeenCalledOnce();
  });
  it('oferece concluir desligamento quando a pausa foi salva mas o cancelamento ficou incompleto', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ enabled: false,
      workflowControl: { success: true, cancellationIncomplete: true }, message: 'Cancelamento não confirmado.' })));
    await act(async () => root.render(<AutomationControl enabled={true} getAuthHeader={headers} onChanged={async () => {}} />));
    await act(async () => toggle().click());
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('não confirmado');
    expect([...container.querySelectorAll('button')].some(button => button.textContent?.includes('Concluir desligamento'))).toBe(true);
  });
  it('bloqueia alteração enquanto ainda não conhece o estado real', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await act(async () => root.render(<AutomationControl enabled={null} getAuthHeader={headers} onChanged={async () => {}} />));
    expect(toggle().disabled).toBe(true);
    await act(async () => toggle().click());
    expect(fetch).not.toHaveBeenCalled();
  });
});
