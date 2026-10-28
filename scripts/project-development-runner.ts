import { runDevelopmentJob } from '../server/development/runner.js';
const jobId = process.env.DEVELOPMENT_JOB_ID || '';
try {
  const result = await runDevelopmentJob(jobId, process.env.GITHUB_RUN_ID || '');
  console.log(JSON.stringify(result));
  if (result.claimed && result.status === 'blocked') process.exitCode = 1;
} catch {
  console.error('Não foi possível assumir a execução. Nenhum projeto foi marcado como concluído.'); process.exitCode = 1;
}
