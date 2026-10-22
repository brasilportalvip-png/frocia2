import type { ImprovementCandidate } from './selfEvolutionTypes.js';

export interface SpecialistCommitEvidence {
  status: 'verified' | 'partial' | 'unavailable';
  commitSha: string;
  repository?: string;
  files: Array<{ path: string; change: string; patch: string }>;
  reason?: string;
}

/** Lê apenas o diff do commit auditado, sem executar código nem alterar o repositório. */
export async function fetchSpecialistCommitEvidence(
  sha: ImprovementCandidate['headCommitSha']
): Promise<SpecialistCommitEvidence> {
  const base: SpecialistCommitEvidence = { status: 'unavailable', commitSha: sha || '', files: [] };
  if (!sha || !/^[a-f0-9]{40}$/i.test(sha)) return { ...base, reason: 'commit_sha_invalid' };
  const owner = process.env.GITHUB_OWNER || 'brasilportalvip-png';
  const repo = process.env.GITHUB_REPO || 'frocia2';
  if (!/^[a-zA-Z0-9_.-]+$/.test(owner) || !/^[a-zA-Z0-9_.-]+$/.test(repo)) {
    return { ...base, reason: 'repository_invalid' };
  }
  try {
    const token = process.env.GITHUB_TOKEN || process.env.GITHUB_APP_TOKEN;
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/commits/${sha}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'FrocIA-SpecialistEvidence/1.0',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) return { ...base, reason: `github_http_${response.status}` };
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== 'object') return { ...base, reason: 'github_payload_invalid' };
    const commit = payload as { sha?: unknown; files?: unknown };
    if (commit.sha !== sha || !Array.isArray(commit.files) || !commit.files.length) {
      return { ...base, reason: 'github_commit_mismatch_or_empty' };
    }
    const MAX_FILES = 25;
    const MAX_PATCH = 8000;
    const files = commit.files.slice(0, MAX_FILES)
      .map((item: unknown) => {
        if (!item || typeof item !== 'object') return null;
        const row = item as Record<string, unknown>;
        if (typeof row.filename !== 'string' || !row.filename || row.filename.length > 500) return null;
        return {
          path: row.filename,
          change: typeof row.status === 'string' ? row.status : 'unknown',
          patch: typeof row.patch === 'string' ? row.patch.slice(0, MAX_PATCH) : '[patch indisponível]',
        };
      }).filter((item): item is NonNullable<typeof item> => item !== null);
    const totalPatchBytes = files.reduce((sum, f) => sum + f.patch.length, 0);
    const partial = commit.files.length > MAX_FILES ||
      files.length !== commit.files.slice(0, MAX_FILES).length ||
      files.some((f) => f.patch === '[patch indisponível]' || f.patch.length >= MAX_PATCH) ||
      totalPatchBytes > 80_000;
    return {
      status: partial ? 'partial' : 'verified',
      commitSha: sha,
      repository: `${owner}/${repo}`,
      files,
      ...(partial ? { reason: 'commit_diff_incomplete' } : {}),
    };
  } catch {
    return { ...base, reason: 'github_evidence_unavailable' };
  }
}
