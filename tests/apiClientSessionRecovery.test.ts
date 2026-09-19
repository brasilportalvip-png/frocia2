import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getIdToken } = vi.hoisted(() => ({ getIdToken: vi.fn() }));
vi.mock('../src/lib/firebase.js', () => ({
  auth: { currentUser: { getIdToken } },
}));

import { apiClient } from '../src/services/apiClient.js';

describe('apiClient session recovery', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    getIdToken.mockReset();
  });

  it('renova o token uma vez após 401 e repete a requisição', async () => {
    getIdToken.mockResolvedValueOnce('old-token').mockResolvedValueOnce('new-token');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'expired' }), { status: 401, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiClient('/api/private')).resolves.toEqual({ ok: true });
    expect(getIdToken).toHaveBeenNthCalledWith(2, true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(new Headers(fetchMock.mock.calls[1][1].headers).get('Authorization')).toBe('Bearer new-token');
  });

  it('não entra em loop quando o segundo pedido continua não autorizado', async () => {
    getIdToken.mockResolvedValueOnce('old-token').mockResolvedValueOnce('new-token');
    const unauthorized = () => new Response(JSON.stringify({ error: 'expired' }), { status: 401, headers: { 'content-type': 'application/json' } });
    const fetchMock = vi.fn().mockImplementation(async () => unauthorized());
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiClient('/api/private')).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
