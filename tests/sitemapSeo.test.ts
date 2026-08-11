import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import http from 'http';
import { createApp } from '../server.js';

describe('Sitemap, Robots, SEO Técnico e Integridade de Arquivos (Complemento Prompt-Mestre)', () => {
  const publicDir = path.resolve(process.cwd(), 'public');
  const indexHtmlPath = path.resolve(process.cwd(), 'index.html');

  it('1 & 2. public/sitemap.xml deve existir e ser um XML bem-formado', () => {
    const sitemapPath = path.join(publicDir, 'sitemap.xml');
    expect(fs.existsSync(sitemapPath)).toBe(true);

    const content = fs.readFileSync(sitemapPath, 'utf-8');
    expect(content.trim().startsWith('<?xml')).toBe(true);
    expect(content).toContain('<urlset');
    expect(content).toContain('</urlset>');
  });

  it('3. sitemap.xml deve conter o namespace oficial de sitemaps', () => {
    const content = fs.readFileSync(path.join(publicDir, 'sitemap.xml'), 'utf-8');
    expect(content).toContain('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"');
  });

  it('4 & 5 & 6. sitemap.xml deve conter somente URLs HTTPS absolutas sem localhost ou vercel preview', () => {
    const content = fs.readFileSync(path.join(publicDir, 'sitemap.xml'), 'utf-8');
    const locMatches = content.match(/<loc>(.*?)<\/loc>/g) || [];

    expect(locMatches.length).toBeGreaterThan(0);

    for (const locTag of locMatches) {
      const url = locTag.replace('<loc>', '').replace('</loc>', '');
      expect(url.startsWith('https://')).toBe(true);
      expect(url).not.toContain('localhost');
      expect(url).not.toContain('127.0.0.1');
      expect(url).not.toContain('vercel.app/preview');
    }
  });

  it('7 & 8 & 9. sitemap.xml não deve conter rotas privadas, dados pessoais ou URLs duplicadas', () => {
    const content = fs.readFileSync(path.join(publicDir, 'sitemap.xml'), 'utf-8');
    const locMatches = (content.match(/<loc>(.*?)<\/loc>/g) || []).map((t) =>
      t.replace('<loc>', '').replace('</loc>', '')
    );

    const privateKeywords = [
      '/api/',
      '/admin',
      '/dashboard',
      '/profile',
      '/wallet',
      '/checkout',
      '/conversations',
      '/projects/',
    ];

    for (const url of locMatches) {
      for (const kw of privateKeywords) {
        expect(url).not.toContain(kw);
      }
      expect(url).not.toContain('@'); // no emails
    }

    const uniqueUrls = new Set(locMatches);
    expect(uniqueUrls.size).toEqual(locMatches.length);
  });

  it('10 & 11. sitemap.xml deve conter datas lastmod válidas e domínio canônico oficial', () => {
    const content = fs.readFileSync(path.join(publicDir, 'sitemap.xml'), 'utf-8');
    expect(content).toContain('https://frocia2.vercel.app/');

    const lastmodMatches = content.match(/<lastmod>(.*?)<\/lastmod>/g) || [];
    for (const lm of lastmodMatches) {
      const dateStr = lm.replace('<lastmod>', '').replace('</lastmod>', '');
      expect(isNaN(Date.parse(dateStr))).toBe(false);
    }
  });

  it('12 & 13. public/robots.txt deve existir e referenciar o sitemap.xml', () => {
    const robotsPath = path.join(publicDir, 'robots.txt');
    expect(fs.existsSync(robotsPath)).toBe(true);

    const content = fs.readFileSync(robotsPath, 'utf-8');
    expect(content).toContain('User-agent: *');
    expect(content).toContain('Disallow: /api/');
    expect(content).toContain('Disallow: /admin');
    expect(content).toContain('Sitemap: https://frocia2.vercel.app/sitemap.xml');
  });

  it('14 & 20. sitemap-index.xml deve existir e apontar apenas para sitemaps existentes', () => {
    const sitemapIndexPath = path.join(publicDir, 'sitemap-index.xml');
    expect(fs.existsSync(sitemapIndexPath)).toBe(true);

    const content = fs.readFileSync(sitemapIndexPath, 'utf-8');
    expect(content).toContain('<sitemapindex');
    expect(content).toContain('https://frocia2.vercel.app/sitemap.xml');
  });

  it('17, 18 & 19. index.html deve conter canonical, título, descrição, Open Graph e Schema.org válidos', () => {
    const content = fs.readFileSync(indexHtmlPath, 'utf-8');

    expect(content).toContain('rel="canonical"');
    expect(content).toContain('href="https://frocia2.vercel.app/"');
    expect(content).toContain('<title>');
    expect(content).toContain('Froc.IA');
    expect(content).toContain('property="og:url"');
    expect(content).toContain('content="https://frocia2.vercel.app/"');
    expect(content).toContain('property="og:locale"');
    expect(content).toContain('content="pt_BR"');
    expect(content).toContain('property="og:title"');
    expect(content).toContain('property="og:description"');
    expect(content).toContain('application/ld+json');
  });

  it('24. public/.well-known/assetlinks.json deve existir e ser um JSON válido', () => {
    const assetlinksPath = path.join(publicDir, '.well-known', 'assetlinks.json');
    expect(fs.existsSync(assetlinksPath)).toBe(true);

    const content = fs.readFileSync(assetlinksPath, 'utf-8');
    const parsed = JSON.parse(content);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].target.package_name).toBe('br.com.portalvipbrasil.frocia');
  });

  it('15 & 16. Servidor Express deve responder HTTP 200 e MIME correto para sitemap.xml, robots.txt, sitemap-index.xml e assetlinks.json', async () => {
    const app = await createApp();
    const server = http.createServer(app);

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address() as { port: number };
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const resSitemap = await fetch(`${baseUrl}/sitemap.xml`);
      expect(resSitemap.status).toBe(200);
      expect(resSitemap.headers.get('content-type')).toContain('application/xml');
      const textSitemap = await resSitemap.text();
      expect(textSitemap).not.toContain('<!doctype html>');

      const resSitemapIndex = await fetch(`${baseUrl}/sitemap-index.xml`);
      expect(resSitemapIndex.status).toBe(200);
      expect(resSitemapIndex.headers.get('content-type')).toContain('application/xml');

      const resRobots = await fetch(`${baseUrl}/robots.txt`);
      expect(resRobots.status).toBe(200);
      expect(resRobots.headers.get('content-type')).toContain('text/plain');

      const resAssetLinks = await fetch(`${baseUrl}/.well-known/assetlinks.json`);
      expect(resAssetLinks.status).toBe(200);
      expect(resAssetLinks.headers.get('content-type')).toContain('application/json');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
