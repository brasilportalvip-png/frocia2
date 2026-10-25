/** Explicitly supported text families; a generic generateContent listing is not
 * proof of the structured JSON contract. Unknown/multimodal families stay out. */
export function structuredEngineeringModel(value) {
  return /^gemini-(?:2\.5|3(?:\.\d+)?)-(?:pro|flash)(?:-lite)?(?:-preview(?:-[0-9-]+)?)?$/i.test(String(value));
}
export function patchThinkingConfig(model) {
  const id = String(model).replace(/^models\//, '');
  if (/^gemini-3(?:\.\d+)?-(?:pro|flash)/i.test(id)) return { thinkingLevel: 'LOW' };
  if (/^gemini-2\.5-(?:pro|flash)/i.test(id)) return { thinkingBudget: 4096 };
  return undefined;
}
/** Never propagate provider message bodies or generated source into diagnostics. */
export function patchProviderDiagnostic(error, model) {
  const diagnostic = { model, providerStatus: Number.isInteger(error?.status) ? error.status : null };
  let message = String(error?.message || '');
  try { const parsed = JSON.parse(message); message = String(parsed?.error?.message || parsed?.message || ''); } catch { /* SDK may return plain text. */ }
  const rules = [
    ['thinking_configuration', /thinking[_ ]?(?:level|budget|config)|thinkingConfig/i],
    ['output_token_limit', /max[_ ]?output[_ ]?tokens|output token.{0,50}(?:limit|exceed)/i],
    ['response_schema', /response[_ ]?(?:json[_ ]?)?schema|responseMimeType|response_mime_type|json schema/i],
    ['input_token_limit', /input.{0,30}token|context.{0,30}(?:limit|length)|request.{0,20}too large/i],
    ['unsupported_request_option', /not supported|unsupported|unknown field/i],
  ];
  diagnostic.reason = rules.find(([, pattern]) => pattern.test(message))?.[0] || 'provider_rejected_or_unavailable';
  return diagnostic;
}
