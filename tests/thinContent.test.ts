import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('THIN_CONTENT Audit', () => {
  it('should have enough text content in index.html to avoid THIN_CONTENT', () => {
    const html = readFileSync(join(process.cwd(), 'index.html'), 'utf-8');
    
    // Remove script and style contents to simulate text extraction
    const withoutScripts = html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ');
      
    const textContent = withoutScripts.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const wordCount = textContent.split(' ').filter(w => w.length > 0).length;
    
    expect(wordCount).toBeGreaterThanOrEqual(100);
  });
});
