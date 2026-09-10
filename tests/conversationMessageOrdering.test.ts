import { describe, expect, it } from 'vitest';
import { orderConversationMessages } from '../server/utils/conversationMessageOrdering.js';

describe('ordenação do histórico da conversa', () => {
  it('mantém a pergunta antes da resposta quando o Firestore atribui o mesmo horário', () => {
    const createdAt = new Date('2026-09-10T10:00:00.000Z');
    const ordered = orderConversationMessages([
      { id: 'msg_ast_exec-1', role: 'assistant', executionId: 'exec-1', createdAt },
      { id: 'msg_usr_exec-1', role: 'user', executionId: 'exec-1', createdAt }
    ]);

    expect(ordered.map((message) => message.role)).toEqual(['user', 'assistant']);
  });

  it('usa messageOrder para novas mensagens e preserva a ordem cronológica entre execuções', () => {
    const ordered = orderConversationMessages([
      { id: 'b', role: 'assistant', executionId: 'exec-2', messageOrder: 1, createdAt: '2026-09-10T10:01:00Z' },
      { id: 'a', role: 'user', executionId: 'exec-2', messageOrder: 0, createdAt: '2026-09-10T10:01:00Z' },
      { id: 'old', role: 'assistant', executionId: 'exec-1', messageOrder: 1, createdAt: '2026-09-10T10:00:00Z' }
    ]);

    expect(ordered.map((message) => message.id)).toEqual(['old', 'a', 'b']);
  });
});
