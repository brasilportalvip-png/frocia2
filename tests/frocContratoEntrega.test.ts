import { describe, expect, it } from 'vitest';
import { bundleSchema, describeContractIssues, parseBundleLeniently } from '../server/siteFactory/professionalContract.js';
import { fixtureBundle } from './helpers/professionalFactoryFixture.js';

describe('Construção: projeto quase certo não derruba a etapa', () => {
  it('remove campos a mais e encurta descrição longa, sem mexer no código', () => {
    const data: any = structuredClone(fixtureBundle());
    data.extraInfo = 'campo que o modelo inventou';
    data.files[0].language = 'html';
    data.description = 'x'.repeat(1500);
    const content = data.files[0].content;
    const bundle = parseBundleLeniently(data);
    expect((bundle as any).extraInfo).toBeUndefined();
    expect((bundle.files[0] as any).language).toBeUndefined();
    expect(bundle.description).toHaveLength(1000);
    expect(bundle.files[0].content).toBe(content);
  });

  it('o que não dá para consertar volta com o ponto exato para o modelo corrigir', () => {
    const data: any = structuredClone(fixtureBundle());
    data.productType = 'loja';
    let error: unknown;
    try { parseBundleLeniently(data); } catch (e) { error = e; }
    expect((error as any)?.name).toBe('ZodError');
    expect(describeContractIssues(error)).toContain('productType');
    expect(bundleSchema.safeParse(fixtureBundle()).success).toBe(true);
  });
});
