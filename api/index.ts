import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import { getApp } from '../server.js';
import { adminDb, isFirebaseAdminConfigured } from '../server/lib/firebaseAdmin.js';
import type { ImprovementCandidate } from '../server/selfEvolution/selfEvolutionTypes.js';
import { SelfEvolutionOrchestrator } from '../server/selfEvolution/selfEvolutionOrchestrator.js';
import { SelfEvolutionPolicyEngine } from '../server/selfEvolution/selfEvolutionPolicyEngine.js';

// Mantem o limite atual da API. A Vercel pode encerrar execucoes mais longas.
export const maxDuration = 300;

const CRON_PATH = 'internal/self-evolution/run';

// Nao reexecutar candidatos ja finalizados ou com erro que exige diagnostico.
// Cada chamada processa no maximo um candidato para limitar concorrencia/custo.
const RESUMABLE_STATES = new Set([
  'detected',
  'triaged',
  'awaiting_work_approval',
  'approved_for_work',
  'pull_request_opened',
  'ci_pending',
  'ci_passed',
  'preview_deployed',
  'awaiting_release_approval',
]);

function validCronAuthorization(header: string | undefined): boolean {
  const secret = process.env.CRON_SECRET;
  // Nao habilitar a rota sem segredo forte explicitamente configurado.
  if (!secret || secret.length < 32 || !header?.startsWith('Bearer ')) {
    return false;
  }

  const provided = header.slice('Bearer '.length);
  const expectedDigest = createHash('sha256').update(secret).digest();
  const providedDigest = createHash('sha256').update(provided).digest();
  return timingSafeEqual(expectedDigest, providedDigest);
}

async function runScheduledSelfEvolution(req: Request, res: Response) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Metodo nao permitido.' });
  }

  if (!process.env.CRON_SECRET || process.env.CRON_SECRET.length < 32) {
    return res.status(503).json({ error: 'CRON_SECRET nao configurado corretamente.' });
  }

  if (!validCronAuthorization(req.headers.authorization)) {
    return res.status(401).json({ error: 'Nao autorizado.' });
  }

  // O agendador nao deve executar a partir de deployments de preview.
  if (process.env.VERCEL_ENV !== 'production') {
    return res.status(403).json({ error: 'Execucao permitida apenas em producao.' });
  }

  // Sem Firestore duravel nao existe fila segura para um job automatico.
  if (!isFirebaseAdminConfigured()) {
    return res.status(503).json({ error: 'Firestore Admin nao configurado.' });
  }

  try {
    if (!(await SelfEvolutionPolicyEngine.isSelfEvolutionEnabledPersisted())) {
      return res.status(200).json({ status: 'disabled', processed: 0 });
    }

    // Processa primeiro o candidato elegivel mais antigo entre os 100 recentes.
    // Consulta direto o Firestore: erros nao devem ser mascarados por fallback em memoria.
    const snapshot = await adminDb.collection('self_evolution_candidates')
      .orderBy('createdAt', 'desc')
      .limit(100)
      .get();
    const candidates = snapshot.docs.map((doc) => ({
      ...(doc.data() as ImprovementCandidate),
      id: doc.id,
    }));
    const candidate = candidates
      .filter((item) => RESUMABLE_STATES.has(item.state))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];

    if (!candidate) {
      return res.status(200).json({ status: 'idle', processed: 0 });
    }

    // Identidade unica por tentativa: protege contra duas execucoes simultaneas.
    const actor = `self-evolution-cron-${randomUUID()}`;
    const result = await SelfEvolutionOrchestrator.processCandidateLifecycle(
      candidate.id,
      actor
    );

    return res.status(200).json({
      status: 'processed',
      processed: 1,
      candidateId: candidate.id,
      result,
      processedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[self-evolution-cron] Falha na execucao:', error);
    return res.status(503).json({
      error: 'Nao foi possivel concluir o ciclo de autoevolucao.',
    });
  }
}

export default async function handler(
  req: Request,
  res: Response
) {
  const forwardedPath = req.query.__path;

  // O rewrite /api/:path* aponta para esta funcao. Intercepta so o cron.
  if (forwardedPath === CRON_PATH) {
    return runScheduledSelfEvolution(req, res);
  }

  if (typeof forwardedPath === 'string') {
    const query = new URLSearchParams();

    for (const [key, value] of Object.entries(req.query)) {
      if (key === '__path') continue;

      if (Array.isArray(value)) {
        for (const item of value) {
          query.append(key, String(item));
        }
      } else if (value !== undefined) {
        query.append(key, String(value));
      }
    }

    const queryString = query.toString();
    req.url = `/api/${forwardedPath}${queryString ? `?${queryString}` : ''}`;
  }

  const app = await getApp();
  return app(req, res);
}
