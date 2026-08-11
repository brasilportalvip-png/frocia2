import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { CREDIT_PACKAGES, getCreditPackageById } from '../server/config/creditPackages.js';

describe('PROMPT-MESTRE DEFINITIVO - Business Rules & Configuration Verification', () => {
  it('Assetlinks JSON must contain exact package name and sha256 fingerprint', () => {
    const assetlinksPath = path.resolve(process.cwd(), 'public/.well-known/assetlinks.json');
    expect(fs.existsSync(assetlinksPath)).toBe(true);

    const content = JSON.parse(fs.readFileSync(assetlinksPath, 'utf8'));
    expect(Array.isArray(content)).toBe(true);
    expect(content[0].relation).toContain('delegate_permission/common.handle_all_urls');
    expect(content[0].target.namespace).toBe('android_app');
    expect(content[0].target.package_name).toBe('br.com.portalvipbrasil.frocia');
    expect(content[0].target.sha256_cert_fingerprints[0]).toBe(
      'B4:83:C0:45:EC:92:2B:F6:3E:0D:06:6B:2D:E9:99:85:1C:65:8B:80:21:46:3E:AB:09:BA:CF:BD:6C:24:17:25'
    );
  });

  it('Credit Packages must follow the official price matrix in integer cents and zero permanent bonus', () => {
    expect(CREDIT_PACKAGES).toHaveLength(5);

    const free = getCreditPackageById('free');
    expect(free).toBeDefined();
    expect(free?.credits).toBe(10);
    expect(free?.priceCents).toBe(0);

    const essential = getCreditPackageById('essential');
    expect(essential).toBeDefined();
    expect(essential?.credits).toBe(50);
    expect(essential?.priceCents).toBe(4990);
    expect(essential?.bonusCredits).toBe(0);

    const creator = getCreditPackageById('creator');
    expect(creator).toBeDefined();
    expect(creator?.credits).toBe(350);
    expect(creator?.priceCents).toBe(24990);
    expect(creator?.bonusCredits).toBe(0);

    const professional = getCreditPackageById('professional');
    expect(professional).toBeDefined();
    expect(professional?.credits).toBe(900);
    expect(professional?.priceCents).toBe(54990);
    expect(professional?.bonusCredits).toBe(0);

    const agency = getCreditPackageById('agency');
    expect(agency).toBeDefined();
    expect(agency?.credits).toBe(2200);
    expect(agency?.priceCents).toBe(109990);
    expect(agency?.bonusCredits).toBe(0);
  });
});
