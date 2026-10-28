// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { runInNewContext } from 'node:vm';
import { portablePreview } from '../server/development/preview';
import { writeArchive } from '../server/development/archive';

async function preview(code: string, attributes = 'type="module"', css?: string) {
  const source = new Map([
    ['index.html', { bytes: Buffer.from(`<html><head><script ${attributes} src="/app.js"></script>${css ? '<link rel="stylesheet" href="/app.css">' : ''}</head><body><div id="root"></div></body></html>`), mode: 0o644 }],
    ['app.js', { bytes: Buffer.from(code), mode: 0o644 }],
    ...(css ? [['app.css', { bytes: Buffer.from(css), mode: 0o644 }] as const] : []),
  ]);
  const html = await portablePreview(writeArchive(source));
  return { html, document: new DOMParser().parseFromString(html, 'text/html') };
}
describe('Prévia portátil fiel ao JavaScript e à ordem de carregamento', () => {
  it('preserva $&, $` e $\' sem reinserir a tag de origem dentro do JavaScript', async () => {
    const literal = "$& $` $'";
    const result = await preview('window.proof={replacement:"=".replace(/=/g,"$&/"),literal:' + JSON.stringify(literal) + '};document.getElementById("root").textContent="mounted";');
    const script = result.document.querySelector('script[type="module"]')!;
    expect(script).not.toBeNull(); expect(script.hasAttribute('src')).toBe(false);
    const target: any = {}, root = { textContent: '' };
    runInNewContext(script.textContent!, { window: target, document: { getElementById: () => root } });
    expect(target.proof.replacement).toBe('=/'); expect(target.proof.literal).toBe(literal); expect(root.textContent).toBe('mounted');
    expect(result.document.querySelectorAll('script')).toHaveLength(3);
  });
  it('mantém o script de módulo diferido e o DOM da raiz depois da tag', async () => {
    const result = await preview('window.ready=!!document.getElementById("root");');
    expect(result.document.head.querySelector('script[type="module"]')).not.toBeNull();
    expect(result.document.body.querySelector('#root')).not.toBeNull();
    expect(result.html).not.toContain('src="/app.js"');
  });
  it('aguarda DOMContentLoaded para scripts clássicos com defer', async () => {
    const result = await preview('window.ready=!!document.getElementById("root");', 'defer');
    const script = [...result.document.querySelectorAll('script')].at(-1)!;
    const target: any = {}; let root: any = null, loaded: (() => void) | undefined;
    runInNewContext(script.textContent!, { window: target, document: { readyState: 'loading', getElementById: () => root,
      addEventListener: (event: string, listener: () => void) => { expect(event).toBe('DOMContentLoaded'); loaded = listener; } } });
    expect(target.ready).toBeUndefined(); root = {}; loaded!(); expect(target.ready).toBe(true);
  });
  it('preserva cifrões no CSS e impede fechamento prematuro da tag script', async () => {
    const literal = "$& $` $'", result = await preview('window.tag="</script>";', 'type="module"', '.proof::after{content:' + JSON.stringify(literal) + ';}');
    expect(result.document.querySelector('style')!.textContent).toContain(literal);
    const target: any = {};
    runInNewContext(result.document.querySelector('script[type="module"]')!.textContent!, { window: target });
    expect(target.tag).toBe('</script>'); expect(result.document.querySelectorAll('script')).toHaveLength(3);
  });
  it('declara service worker indisponível quando o getter é bloqueado pela origem opaca', async () => {
    const result = await preview('window.ready=true;');
    const prototype = {}, navigator = Object.create(prototype);
    Object.defineProperty(prototype, 'serviceWorker', { configurable: true, get() { throw new Error('sandbox SecurityError'); } });
    runInNewContext(result.document.querySelector('script')!.textContent!, { navigator });
    expect('serviceWorker' in navigator).toBe(false);
    expect(result.html).toContain("worker-src 'none'"); expect(result.html).toContain("connect-src 'none'");
  });
});
