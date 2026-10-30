import { describe, expect, it } from 'vitest';
import { bundleReactProject } from '../server/services/reactProjectBundler.js';

const enc = (s: string) => new TextEncoder().encode(s);
const ctx = { owner: 'o', repo: 'r', branch: 'main' };

const modules: Record<string, string> = {
  'https://esm.sh/react@18.3.1': 'export const useState=function(i){return [i,function(){}]};export default {createElement(){}};',
  'https://esm.sh/react@18.3.1/jsx-runtime': 'import {useState} from "react";export const jsx=(t,p)=>({t,p,useState});export const jsxs=jsx;export const Fragment="f";',
  'https://esm.sh/react-dom@18.3.1/client?external=react': 'import "/react-dom@18.3.1/es2022/dep.mjs";export const createRoot=(el)=>({render(x){el.innerHTML="ok"}});',
  'https://esm.sh/react-dom@18.3.1/es2022/dep.mjs': 'export const d=1;',
  'https://esm.sh/lucide-react@0.400.0?external=react,react-dom': 'import {jsx} from "react/jsx-runtime";export const Star=()=>jsx("svg",{});',
};

function project(): Map<string, Uint8Array> {
  return new Map<string, Uint8Array>([
    ['index.html', enc('<!doctype html><html><head><title>App React</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>')],
    ['package.json', enc('{"dependencies":{"react":"^18.3.1","react-dom":"^18.3.1","lucide-react":"^0.400.0"},"devDependencies":{"tailwindcss":"^3.4.0"}}')],
    ['src/main.tsx', enc("import React from 'react';import {createRoot} from 'react-dom/client';import App from './App';import './index.css';createRoot(document.getElementById('root')!).render(<App/>);")],
    ['src/App.tsx', enc("import {useState} from 'react';import {Star} from 'lucide-react';import logo from './assets/logo.png';import {title} from '@/lib/t';\nexport default function App(){const [n,setN]=useState<number>(0);return <main><img src={logo}/><h1>{title} {import.meta.env.VITE_API_URL}</h1><Star/><button onClick={()=>setN(n+1)}>{n}</button></main>}")],
    ['src/lib/t.ts', enc("export const title: string = 'Ola';")],
    ['src/index.css', enc('@tailwind base;.x{background:url(./assets/bg.png)} .y{@apply p-4}')],
    ['src/assets/logo.png', new Uint8Array([1, 2, 3])],
    ['src/assets/bg.png', new Uint8Array(200_000).fill(1)],
  ]);
}

describe('bundleReactProject', () => {
  it('compila React + TypeScript + CSS + imagens em um HTML único, com uma só cópia do React', async () => {
    const fetched: string[] = [];
    const result = await bundleReactProject(project(), ctx, 'index.html', {
      fetchText: async (url) => {
        fetched.push(url);
        if (!(url in modules)) throw new Error(`404 ${url}`);
        return modules[url];
      },
    });
    expect(result.report.kind).toBe('react_bundled');
    const html = result.html!;
    expect(result.title).toBe('App React');
    expect(html).not.toContain('src="/src/main.tsx"');
    expect(html).toContain('<script data-froc-source="bundle.js">');
    expect(html).toContain('data:image/png;base64');
    expect(html).toContain('https://cdn.jsdelivr.net/gh/o/r@main/src/assets/bg.png');
    expect(html).toContain('type="text/tailwindcss"');
    expect(html).toContain('https://cdn.tailwindcss.com');
    expect(fetched.filter((u) => u === 'https://esm.sh/react@18.3.1')).toHaveLength(1);
    expect(fetched.every((u) => u.startsWith('https://esm.sh/'))).toBe(true);
    expect(result.report.bundle?.packages).toEqual(['lucide-react', 'react', 'react-dom']);
    expect(result.report.bundle?.missingEnv).toEqual(['VITE_API_URL']);
  });

  it('falha com mensagem clara quando um pacote não carrega', async () => {
    const result = await bundleReactProject(project(), ctx, 'index.html', {
      fetchText: async (url) => { throw new Error(`404 ${url}`); },
    });
    expect(result.html).toBeNull();
    expect(result.report.kind).toBe('build_failed');
    expect(result.report.message).toContain('Não consegui compilar o projeto');
  });

  it('troca por versão vazia um pacote opcional que o esm.sh não consegue montar', async () => {
    const result = await bundleReactProject(project(), ctx, 'index.html', {
      fetchText: async (url) => {
        if (url.includes('lucide-react')) throw new Error('esm.sh respondeu 500');
        if (!(url in modules)) throw new Error(`404 ${url}`);
        return modules[url];
      },
    });
    expect(result.report.kind).toBe('react_bundled');
    expect(result.html).toBeTruthy();
    expect(result.report.bundle?.stubbedPackages).toEqual(['lucide-react']);
    expect(result.report.message).toContain('versão vazia');
  });

  it('nunca troca o React por versão vazia', async () => {
    const result = await bundleReactProject(project(), ctx, 'index.html', {
      fetchText: async (url) => {
        if (url.startsWith('https://esm.sh/react@')) throw new Error('esm.sh respondeu 500');
        return modules[url] ?? '';
      },
    });
    expect(result.report.kind).toBe('build_failed');
  });

  it('recusa quando o arquivo de entrada não existe', async () => {
    const files = new Map<string, Uint8Array>([['index.html', enc('<div id="root"></div><script type="module" src="/src/nada.tsx"></script>')]]);
    const result = await bundleReactProject(files, ctx, 'index.html', { fetchText: async () => '' });
    expect(result.report.kind).toBe('build_failed');
  });

  it('bloqueia hosts que não sejam esm.sh no download padrão de pacotes', async () => {
    const files = project();
    files.set('src/main.tsx', enc("import x from './App'; console.log(x);"));
    files.set('src/App.tsx', enc("import x from 'https://evil.example/x.js'; export default x;"));
    const result = await bundleReactProject(files, ctx, 'index.html');
    expect(result.report.kind).toBe('build_failed');
    expect(result.html).toBeNull();
  });
});
