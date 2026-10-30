import { describe, expect, it } from 'vitest';
import { bundleStaticSite } from '../server/services/staticSiteBundler.js';

const enc = (s: string) => new TextEncoder().encode(s);
const ctx = { owner: 'o', repo: 'r', branch: 'main' };

describe('bundleStaticSite', () => {
  const files: Record<string, Uint8Array> = {
    'o-r-abc/index.html': enc('<!doctype html><html><head><title>Loja Bela</title><link rel="stylesheet" href="css/style.css"></head><body style="background:url(img/bg.png)"><img src="img/logo.png" srcset="img/logo.png 1x, img/big.jpg 2x"><img src="img/missing.png"><a href="sobre.html">Sobre</a><a href="https://x.com">x</a><script src="js/app.js"></script></body></html>'),
    'o-r-abc/css/style.css': enc('@import "base.css"; body{background:url("../img/bg.png")} @font-face{src:url(../fonts/f.woff2)}'),
    'o-r-abc/css/base.css': enc('h1{color:red}'),
    'o-r-abc/js/app.js': enc('console.log("</script>")'),
    'o-r-abc/img/logo.png': new Uint8Array([1, 2, 3]),
    'o-r-abc/img/bg.png': new Uint8Array([9, 9]),
    'o-r-abc/img/big.jpg': new Uint8Array(300_000).fill(7),
    'o-r-abc/fonts/f.woff2': new Uint8Array([5]),
    'o-r-abc/sobre.html': enc('<html></html>'),
    'o-r-abc/.env': enc('SECRET=1'),
  };

  it('embute CSS/JS, converte imagens e relata o que falta', () => {
    const result = bundleStaticSite(files, ctx);
    const html = result.html!;
    expect(result.title).toBe('Loja Bela');
    expect(result.report.kind).toBe('static');
    expect(result.report.entry).toBe('index.html');
    expect(html).toContain('<style data-froc-source="css/style.css"');
    expect(html).toContain('h1{color:red}');
    expect(html).toContain('data:image/png;base64,');
    expect(html).toContain('https://cdn.jsdelivr.net/gh/o/r@main/img/big.jpg');
    expect(html).toContain('<\\/script');
    expect(html).not.toContain('SECRET');
    expect(result.report.protectedFilesSkipped).toBe(1);
    expect(result.report.otherPages).toEqual(['sobre.html']);
    expect(result.report.missingReferences).toEqual(['img/missing.png']);
    expect(result.report.complete).toBe(false);
  });

  it('marca como completo quando nada falta', () => {
    const result = bundleStaticSite({
      'x/index.html': enc('<html><head><title>Ok</title><link rel="stylesheet" href="a.css"></head><body><img src="/i.png"></body></html>'),
      'x/a.css': enc('p{margin:0}'),
      'x/i.png': new Uint8Array([1]),
    }, ctx);
    expect(result.report.complete).toBe(true);
    expect(result.html).toContain('data:image/png');
  });

  it('detecta projeto que precisa de build e não finge abrir', () => {
    const result = bundleStaticSite({
      'a/index.html': enc('<div id="root"></div><script type="module" src="/src/main.tsx"></script>'),
      'a/package.json': enc('{}'),
    }, ctx);
    expect(result.report.kind).toBe('build_required');
    expect(result.html).toBeNull();
    expect(result.report.message).toContain('build');
  });

  it('avisa quando não há HTML', () => {
    const result = bundleStaticSite({ 'a/README.md': enc('x') }, ctx);
    expect(result.report.kind).toBe('no_html');
    expect(result.html).toBeNull();
  });

  it('usa a CDN para módulos com import relativo', () => {
    const result = bundleStaticSite({
      'a/index.html': enc('<html><body><script type="module" src="main.js"></script></body></html>'),
      'a/main.js': enc("import { x } from './x.js'; x();"),
      'a/x.js': enc('export const x=()=>1'),
    }, ctx);
    expect(result.html).toContain('https://cdn.jsdelivr.net/gh/o/r@main/main.js');
  });
});
