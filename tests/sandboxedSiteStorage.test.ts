import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildSandboxedSiteDocument,
  persistSandboxStorageMessage,
  SANDBOX_STORAGE_MESSAGE,
} from '../src/services/sandboxedSiteStorage';

describe('ponte segura de armazenamento da prévia', () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
      },
    });
  });

  it('injeta o localStorage compatível antes dos scripts do projeto', () => {
    const result = buildSandboxedSiteDocument(
      '<!doctype html><html><head><script>localStorage.setItem("paciente","Ana")</script></head></html>',
      'site-1'
    );
    expect(result.indexOf("Object.defineProperty(window,'localStorage'")).toBeGreaterThan(-1);
    expect(result.indexOf("Object.defineProperty(window,'localStorage'")).toBeLessThan(
      result.indexOf('localStorage.setItem("paciente"')
    );
  });

  it('persiste somente mensagens válidas do projeto esperado', () => {
    expect(
      persistSandboxStorageMessage(
        { type: SANDBOX_STORAGE_MESSAGE, siteId: 'site-1', entries: { pacientes: '[{"nome":"Ana"}]' } },
        'site-1'
      )
    ).toBe(true);
    expect(window.localStorage.getItem('frocia_preview_storage_v1_site-1')).toContain('Ana');
    expect(
      persistSandboxStorageMessage(
        { type: SANDBOX_STORAGE_MESSAGE, siteId: 'outro-site', entries: {} },
        'site-1'
      )
    ).toBe(false);
  });
});
