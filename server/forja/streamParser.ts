export type StreamParserEvent =
  | { type: 'plan_delta'; text: string }
  | { type: 'file_start'; path: string }
  | { type: 'file_delta'; path: string; chunk: string }
  | { type: 'file_end'; path: string }
  /** A resposta acabou no meio do arquivo (limite de tamanho ou de tempo): o arquivo está incompleto. */
  | { type: 'file_truncated'; path: string }
  | { type: 'summary_delta'; text: string };

type ParserState =
  | { mode: 'idle' }
  | { mode: 'plan' }
  | { mode: 'file'; path: string }
  | { mode: 'summary' };

/**
 * Incremental XML-like tag stream parser for:
 * <architect_plan>...</architect_plan>
 * <file path="...">...</file>
 * <summary>...</summary>
 *
 * Buffers potential partial tags across chunk boundaries cleanly.
 */
export class ArchitectStreamParser {
  private buffer = '';
  private state: ParserState = { mode: 'idle' };

  push(chunk: string): StreamParserEvent[] {
    this.buffer += chunk;
    const events: StreamParserEvent[] = [];

    let keepGoing = true;
    while (keepGoing) {
      keepGoing = false;

      if (this.state.mode === 'idle') {
        const nextPlan = this.buffer.indexOf('<architect_plan>');
        const nextSummary = this.buffer.indexOf('<summary>');
        const fileMatch = /<file\s+path="([^"]+)">/.exec(this.buffer);
        const nextFile = fileMatch ? fileMatch.index : -1;

        const candidates = [
          nextPlan >= 0 ? { kind: 'plan' as const, idx: nextPlan, len: '<architect_plan>'.length } : null,
          nextSummary >= 0 ? { kind: 'summary' as const, idx: nextSummary, len: '<summary>'.length } : null,
          fileMatch && nextFile >= 0
            ? { kind: 'file' as const, idx: nextFile, len: fileMatch[0].length, path: fileMatch[1] }
            : null,
        ].filter((c): c is NonNullable<typeof c> => c !== null);

        if (candidates.length > 0) {
          candidates.sort((a, b) => a.idx - b.idx);
          const earliest = candidates[0];
          this.buffer = this.buffer.slice(earliest.idx + earliest.len);

          if (earliest.kind === 'plan') {
            this.state = { mode: 'plan' };
          } else if (earliest.kind === 'summary') {
            this.state = { mode: 'summary' };
          } else {
            this.state = { mode: 'file', path: earliest.path };
            events.push({ type: 'file_start', path: earliest.path });
          }
          // Strip leading single newline right after opening tag
          if (this.buffer.startsWith('\n')) {
            this.buffer = this.buffer.slice(1);
          }
          keepGoing = true;
        } else {
          // Keep at most the tail starting at the last '<' in case a tag is split across chunks
          const lastLt = this.buffer.lastIndexOf('<');
          if (lastLt >= 0) {
            this.buffer = this.buffer.slice(lastLt);
          } else {
            this.buffer = '';
          }
        }
      } else if (this.state.mode === 'plan') {
        const closeTag = '</architect_plan>';
        const closeIdx = this.buffer.indexOf(closeTag);
        if (closeIdx >= 0) {
          const text = this.buffer.slice(0, closeIdx);
          if (text) events.push({ type: 'plan_delta', text });
          this.buffer = this.buffer.slice(closeIdx + closeTag.length);
          this.state = { mode: 'idle' };
          keepGoing = true;
        } else {
          const safeLen = this.safeFlushLength(closeTag);
          if (safeLen > 0) {
            events.push({ type: 'plan_delta', text: this.buffer.slice(0, safeLen) });
            this.buffer = this.buffer.slice(safeLen);
          }
        }
      } else if (this.state.mode === 'summary') {
        const closeTag = '</summary>';
        const closeIdx = this.buffer.indexOf(closeTag);
        if (closeIdx >= 0) {
          const text = this.buffer.slice(0, closeIdx);
          if (text) events.push({ type: 'summary_delta', text });
          this.buffer = this.buffer.slice(closeIdx + closeTag.length);
          this.state = { mode: 'idle' };
          keepGoing = true;
        } else {
          const safeLen = this.safeFlushLength(closeTag);
          if (safeLen > 0) {
            events.push({ type: 'summary_delta', text: this.buffer.slice(0, safeLen) });
            this.buffer = this.buffer.slice(safeLen);
          }
        }
      } else if (this.state.mode === 'file') {
        const closeTag = '</file>';
        const closeIdx = this.buffer.indexOf(closeTag);
        if (closeIdx >= 0) {
          let content = this.buffer.slice(0, closeIdx);
          if (content.endsWith('\n')) {
            content = content.slice(0, -1);
          }
          if (content) {
            events.push({ type: 'file_delta', path: this.state.path, chunk: content });
          }
          events.push({ type: 'file_end', path: this.state.path });
          this.buffer = this.buffer.slice(closeIdx + closeTag.length);
          this.state = { mode: 'idle' };
          keepGoing = true;
        } else {
          const safeLen = this.safeFlushLength(closeTag);
          if (safeLen > 0) {
            events.push({
              type: 'file_delta',
              path: this.state.path,
              chunk: this.buffer.slice(0, safeLen),
            });
            this.buffer = this.buffer.slice(safeLen);
          }
        }
      }
    }

    return events;
  }

  flush(): StreamParserEvent[] {
    const events: StreamParserEvent[] = [];
    if (this.state.mode === 'plan' && this.buffer) {
      events.push({ type: 'plan_delta', text: this.buffer });
    } else if (this.state.mode === 'summary' && this.buffer) {
      events.push({ type: 'summary_delta', text: this.buffer });
    } else if (this.state.mode === 'file') {
      // Sem </file>: o arquivo veio cortado. Nunca vira arquivo "pronto" (antes ele era salvo
      // pela metade e quebrava a compilação com "Unterminated string literal").
      events.push({ type: 'file_truncated', path: this.state.path });
    }
    this.buffer = '';
    this.state = { mode: 'idle' };
    return events;
  }

  private safeFlushLength(closeTag: string): number {
    // Hold back at most (closeTag.length - 1) chars if a '<' could start closeTag
    const minTail = closeTag.length - 1;
    if (this.buffer.length <= minTail) return 0;
    const lastLt = this.buffer.lastIndexOf('<');
    if (lastLt === -1) return this.buffer.length;
    if (this.buffer.length - lastLt <= minTail) {
      return lastLt;
    }
    return this.buffer.length;
  }
}
