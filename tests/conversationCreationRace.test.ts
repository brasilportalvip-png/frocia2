import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Conversation creation continuity', () => {
  it('uses a synchronous conversation reference between creation and send', () => {
    const source = readFileSync(
      new URL('../src/App.tsx', import.meta.url),
      'utf8'
    );

    expect(source).toContain(
      'const currentConversationIdRef = useRef<string | null>(null);'
    );
    expect(source).toContain(
      'currentConversationIdRef.current = conversationId;'
    );
    expect(source).toMatch(
      /let activeConvId =\s*currentConversationIdRef\.current;/
    );
    expect(source).not.toMatch(
      /let activeConvId =\s*currentConversationId;/
    );
  });
});
