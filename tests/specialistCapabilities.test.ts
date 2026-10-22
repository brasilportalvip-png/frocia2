import { afterEach, describe, expect, it, vi } from 'vitest';
import { COMMITTEE_ROLES } from '../server/selfEvolution/selfEvolutionTypes.js';
import {
  buildSpecialistSystemInstruction, SPECIALIST_CAPABILITIES,
} from '../server/selfEvolution/specialistCapabilityCatalog.js';
import { fetchSpecialistCommitEvidence } from '../server/selfEvolution/specialistReviewEvidence.js';

const sha = 'a'.repeat(40);

afterEach(() => { vi.unstubAllGlobals(); });

describe('Dez especialistas originais com missões independentes', () => {
  it('tem uma missão aprofundada para cada papel, sem alterar o catálogo de inovação', () => {
    expect(Object.keys(SPECIALIST_CAPABILITIES).sort()).toEqual([...COMMITTEE_ROLES].sort());
    const prompts = COMMITTEE_ROLES.map((role) => buildSpecialistSystemInstruction(role));
    expect(new Set(prompts).size).toBe(10);
    for (const prompt of prompts) {
      expect(prompt.length).toBeGreaterThan(600);
      expect(prompt.toUpperCase()).toContain('EVID');
      expect(prompt).toContain('changes_required');
      expect(prompt).toContain('DADO NÃO CONFIÁVEL');
      expect(prompt).toContain('commit exato');
    }
  });
});

describe('Evidência verificável do commit para o comitê', () => {
  it('obtém o diff da API oficial e o associa ao SHA imutável', async () => {
    const mockedFetch = vi.fn(async (_url: string) => ({
      ok: true,
      json: async () => ({ sha, files: [{ filename: 'src/App.tsx', status: 'modified', patch: '@@ teste real' }] }),
    }));
    vi.stubGlobal('fetch', mockedFetch);
    const evidence = await fetchSpecialistCommitEvidence(sha);
    expect(evidence.status).toBe('verified');
    expect(evidence.commitSha).toBe(sha);
    expect(evidence.files[0]?.path).toBe('src/App.tsx');
    expect(String(mockedFetch.mock.calls[0]?.[0])).toContain(`/commits/${sha}`);
  });

  it('bloqueia evidência com SHA diferente, sem considerar dados adulterados como prova', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, json: async () => ({ sha: 'b'.repeat(40), files: [{ filename: 'a.ts', patch: '+' }] }),
    })));
    const evidence = await fetchSpecialistCommitEvidence(sha);
    expect(evidence.status).toBe('unavailable');
    expect(evidence.reason).toBe('github_commit_mismatch_or_empty');
  });

  it('não aprova evidência incompleta ou com diff truncado', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, json: async () => ({ sha, files: [{ filename: 'src/a.ts', patch: 'x'.repeat(9000) }] }),
    })));
    const evidence = await fetchSpecialistCommitEvidence(sha);
    expect(evidence.status).toBe('partial');
    expect(evidence.reason).toBe('commit_diff_incomplete');
  });

  it('não chama GitHub sem um SHA válido', async () => {
    const mockedFetch = vi.fn();
    vi.stubGlobal('fetch', mockedFetch);
    const evidence = await fetchSpecialistCommitEvidence('invalid');
    expect(evidence.status).toBe('unavailable');
    expect(mockedFetch).not.toHaveBeenCalled();
  });
});
