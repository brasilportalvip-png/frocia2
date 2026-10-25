const failed = new Set(['tests_failed', 'preview_failed', 'ci_failed']);
export function ownerDispatchDecision(prior: Record<string, any> | undefined, candidate: Record<string, any> | undefined,
  version: string, now: number) {
  if (Number(prior?.dispatchLeaseUntil) > now) return { allowed: false, status: 'already_requested', message: 'Uma solicitação desta tarefa já está sendo enviada; não foi duplicada.' };
  if (!prior?.dispatchConfirmed) return { allowed: true, resumed: false };
  if (!candidate || !failed.has(candidate.state)) return { allowed: false, status: 'already_requested',
    message: `A tarefa está em ${candidate?.state || 'estado indisponível'}; não foi iniciada outra execução.` };
  const changedVersion = prior.dispatchVersion !== version;
  const count = changedVersion ? 0 : Number(prior.dispatchAttempts || 0);
  if (count >= 3) return { allowed: false, status: 'already_requested', message: 'Limite de três solicitações para esta versão atingido; a tarefa foi preservada.' };
  if (!changedVersion && now - Date.parse(prior.lastDispatchedAt || '') < 10 * 60000)
    return { allowed: false, status: 'already_requested', message: 'A retomada desta versão já foi solicitada há menos de dez minutos; não foi duplicada.' };
  return { allowed: true, resumed: true };
}
