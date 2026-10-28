import path from 'node:path';
import { build } from 'esbuild';
import { readArchive, type SourceFiles, DevelopmentError } from './archive.js';

const mime = (name: string) => ({ '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ico': 'image/x-icon' }[path.posix.extname(name)] || 'application/octet-stream');
/** Parsing/bundling only. Project JavaScript is never imported into the trusted Node process. */
export async function portablePreview(archive: Uint8Array) {
  const files = readArchive(archive), htmlFile = files.get('index.html');
  if (!htmlFile) throw new DevelopmentError('preview_adapter_required', 'O build não contém index.html; este framework precisa de um adaptador de prévia.');
  const locate = (specifier: string, parent = 'index.html') => {
    const cleaned = specifier.split(/[?#]/)[0];
    const key = path.posix.normalize(cleaned.startsWith('/') ? cleaned.slice(1) : path.posix.join(path.posix.dirname(parent), cleaned));
    if (key.startsWith('../') || !files.has(key)) throw new DevelopmentError('preview_asset_unavailable', `Asset de prévia não encontrado: ${cleaned.slice(0, 160)}.`);
    return key;
  };
  const dataUri = (key: string) => `data:${mime(key)};base64,${Buffer.from(files.get(key)!.bytes).toString('base64')}`;
  const bundle = async (entry: string, css = false) => {
    const result = await build({ entryPoints: [entry], bundle: true, write: false, minify: false, format: 'iife', platform: 'browser', logLevel: 'silent',
      plugins: [{ name: 'private-preview-files', setup(builder) {
        builder.onResolve({ filter: /.*/ }, args => {
          if (args.path.startsWith('data:')) return { path: args.path, external: true };
          if (/^https?:/.test(args.path) && ['import-rule', 'url-token'].includes(args.kind)) return { path: args.path, external: true };
          if (/^(?:https?:|node:)/.test(args.path)) return { errors: [{ text: 'Preview dependencies must be local.' }] };
          try { return { path: args.kind === 'entry-point' ? entry : locate(args.path, args.importer), namespace: 'preview' }; }
          catch { return { errors: [{ text: 'Preview asset not included.' }] }; }
        });
        builder.onLoad({ filter: /.*/, namespace: 'preview' }, args => {
          const file = files.get(args.path)!;
          const extension = path.posix.extname(args.path);
          if (!['.js', '.mjs', '.cjs', '.css', '.json'].includes(extension)) return { contents: file.bytes, loader: 'dataurl' };
          let text = Buffer.from(file.bytes).toString();
          if (extension !== '.css') {
            // srcdoc has an opaque origin. A private in-memory route keeps SPAs usable without granting same-origin access.
            text = text.replace(/\bwindow\.location\.(pathname|search|hash)\b/g, 'window.__FROC_PREVIEW_LOCATION__.$1');
            for (const key of files.keys()) if (!/\.(?:js|mjs|css|json|html)$/.test(key) && files.get(key)!.bytes.length < 2_000_000) {
              text = text.split(JSON.stringify('/' + key)).join(JSON.stringify(dataUri(key)));
            }
          }
          return { contents: text, loader: extension === '.css' ? 'css' : extension === '.json' ? 'json' : 'js', resolveDir: '/' };
        });
      } }] });
    return result.outputFiles.filter(file => css ? file.path.endsWith('.css') || file.path === '<stdout>' : !file.path.endsWith('.css')).map(file => file.text).join('\n');
  };
  let html = Buffer.from(htmlFile.bytes).toString();
  const scripts = [...html.matchAll(/<script\b([^>]*?)src=["']([^"']+)["']([^>]*)>\s*<\/script>/gi)];
  for (const script of scripts) {
    const key = locate(script[2]), code = await bundle(key);
    const attributes = script[1] + ' ' + script[3];
    const module = /\btype\s*=\s*["']module["']/i.test(attributes);
    const deferred = !module && /\bdefer\b/i.test(attributes);
    const escaped = code.replace(/<\/script/gi, '<\\/script');
    const content = deferred ? `(()=>{const run=()=>{${escaped}\n};if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',run,{once:true});else run();})();` : escaped;
    // A replacement callback preserves literal $&, $` and $' in bundled code.
    // Module scripts must also retain deferred parsing: React needs its root DOM.
    html = html.replace(script[0], () => `<script${module ? ' type="module"' : ''}>${content}</script>`);
  }
  const styles = [...html.matchAll(/<link\b[^>]*rel=["']stylesheet["'][^>]*>/gi)];
  for (const style of styles) {
    const href = style[0].match(/href=["']([^"']+)["']/i)?.[1]; if (!href) continue;
    const css = await bundle(locate(href), true); html = html.replace(style[0], () => `<style>${css.replace(/<\/style/gi, '<\\/style')}</style>`);
  }
  html = html.replace(/<link\b[^>]*rel=["'](?:modulepreload|preload)["'][^>]*>/gi, '');
  html = html.replace(/\b(src|poster|href)=["'](\/(?!\/)[^"']+)["']/gi, (full, attribute, value) => {
    try { return `${attribute}="${dataUri(locate(value))}"`; } catch { return full; }
  });
  const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'; frame-src 'none'; worker-src 'none'; base-uri 'none'">`;
  // Opaque frames cannot use service workers. Make feature detection truthful
  // instead of exposing a Navigator getter that throws before a PWA can render.
  const capabilities = `<script>(()=>{try{void navigator.serviceWorker;}catch{for(let current=navigator;current;current=Object.getPrototypeOf(current)){if(Object.prototype.hasOwnProperty.call(current,'serviceWorker')){Reflect.deleteProperty(current,'serviceWorker');break;}}}})();</script>`;
  const isolation = `<script>(()=>{const virtual=window.__FROC_PREVIEW_LOCATION__={pathname:'/',search:'',hash:''};const entries=['/'];let position=0;const set=url=>{const parsed=new URL(String(url||'/'),'https://preview.invalid');if(parsed.origin!=='https://preview.invalid')throw new Error('Preview navigation blocked');virtual.pathname=parsed.pathname;virtual.search=parsed.search;virtual.hash=parsed.hash;};history.pushState=(state,unused,url)=>{set(url);entries.splice(++position);entries.push(virtual.pathname+virtual.search+virtual.hash);};history.replaceState=(state,unused,url)=>{set(url);entries[position]=virtual.pathname+virtual.search+virtual.hash;};history.go=delta=>{position=Math.max(0,Math.min(entries.length-1,position+(Number(delta)||0)));set(entries[position]);dispatchEvent(new PopStateEvent('popstate'));};history.back=()=>history.go(-1);history.forward=()=>history.go(1);for(const key of ['localStorage','sessionStorage']){try{window[key].getItem('preview-check');}catch{const values=new Map;Object.defineProperty(window,key,{value:{getItem:k=>values.get(String(k))??null,setItem:(k,v)=>values.set(String(k),String(v)),removeItem:k=>values.delete(String(k)),clear:()=>values.clear(),key:i=>[...values.keys()][i]??null,get length(){return values.size;}}});}}})();</script>`;
  return html.replace(/<head([^>]*)>/i, (_full, attributes) => `<head${attributes}>${csp}${capabilities}${isolation}`);
}
