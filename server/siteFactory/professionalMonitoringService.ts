import { adminDb } from "../lib/firebaseAdmin.js";
import { sourceDigest } from "./professionalContract.js";
import type { ProfessionalBuild } from "./professionalBuildService.js";
/** Monitoramento sem executar compras nem alterar dados do projeto. */
export async function monitorProfessionalProjects(
  request: typeof fetch = fetch,
) {
  const docs = await adminDb
    .collection("site_factory_builds")
    .where("status", "==", "ready")
    .limit(100)
    .get();
  for (const doc of docs.docs) {
    const b = doc.data() as ProfessionalBuild;
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
    };
    await doc.ref.update({ monitoring });
    if (failures.length)
      await adminDb
        .collection("site_factory_alerts")
        .doc(b.id)
        .set({
          buildId: b.id,
          projectId: b.projectId,
          tenantId: b.tenantId,
          userId: b.userId,
          ...monitoring,
        });
  }
}
