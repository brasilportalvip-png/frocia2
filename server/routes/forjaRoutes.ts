/**
 * Criador de sites da Froc.IA — motor "Forja" (o mesmo sistema do Forja Studio da Gemini).
 *
 * Como funciona:
 *  1. O arquiteto (Gemini) escreve o projeto React + TypeScript + Tailwind arquivo por arquivo
 *     e cada pedaço chega na tela em tempo real (SSE).
 *  2. O servidor compila tudo na memória com o esbuild.
 *  3. Se a compilação falhar, o arquiteto recebe os erros e corrige sozinho (até 2 vezes).
 *  4. A prévia funcionando e o HTML único pronto para publicar voltam para a tela.
 *
 * Projetos ficam salvos no Firestore (coleção forja_projects, só pelo servidor) e também
 * aparecem em "Meus projetos" da Froc.IA (coleção projects, com o HTML pronto).
 */
import { Router, type Response } from 'express';
import { GoogleGenAI } from '@google/genai';
import { FieldValue } from 'firebase-admin/firestore';
import { requireAuth } from '../middlewares/requireAuth.js';
import type { AuthenticatedRequest } from '../types.js';
import { adminDb, getMediaStorageBucket, isFirebaseAdminConfigured } from '../lib/firebaseAdmin.js';
import { firebaseImageStore, forgeSiteImages, pendingImages, type ForgeImagesResult } from '../forja/imageForge.js';
import { IMAGE_LOCK_PATH, parseSiteManifest, SYSTEM_FILES } from '../forja/siteKit.js';
import { env } from '../config/env.js';
import { configuredGeminiFailoverChain } from '../ai/geminiFailoverService.js';
import { CreditWalletService, InsufficientCreditsError } from '../services/creditWalletService.js';
import {
  buildCompileRepairContents,
  buildUserContents,
  getArchitectSystemInstruction,
  type BuildMode,
  type ChatTurn,
  type DesignPreset,
} from '../forja/architectPrompt.js';
import { ArchitectStreamParser } from '../forja/streamParser.js';
import { compileVirtualReactProject } from '../forja/bundler.js';
import {
  SPECIALISTS,
  buildSpecialistFixContents,
  issuesToFix,
  parseSpecialistIssues,
  specialistSystemInstruction,
  specialistUserContent,
  type SpecialistReview,
} from '../forja/specialists.js';
import { createForjaPublisher, ForjaPublishError, vercelProjectName, verifyVercelToken } from '../forja/forjaPublisher.js';
import { decryptPersonalMemory, encryptPersonalMemory, MemoryEncryptionUnavailableError } from '../ai/memoryCryptoService.js';
import {
  FORJA_LIMITS,
  forjaCreditCost,
  sanitizeForjaFiles,
  sanitizeForjaMessages,
  safeGeneratedPath,
  type ForjaStoredMessage,
} from '../forja/forjaStore.js';

export const forjaRouter = Router();

const COLLECTION = 'forja_projects';
const PRESETS: DesignPreset[] = ['auto', 'editorial-light', 'corporate-dark', 'commerce-minimal'];

type Contents = Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }>;

function geminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error('A chave do Gemini (GEMINI_API_KEY) não está configurada no servidor.');
  }
  return new GoogleGenAI({ apiKey });
}

/** Modelo do arquiteto: FORJA_MODEL na Vercel, senão o modelo de engenharia da Froc.IA. */
function architectModels(): string[] {
  const primary = (process.env.FORJA_MODEL || env.ENGINEERING_MODEL || env.GEMINI_DEFAULT_MODEL || '').trim();
  return configuredGeminiFailoverChain(primary).slice(0, 4);
}

function sendError(res: Response, status: number, code: string, message: string) {
  return res.status(status).json({ error: { code, message } });
}

function db() {
  if (!isFirebaseAdminConfigured() || !adminDb) return null;
  return adminDb;
}

// ---------------------------------------------------------------- preço (mostrado antes de enviar)

forjaRouter.get('/pricing', requireAuth, (_req: AuthenticatedRequest, res) => {
  return res.json({ create: forjaCreditCost(true), edit: forjaCreditCost(false) });
});

// ---------------------------------------------------------------- compilação da prévia

