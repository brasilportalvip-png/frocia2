import { adminDb } from "../lib/firebaseAdmin.js";
import { sourceDigest } from "./professionalContract.js";
import type { ProfessionalBuild } from "./professionalBuildService.js";
import { ProfessionalMaintenanceService } from './professionalMaintenanceService.js';
import { FieldPath } from 'firebase-admin/firestore';
/** Monitoramento não efetua compras. Reparos só entram na fila por política
 * autenticada do proprietário do projeto e passam pelos gates da fábrica. */
export async function monitorProfessionalProjects(
  request: typeof fetch = fetch,
) {
  const maintenance = new ProfessionalMaintenanceService();
  await maintenance.reconcile();
  const cursorRef = adminDb.collection('site_factory_monitor_state').doc('cursor');
  const saved = (await cursorRef.get()).data()?.lastId;
  let query = adminDb
    .collection("site_factory_builds")
    .where("status", "==", "ready")
    .orderBy(FieldPath.documentId()).limit(25);
  if (typeof saved === 'string' && /^[a-f0-9]{64}$/.test(saved)) query = query.startAfter(saved);
  let docs = await query.get();
  if (!docs.docs.length && saved) docs = await adminDb.collection('site_factory_builds')
    .where('status', '==', 'ready').orderBy(FieldPath.documentId()).limit(25).get();
  const deadline = Date.now() + 240000;
  for (const doc of docs.docs) {
    if (Date.now() > deadline) break;
    const b = doc.data() as ProfessionalBuild;
    await cursorRef.set({ lastId: doc.id, checkedAt: new Date().toISOString() });
    if (b.publication?.deliveryKind === 'github') continue;
    const project = await adminDb.collection("projects").doc(b.projectId).get();
    if (
      !project.exists ||
      project.data()?.professionalBuildId !== b.id ||
      project.data()?.userId !== b.userId ||
      project.data()?.tenantId !== b.tenantId
    )
      continue;
    const failures: string[] = [];
    try {
      const origin = new URL(b.publication.productionUrl);
      if (
        origin.protocol !== "https:" ||
        !origin.hostname.endsWith(".vercel.app") ||
        origin.username ||
        origin.password
      )
        throw new Error("deployment_url_invalid");
      const release = await request(
        origin.origin + "/.well-known/froc-release.json",
        { signal: AbortSignal.timeout(15000), redirect: "error" },
      );
      if (
        !release.ok ||
        (await release.json()).releaseDigest !== sourceDigest(b.bundle!.files)
      )
        failures.push(
          "A versão publicada não corresponde à entrega verificada.",
        );
      for (const i of b.bundle!.integrations) {
        const r = await request(origin.origin + i.healthPath, {
          signal: AbortSignal.timeout(15000),
          redirect: "error",
        });
        const h = await r.json();
        if (
          !r.ok ||
          h.ok !== true ||
          h.environment !== "production" ||
          !Array.isArray(h.checks) ||
          !h.checks.length ||
          h.checks.some((c: any) => c.status !== "passed" || !c.receiptId)
        )
          failures.push("Integração indisponível: " + i.name);
      }
    } catch {
      failures.push("Não foi possível confirmar a saúde do projeto publicado.");
    }
    const monitoring = {
      status: failures.length ? "degraded" : "healthy",
      checkedAt: new Date().toISOString(),
      failures,
      consecutiveFailures: failures.length
        ? b.monitoring?.status === 'degraded'
          ? (b.monitoring.consecutiveFailures || 1) + (Date.now() - Date.parse(b.monitoring.checkedAt) >= 300000 ? 1 : 0)
          : 1 : 0,
    };
    await doc.ref.update({ monitoring });
    if (failures.length || b.monitoring?.status === 'degraded')
      await adminDb
        .collection("site_factory_alerts")
        .doc(b.id)
        .set({
          buildId: b.id,
          projectId: b.projectId,
          tenantId: b.tenantId,
          userId: b.userId,
          ...monitoring,
          resolved: !failures.length,
        });
    try {
      const result = await maintenance.react(b, monitoring);
      if (result.status === 'queued') await doc.ref.update({ maintenance: result });
    } catch (error) {
      console.warn('factory_maintenance_pending', { buildId: b.id, reason: error instanceof Error ? error.name : 'unavailable' });
    }
  }
}
