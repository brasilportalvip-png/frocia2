import { structuredEngineeringModel } from './generation-contract.mjs';
const modelId = value => {
  const id = String(value || '').trim().replace(/^models\//, '');
  return /^gemini-[a-z0-9.-]{1,100}$/i.test(id) && !/image|tts|audio|embedding|live|robotics|computer-use/i.test(id) ? id : null;
};
/** One generation per outer repair attempt. Transient outages rotate models,
 * while invalid JSON or test failures keep the current model and repair feedback. */
export function createEngineeringModelSession({ preferred, fallbacks = '', listModels, onDiagnostic = () => {},
  wait = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  let current = modelId(preferred);
  if (!current) throw new Error('engineering_model_invalid');
  const configured = [...new Set(String(fallbacks).split(',').map(modelId).filter(id => id && structuredEngineeringModel(id)))].slice(0, 4);
  const failed = new Set(); let available;
  return {
    async next(feedback = null) {
      if (feedback?.stage !== 'generation' || !String(feedback.summary).includes('generator_provider_error')) return current;
      failed.add(current);
      if (!available) {
        try {
          const rows = await listModels();
          available = [...new Set(rows.filter(row => Array.isArray(row.supportedActions) && row.supportedActions.includes('generateContent') &&
            (!row.outputTokenLimit || row.outputTokenLimit >= 65536)).map(row => modelId(row.name)).filter(id => id && structuredEngineeringModel(id)))];
          available.sort((a, b) => {
            const rank = id => (/flash/i.test(id) ? 0 : 4) + (/lite/i.test(id) ? 1 : 0) + (/preview|experimental|exp-/i.test(id) ? 2 : 0);
            return rank(a) - rank(b) || b.localeCompare(a, undefined, { numeric: true });
          });
          onDiagnostic({ event: 'model_catalog', available: available.length });
        } catch { available = configured; onDiagnostic({ event: 'model_catalog_unavailable', configuredAlternatives: configured.length }); }
      }
      const ordered = [...configured.filter(id => available.includes(id)), ...available];
      const next = ordered.find(id => !failed.has(id));
      if (next) current = next;
      onDiagnostic({ event: next ? 'model_failover' : 'same_model_retry_no_alternative', model: current, providerStatus: feedback.providerStatus || null });
      // Backoff is bounded and is part of the existing total of three attempts.
      await wait(Math.min(6000, 2000 * failed.size));
      return current;
    },
  };
}
