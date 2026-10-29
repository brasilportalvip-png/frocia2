import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

describe('Proteção contra requisições autenticadas para visitantes não autenticados', () => {
  it('garante que loadMessagesForConversation em src/App.tsx verifica se o usuário está autenticado antes de consultar a API', () => {
    const appContent = readFileSync('src/App.tsx', 'utf-8');
    // Procura a declaração de loadMessagesForConversation e a validação de isAuthenticated antes de chamar a rota
    const fnIndex = appContent.indexOf('const loadMessagesForConversation = async');
    expect(fnIndex).toBeGreaterThan(-1);
    const fnBody = appContent.slice(fnIndex, fnIndex + 300);
    expect(fnBody).toMatch(/if\s*\(!isAuthenticated\)\s*return\s*false;/);
  });
});