forjaRouter.post('/preview/bundle', requireAuth, async (req: AuthenticatedRequest, res) => {
  const files = sanitizeForjaFiles(req.body?.files);
  if (!files.ok) return res.status(400).json({ ok: false, errors: [files.error] });
  if (Object.keys(files.files).length === 0) return res.status(400).json({ ok: false, errors: ['Nenhum arquivo fornecido.'] });
  const preview = await compileVirtualReactProject(files.files, { withErrorBridge: true });
  if (!preview.ok) return res.json({ ok: false, compiledHtml: '', standaloneHtml: '', errors: preview.errors });
  const standalone = await compileVirtualReactProject(files.files, { withErrorBridge: false });
  return res.json({ ok: true, compiledHtml: preview.html, standaloneHtml: standalone.html, errors: [] });
});

// ---------------------------------------------------------------- construção (streaming)

forjaRouter.post('/build/stream', requireAuth, async (req: AuthenticatedRequest, res) => {
  const uid = req.user!.uid;
  const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim().slice(0, FORJA_LIMITS.promptChars) : '';
  if (!prompt) return sendError(res, 400, 'empty_prompt', 'Descreva o site ou a alteração que deseja construir.');

  const current = sanitizeForjaFiles(req.body?.currentFiles);
  if (!current.ok) return sendError(res, 413, 'project_too_large', current.error);
  const currentFiles = current.files;
  const history: ChatTurn[] = (Array.isArray(req.body?.history) ? req.body.history : [])
    .filter((t: unknown): t is ChatTurn => !!t && typeof (t as ChatTurn).content === 'string')
    .slice(-6)
    .map((t: ChatTurn) => ({ role: t.role === 'user' ? 'user' : 'assistant', content: t.content.slice(0, 6000) }));
  const buildMode: BuildMode = req.body?.buildMode === 'quick' ? 'quick' : 'full';
  const designPreset: DesignPreset = PRESETS.includes(req.body?.designPreset) ? req.body.designPreset : 'auto';
  const isNew = Object.keys(currentFiles).length === 0;

  // Créditos: reserva antes; só cobra se o site sair compilado. Se falhar, devolve.
  const cost = forjaCreditCost(isNew);
  const idempotencyKey = String(req.body?.idempotencyKey || `forja-${uid}-${Date.now()}`).slice(0, 120);
  let reservationId: string | null = null;
  if (cost > 0 && db()) {
    try {
      const r = await CreditWalletService.reserveCredits({ userId: uid, amount: cost, operation: isNew ? 'Criação de site (Forja)' : 'Alteração de site (Forja)', idempotencyKey });
      reservationId = r.reservationId;
    } catch (e) {
      const insufficient = e instanceof InsufficientCreditsError;
      return sendError(res, insufficient ? 402 : 500, insufficient ? 'insufficient_credits' : 'credit_reservation_failed', (e as Error).message || 'Não foi possível reservar os créditos.');
    }
  }
  const settle = async (ok: boolean, reason: string) => {
    if (!reservationId) return;
    const id = reservationId;
    reservationId = null;
    try {
      if (ok) await CreditWalletService.confirmConsumption({ userId: uid, reservationId: id, amountConsumed: cost, operation: isNew ? 'Criação de site (Forja)' : 'Alteração de site (Forja)', idempotencyKey: `cnf-${idempotencyKey}` });
      else await CreditWalletService.releaseReservation({ userId: uid, reservationId: id, operation: `Estorno: ${reason}`.slice(0, 200), idempotencyKey: `rel-${idempotencyKey}` });
    } catch (e) {
      console.error('[forja] créditos', (e as Error).message);
    }
  };

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const sendEvent = (event: string, data: unknown) => {
    if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  // Mantém a conexão viva enquanto o modelo pensa (proxies cortam conexões mudas).
  const keepAlive = setInterval(() => {
    if (!res.writableEnded) res.write(': ping\n\n');
  }, 15_000);

  let closed = false;
  res.on('close', () => {
    closed = true;
  });

  const mergedFiles: Record<string, string> = { ...currentFiles };
  const truncatedFiles: string[] = [];
  let usedModel = '';
  const startedAt = Date.now();

  try {
    const ai = geminiClient();
    const models = architectModels();

    /** Abre o streaming no primeiro modelo que responder (troca de modelo antes do 1º pedaço). */
    const openStream = async (contents: Contents, thinking: 'HIGH' | 'LOW') => {
      let lastError: unknown = null;
      for (const model of usedModel ? [usedModel, ...models.filter((m) => m !== usedModel)] : models) {
        for (const withThinking of [true, false]) {
          try {
            // Teto alto de resposta: projetos grandes não podem sair cortados no meio de um arquivo.
            const config: Record<string, unknown> = { systemInstruction: getArchitectSystemInstruction(designPreset), maxOutputTokens: 65_536 };
            if (withThinking) config.thinkingConfig = { thinkingLevel: thinking };
            const stream = await ai.models.generateContentStream({ model, contents, config: config as never });
            usedModel = model;
            return stream;
          } catch (e) {
            lastError = e;
            const msg = String((e as Error)?.message || e);
            // Modelo que não aceita "thinkingLevel": tenta o mesmo modelo sem ele.
            if (withThinking && /thinking/i.test(msg)) continue;
            break;
          }
        }
      }
      throw lastError ?? new Error('Nenhum modelo do Gemini respondeu.');
    };

    const streamTurn = async (contents: Contents, thinking: 'HIGH' | 'LOW', isRepair: boolean) => {
      const stream = await openStream(contents, thinking);
      const parser = new ArchitectStreamParser();
      let phase: 'planning' | 'coding' | 'summarizing' = 'planning';
      let written = 0;
      const buffers: Record<string, string> = {};
      const handle = (events: ReturnType<ArchitectStreamParser['push']>) => {
        for (const ev of events) {
          if (ev.type === 'plan_delta') {
            if (!isRepair) sendEvent('plan_delta', { text: ev.text });
          } else if (ev.type === 'file_start') {
            if (phase !== 'coding') {
              phase = 'coding';
              sendEvent('phase', { phase: 'coding', label: isRepair ? 'Corrigindo erros detectados na compilação' : 'Escrevendo componentes React, TypeScript e estilos' });
            }
            buffers[ev.path] = '';
            sendEvent('file_start', { path: ev.path });
          } else if (ev.type === 'file_delta') {
            buffers[ev.path] = (buffers[ev.path] || '') + ev.chunk;
            sendEvent('file_delta', { path: ev.path, chunk: ev.chunk });
          } else if (ev.type === 'file_end') {
            const clean = safeGeneratedPath(ev.path);
            // Arquivos do sistema (kit, fotos, dados do negócio) nunca são sobrescritos pela IA.
            if (clean && !SYSTEM_FILES.includes(clean)) {
              mergedFiles[clean] = buffers[ev.path] || '';
              written += 1;
            }
            sendEvent('file_end', { path: ev.path });
          } else if (ev.type === 'file_truncated') {
            // Arquivo cortado: fica a versão anterior (ou some, se era novo) e a tela é avisada.
            truncatedFiles.push(ev.path);
            sendEvent('file_truncated', { path: ev.path });
          } else if (ev.type === 'summary_delta') {
            if (phase !== 'summarizing') {
              phase = 'summarizing';
              sendEvent('phase', { phase: 'verifying', label: 'Consolidando resumo da arquitetura' });
            }
            sendEvent('summary_delta', { text: ev.text });
          }
        }
      };
      for await (const chunk of stream) {
        if (closed) break;
        const text = chunk.text;
        if (text) handle(parser.push(text));
      }
      if (!closed) handle(parser.flush());
      return written;
    };

    sendEvent('phase', { phase: 'planning', label: isNew ? 'Planejando arquitetura modular e experiência do usuário' : 'Analisando projeto atual e planejando alterações' });

    const count = await streamTurn(buildUserContents({ prompt, history, currentFiles }), buildMode === 'quick' ? 'LOW' : 'HIGH', false);
    if (closed) {
      await settle(false, 'construção interrompida');
      return;
    }
    if (count === 0 && Object.keys(mergedFiles).length === 0) {
      await settle(false, 'resposta sem arquivos');
      sendEvent('error', { message: 'A resposta não trouxe os arquivos do site. Tente descrever o site de novo com mais detalhes (sem créditos cobrados).' });
      return;
    }

    // Fotos ultrarrealistas: começam já (em paralelo com compilação e especialistas).
    let imageJob: Promise<ForgeImagesResult | null> | null = null;
    let imageWarning = '';
    const startImages = () => {
      const pending = pendingImages(mergedFiles);
      if (imageJob || pending.length === 0) return;
      const snapshot = { ...mergedFiles };
      sendEvent('images', { status: 'started', total: pending.length });
      imageJob = (async () => {
        try {
          const bucket = await getMediaStorageBucket();
          return await forgeSiteImages({
            ai,
            files: snapshot,
            store: firebaseImageStore(bucket),
            ownerId: uid,
            onProgress: (done, total) => sendEvent('images', { status: 'progress', done, total }),
          });
        } catch (e) {
          const message = String((e as Error)?.message || e);
          console.error('[forja] fotos', message);
          imageWarning = /FIREBASE_STORAGE_BUCKET/.test(message)
            ? 'As fotos não foram geradas: falta configurar FIREBASE_STORAGE_BUCKET na Vercel.'
            : 'As fotos não puderam ser geradas agora; peça "gere as fotos de novo" para tentar outra vez.';
          return null;
        }
      })();
    };
    /** Junta as fotos prontas ao projeto (a trava com os links fica salva junto com os arquivos). */
    const collectImages = async () => {
      if (!imageJob) return;
      const result = await imageJob;
      imageJob = null;
      if (!result) return;
      if (result.files[IMAGE_LOCK_PATH]) mergedFiles[IMAGE_LOCK_PATH] = result.files[IMAGE_LOCK_PATH];
      if (result.failed.length > 0) imageWarning = `${result.failed.length} foto(s) não saíram (${result.failed.map((f) => f.id).join(', ')}); o site mostra um fundo elegante no lugar. Peça "gere as fotos de novo" para tentar outra vez.`;
      sendEvent('images', { status: 'done', generated: result.generated.length, failed: result.failed.length });
    };
    startImages();

    // Compila e corrige sozinho (até 2 vezes), como no Forja Studio.
    let compiled = await compileVirtualReactProject(mergedFiles, { withErrorBridge: true });
    let attempts = 0;
    // Falha de download dos pacotes (React) não é erro do código: não adianta pedir correção à IA.
    const infraOnly = (errors: string[]) => errors.length > 0 && errors.every((e) => /Não consegui baixar o React/.test(e));
    // Sem tempo para mais uma correção dentro do limite da Vercel (300 s): para com aviso claro.
    while (!compiled.ok && attempts < 2 && !closed && !infraOnly(compiled.errors) && Date.now() - startedAt < 200_000) {
      attempts += 1;
      sendEvent('phase', { phase: 'verifying', label: `Corrigindo compilação automaticamente (tentativa ${attempts}/2)` });
      await streamTurn(buildCompileRepairContents({ originalPrompt: prompt, currentFiles: mergedFiles, compileErrors: compiled.errors }), 'LOW', true);
      if (closed) break;
      compiled = await compileVirtualReactProject(mergedFiles, { withErrorBridge: true });
    }
    if (closed) {
      await settle(false, 'construção interrompida');
      return;
    }
    if (!compiled.ok) {
      await settle(false, 'não compilou');
      const cut = truncatedFiles.length
        ? ` A resposta da IA veio cortada em ${[...new Set(truncatedFiles)].join(', ')} (mantive a versão anterior desses arquivos). Peça a mudança em partes menores.`
        : '';
      sendEvent('error', { message: `Não consegui compilar automaticamente (sem créditos cobrados): ${compiled.errors.slice(0, 3).join(' | ')}.${cut}` });
      return;
    }

    // Revisão dos especialistas (modo Completo), dentro do tempo da Vercel (300 s).
    if (buildMode === 'full' && !closed && Date.now() - startedAt < 170_000) {
      sendEvent('phase', { phase: 'verifying', label: 'Especialistas revisando o site: design, textos e SEO, segurança' });
      const reviews = await runSpecialists(ai, usedModel || models[0], mergedFiles, prompt);
      sendEvent('review', { reviews });
      const fixes = issuesToFix(reviews);
      if (fixes.length > 0 && !closed && Date.now() - startedAt < 210_000) {
        const goodVersion = { ...mergedFiles };
        sendEvent('phase', { phase: 'coding', label: `Aplicando ${fixes.length} melhoria(s) apontada(s) pelos especialistas` });
        await streamTurn(buildSpecialistFixContents({ originalPrompt: prompt, currentFiles: mergedFiles, fixes }), 'LOW', true);
        const improved = closed ? null : await compileVirtualReactProject(mergedFiles, { withErrorBridge: true });
        if (improved?.ok) {
          compiled = improved;
        } else {
          // A melhoria quebrou a compilação: volta para a versão boa (a revisão nunca piora o site).
          for (const key of Object.keys(mergedFiles)) delete mergedFiles[key];
          Object.assign(mergedFiles, goodVersion);
          sendEvent('summary_delta', { text: '\n\n(As melhorias dos especialistas não compilaram; mantive a versão anterior, que funciona.)' });
        }
      }
      if (closed) {
        await settle(false, 'construção interrompida');
        return;
      }
    }

    // Fotos: espera as que estavam sendo feitas e, se os especialistas pediram fotos novas, faz mais uma rodada.
    if (imageJob) sendEvent('phase', { phase: 'verifying', label: 'Finalizando as fotos ultrarrealistas do site' });
    await collectImages();
    if (!closed && pendingImages(mergedFiles).length > 0 && Date.now() - startedAt < 215_000) {
      startImages();
      await collectImages();
    }
    if (closed) {
      await settle(false, 'construção interrompida');
      return;
    }
    if (mergedFiles[IMAGE_LOCK_PATH]) {
      const withPhotos = await compileVirtualReactProject(mergedFiles, { withErrorBridge: true });
      if (withPhotos.ok) compiled = withPhotos;
    }
    if (imageWarning) sendEvent('summary_delta', { text: `\n\n${imageWarning}` });

    // A tela recebe a versão final exata (inclusive quando uma melhoria foi desfeita).
    sendEvent('files_final', { files: mergedFiles });
    sendEvent('phase', { phase: 'verifying', label: 'Build compilado com sucesso e pronto para produção' });
    const standalone = await compileVirtualReactProject(mergedFiles, { withErrorBridge: false });
    await settle(true, '');
    sendEvent('bundle_ready', { compiledHtml: compiled.html, standaloneHtml: standalone.html });
    sendEvent('done', { filesCount: Object.keys(mergedFiles).length, autoRepaired: attempts > 0, model: usedModel, credits: cost });
  } catch (err) {
    await settle(false, 'falha no Gemini');
    const message = err instanceof Error ? err.message : 'Erro inesperado ao gerar o projeto.';
    console.error('[forja] build', message);
    sendEvent('error', { message: friendlyGeminiError(message) });
  } finally {
    clearInterval(keepAlive);
    if (!res.writableEnded) res.end();
  }
});

function friendlyGeminiError(message: string) {
  if (/RESOURCE_EXHAUSTED|429|quota/i.test(message)) return 'O Gemini está sem cota agora. Tente de novo em alguns minutos (sem créditos cobrados).';
  if (/API key|PERMISSION_DENIED|401|403/i.test(message)) return 'A chave do Gemini foi recusada. Confira a GEMINI_API_KEY na Vercel.';
  if (/not found|404/i.test(message)) return 'O modelo configurado para o criador não existe. Confira FORJA_MODEL na Vercel.';
  return message;
}

// ---------------------------------------------------------------- projetos salvos

forjaRouter.get('/projects', requireAuth, async (req: AuthenticatedRequest, res) => {
  const store = db();
  if (!store) return res.json({ projects: [] });
  const snap = await store.collection(COLLECTION).where('userId', '==', req.user!.uid).limit(200).get();
  const projects = snap.docs
    .map((d) => {
      const x = d.data();
      return { id: d.id, name: String(x.name || 'Projeto'), slug: String(x.slug || ''), createdAt: Number(x.createdAtMs || 0), updatedAt: Number(x.updatedAtMs || 0), fileCount: Object.keys(x.files || {}).length };
    })
    .sort((a, b) => b.updatedAt - a.updatedAt);
  return res.json({ projects });
});

forjaRouter.get('/projects/:id', requireAuth, async (req: AuthenticatedRequest, res) => {
  const store = db();
  if (!store) return sendError(res, 503, 'database_not_configured', 'Banco de dados indisponível.');
  const doc = await store.collection(COLLECTION).doc(req.params.id).get();
  if (!doc.exists || doc.data()?.userId !== req.user!.uid) return sendError(res, 404, 'not_found', 'Projeto não encontrado.');
  const x = doc.data()!;
  return res.json({
    project: { id: doc.id, name: x.name, slug: x.slug, createdAt: x.createdAtMs, updatedAt: x.updatedAtMs, files: x.files || {}, messages: x.messages || [], productionUrl: x.productionUrl || null, publishedAt: x.publishedAtMs || null },
  });
});

/** Cria um projeto novo (também aparece em "Meus projetos" da Froc.IA). */
forjaRouter.post('/projects', requireAuth, async (req: AuthenticatedRequest, res) => {
  const store = db();
  if (!store) return sendError(res, 503, 'database_not_configured', 'Banco de dados indisponível.');
  const name = String(req.body?.name || 'Novo projeto').slice(0, 120);
  const now = Date.now();
  const ref = store.collection('projects').doc();
  await ref.set({
    userId: req.user!.uid,
    tenantId: req.user!.tenantId ?? null,
    title: name,
    description: String(req.body?.prompt || '').slice(0, 1000),
    prompt: String(req.body?.prompt || '').slice(0, 10000),
    category: 'Site',
    colorPalette: '',
    tone: 'Profissional',
    html: '',
    isFavorite: false,
    suggestedRefinements: [],
    forja: true,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  await store.collection(COLLECTION).doc(ref.id).set({ userId: req.user!.uid, name, slug: '', files: {}, messages: [], createdAtMs: now, updatedAtMs: now });
  return res.json({ project: { id: ref.id, name, slug: '', createdAt: now, updatedAt: now, files: {}, messages: [] } });
});

/** Salva arquivos e conversa; o HTML pronto vai para o projeto da Froc.IA (prévia e publicação). */
forjaRouter.put('/projects/:id', requireAuth, async (req: AuthenticatedRequest, res) => {
  const store = db();
  if (!store) return sendError(res, 503, 'database_not_configured', 'Banco de dados indisponível.');
  const uid = req.user!.uid;
  const ref = store.collection(COLLECTION).doc(req.params.id);
  const doc = await ref.get();
  if (doc.exists && doc.data()?.userId !== uid) return sendError(res, 404, 'not_found', 'Projeto não encontrado.');
  const files = sanitizeForjaFiles(req.body?.files);
  if (!files.ok) return sendError(res, 413, 'project_too_large', files.error);
  const messages: ForjaStoredMessage[] = sanitizeForjaMessages(req.body?.messages);
  const name = String(req.body?.name || doc.data()?.name || 'Projeto').slice(0, 120);
  const now = Date.now();
  await ref.set({ userId: uid, name, slug: String(req.body?.slug || '').slice(0, 120), files: files.files, messages, updatedAtMs: now, createdAtMs: doc.data()?.createdAtMs || now },
    // Troca arquivos e conversa inteiros, sem apagar o link publicado (productionUrl etc.).
    { mergeFields: ['userId', 'name', 'slug', 'files', 'messages', 'updatedAtMs', 'createdAtMs'] },
  );

  const html = typeof req.body?.standaloneHtml === 'string' ? req.body.standaloneHtml : '';
  const projectRef = store.collection('projects').doc(req.params.id);
  const project = await projectRef.get();
  const patch: Record<string, unknown> = { title: name, updatedAt: FieldValue.serverTimestamp(), forja: true };
  // Firestore aceita até 1 MB por documento: HTML maior fica só nos arquivos (o ZIP funciona igual).
  if (html && html.length <= FORJA_LIMITS.htmlChars) patch.html = html;
  if (project.exists) {
    if (project.data()?.userId === uid) await projectRef.update(patch);
  } else {
    await projectRef.set({ userId: uid, tenantId: req.user!.tenantId ?? null, description: '', prompt: '', category: 'Site', colorPalette: '', tone: 'Profissional', isFavorite: false, suggestedRefinements: [], createdAt: FieldValue.serverTimestamp(), html: '', ...patch });
  }
  return res.json({ ok: true, updatedAt: now, htmlSaved: Boolean(patch.html) });
});

forjaRouter.delete('/projects/:id', requireAuth, async (req: AuthenticatedRequest, res) => {
  const store = db();
  if (!store) return sendError(res, 503, 'database_not_configured', 'Banco de dados indisponível.');
  const ref = store.collection(COLLECTION).doc(req.params.id);
  const doc = await ref.get();
  if (!doc.exists || doc.data()?.userId !== req.user!.uid) return sendError(res, 404, 'not_found', 'Projeto não encontrado.');
  await ref.delete();
  const project = store.collection('projects').doc(req.params.id);
  const p = await project.get();
  if (p.exists && p.data()?.userId === req.user!.uid && p.data()?.forja) await project.delete();
  return res.json({ ok: true });
});

// ---------------------------------------------------------------- publicar (link próprio)

/**
 * Coloca o site no ar e devolve o link público. O servidor compila de novo a partir dos
 * arquivos salvos (não confia no HTML enviado pela tela). Publicar outra vez atualiza o link.
 */
forjaRouter.post('/projects/:id/publish', requireAuth, async (req: AuthenticatedRequest, res) => {
  const store = db();
  if (!store) return sendError(res, 503, 'database_not_configured', 'Banco de dados indisponível.');
  const uid = req.user!.uid;
  const ref = store.collection(COLLECTION).doc(req.params.id);
  const doc = await ref.get();
  if (!doc.exists || doc.data()?.userId !== uid) return sendError(res, 404, 'not_found', 'Projeto não encontrado.');
  const x = doc.data()!;
  if (Date.now() - Number(x.lastPublishAtMs || 0) < 15_000) return sendError(res, 429, 'publish_too_fast', 'Aguarde alguns segundos antes de publicar de novo.');
  const files = (x.files || {}) as Record<string, string>;
  if (!files['src/App.tsx'] && !files['index.html']) return sendError(res, 400, 'nothing_to_publish', 'Crie o site primeiro: ainda não há arquivos para publicar.');

  const compiled = await compileVirtualReactProject(files, { withErrorBridge: false });
  if (!compiled.ok) return sendError(res, 422, 'compile_failed', `O site tem erro de compilação e não foi publicado: ${compiled.errors.slice(0, 2).join(' | ')}`);

  await ref.update({ lastPublishAtMs: Date.now() });
  // Cada pessoa publica na conta Vercel DELA (custo e responsabilidade de cada um).
  const account = await loadVercelAccount(store, uid);
  if (!account) {
    await ref.update({ lastPublishAtMs: 0 });
    return sendError(res, 409, 'vercel_not_connected', 'Conecte a sua conta da Vercel para publicar.');
  }
  const publisher = createForjaPublisher({ token: account.token, teamId: account.teamId || undefined });
  try {
    const result = await publisher.publish({
      projectName: String(x.vercelProjectName || vercelProjectName(String(x.name || 'site'), doc.id)),
      html: compiled.html,
      vercelProjectId: x.vercelProjectId || null,
      routes: (parseSiteManifest(files)?.routes || []).map((r) => r.path),
    });
    const now = Date.now();
    // Conexão antiga sem time: guarda o time descoberto para as próximas publicações irem direto.
    if (result.teamId && result.teamId !== account.teamId) await store.collection(VERCEL_ACCOUNTS).doc(uid).update({ teamId: result.teamId });
    await ref.update({ productionUrl: result.url, vercelProjectId: result.vercelProjectId, vercelProjectName: x.vercelProjectName || vercelProjectName(String(x.name || 'site'), doc.id), publishedAtMs: now });
    const project = store.collection('projects').doc(doc.id);
    const p = await project.get();
    if (p.exists && p.data()?.userId === uid) await project.update({ productionUrl: result.url, updatedAt: FieldValue.serverTimestamp() });
    return res.json({ ok: true, url: result.url, publishedAt: now, searchEnginesNotified: result.searchEnginesNotified });
  } catch (e) {
    const err = e instanceof ForjaPublishError ? e : new ForjaPublishError('publish_failed', (e as Error)?.message || 'Falha ao publicar.');
    // Token vencido/apagado: libera para conectar de novo e tentar na hora.
    if (err.code === 'vercel_token_refused' || err.code === 'vercel_cannot_create_project') await ref.update({ lastPublishAtMs: 0 });
    console.error('[forja] publicar', err.code, err.message);
    return sendError(res, err.status, err.code, err.message);
  }
});

// ---------------------------------------------------------------- conta Vercel de cada pessoa

const VERCEL_ACCOUNTS = 'forja_vercel_accounts';
// O token fica criptografado (AES-256-GCM com MEMORY_ENCRYPTION_KEY) e nunca volta para a tela.
const CRYPTO_SCOPE = 'forja-vercel';

async function loadVercelAccount(store: NonNullable<ReturnType<typeof db>>, uid: string) {
  const doc = await store.collection(VERCEL_ACCOUNTS).doc(uid).get();
  if (!doc.exists) return null;
  const x = doc.data()!;
  try {
    return { token: decryptPersonalMemory(x.token as Record<string, unknown>, CRYPTO_SCOPE, uid), teamId: (x.teamId as string) || null, username: String(x.username || '') };
  } catch {
    // Chave de criptografia trocada: a pessoa conecta de novo.
    return null;
  }
}

forjaRouter.get('/vercel', requireAuth, async (req: AuthenticatedRequest, res) => {
  const store = db();
  if (!store) return res.json({ connected: false });
  const doc = await store.collection(VERCEL_ACCOUNTS).doc(req.user!.uid).get();
  if (!doc.exists) return res.json({ connected: false });
  return res.json({ connected: true, username: String(doc.data()?.username || ''), connectedAt: doc.data()?.connectedAtMs || null });
});

forjaRouter.post('/vercel', requireAuth, async (req: AuthenticatedRequest, res) => {
  const store = db();
  if (!store) return sendError(res, 503, 'database_not_configured', 'Banco de dados indisponível.');
  const uid = req.user!.uid;
  try {
    const { username, teamId } = await verifyVercelToken(String(req.body?.token || ''));
    const token = encryptPersonalMemory(String(req.body.token).trim(), CRYPTO_SCOPE, uid);
    await store.collection(VERCEL_ACCOUNTS).doc(uid).set({ token, teamId, username, connectedAtMs: Date.now() });
    return res.json({ connected: true, username });
  } catch (e) {
    if (e instanceof MemoryEncryptionUnavailableError) return sendError(res, 503, 'encryption_unavailable', 'A Froc.IA ainda não está pronta para guardar tokens com segurança (falta MEMORY_ENCRYPTION_KEY). Avise o suporte.');
    if (e instanceof ForjaPublishError) return sendError(res, e.status, e.code, e.message);
    return sendError(res, 500, 'vercel_connect_failed', 'Não consegui conectar a sua Vercel agora. Tente de novo.');
  }
});

forjaRouter.delete('/vercel', requireAuth, async (req: AuthenticatedRequest, res) => {
  const store = db();
  if (!store) return sendError(res, 503, 'database_not_configured', 'Banco de dados indisponível.');
  await store.collection(VERCEL_ACCOUNTS).doc(req.user!.uid).delete();
  return res.json({ connected: false });
});

// ---------------------------------------------------------------- especialistas

/** Os 3 especialistas revisam ao mesmo tempo; quem falhar ou demorar é pulado (não trava). */
async function runSpecialists(ai: GoogleGenAI, model: string, files: Record<string, string>, prompt: string): Promise<SpecialistReview[]> {
  const content = specialistUserContent(files, prompt);
  const one = async (spec: (typeof SPECIALISTS)[number]): Promise<SpecialistReview> => {
    const call = ai.models.generateContent({
      model,
      contents: [{ role: 'user', parts: [{ text: content }] }],
      config: { systemInstruction: specialistSystemInstruction(spec.focus), responseMimeType: 'application/json', thinkingConfig: { thinkingLevel: 'LOW' } } as never,
    });
    // Se o tempo acabar antes, a resposta atrasada é descartada sem derrubar o servidor.
    call.catch(() => undefined);
    const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('tempo esgotado')), 45_000));
    try {
      const res = (await Promise.race([call, timeout])) as { text?: string };
      const issues = parseSpecialistIssues(String(res.text || ''));
      return { id: spec.id, name: spec.name, status: issues.length ? 'issues' : 'ok', issues };
    } catch (e) {
      console.warn('[forja] especialista', spec.id, (e as Error)?.message);
      return { id: spec.id, name: spec.name, status: 'skipped', issues: [] };
    }
  };
  return Promise.all(SPECIALISTS.map(one));
}
