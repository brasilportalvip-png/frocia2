import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Large memory capacity contract', () => {
  it('keeps an expanded recent window and context budget', () => {
    const builder = readFileSync(
      new URL('../server/ai/contextBuilder.ts', import.meta.url),
      'utf8'
    );
    const conversation = readFileSync(
      new URL('../server/ai/conversationContextService.ts', import.meta.url),
      'utf8'
    );

    expect(builder).toContain('const MAX_RECENT_MESSAGES = 24;');
    expect(builder).toContain('maxContextTokens = 48000');
    expect(conversation).toContain('const RECENT_MESSAGE_LIMIT = 32;');
    expect(conversation).toContain('const QUERY_LIMIT = 400;');
  });

  it('expands semantic long-term retrieval without removing safety limits', () => {
    const longTerm = readFileSync(
      new URL('../server/ai/longTermConversationMemoryService.ts', import.meta.url),
      'utf8'
    );
    const managed = readFileSync(
      new URL('../server/ai/memoryService.ts', import.meta.url),
      'utf8'
    );

    expect(longTerm).toContain('const RETRIEVAL_CANDIDATE_LIMIT = 1_000;');
    expect(longTerm).toContain('const RETRIEVAL_RESULT_LIMIT = 12;');
    expect(longTerm).toContain('const STATS_DOCUMENT_LIMIT = 20_000;');
    expect(managed).toContain('const MAX_CONTEXT_MEMORIES = 32;');
    expect(managed).toContain('const MAX_MANAGED_MEMORIES = 1_000;');
  });
});
