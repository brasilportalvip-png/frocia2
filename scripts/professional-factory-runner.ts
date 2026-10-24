import { monitorProfessionalProjects } from "../server/siteFactory/professionalMonitoringService.js";
import { getProfessionalFactory } from "../server/siteFactory/professionalRuntime.js";
import { appendFile } from "node:fs/promises";
const service = getProfessionalFactory();
if (process.argv.includes("--monitor")) {
  await monitorProfessionalProjects();
} else if (process.argv.includes("--check")) {
  const queue = await service.repository.list();
  if (process.env.GITHUB_OUTPUT)
    await appendFile(
      process.env.GITHUB_OUTPUT,
      "has_jobs=" + String(queue.length > 0) + "\n",
    );
  console.log("Projetos pendentes:", queue.length);
} else {
  const deadline = Date.now() + 18 * 60000;
  while (Date.now() < deadline) {
    const jobs = await service.repository.list();
    if (!jobs.length) break;
    let progressed = false;
    for (const b of jobs) {
      if (Date.now() > deadline - 90000) break;
      if (b.lease && b.lease.expires > Date.now()) continue;
      // Leave enough time for the worker's bounded installation/browser operations.
      if (
        b.phase === 13 &&
        !b.certificate?.jobId &&
        Date.now() > deadline - 14 * 60000
      )
        continue;
      try {
        const result = await service.advance(b.id, b);
        console.log(
          JSON.stringify({
            buildId: result.id,
            status: result.status,
            phase: result.phase,
            consumedCredits: result.consumedCredits,
            error: result.error,
          }),
        );
        progressed ||= result.phase !== b.phase || result.status !== b.status;
      } catch {
        console.error("Falha ao retomar projeto", b.id);
      }
    }
    if (!progressed) await new Promise((resolve) => setTimeout(resolve, 12000));
  }
}
