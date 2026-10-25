export function engineeringTask(body) {
  const evidence = Array.isArray(body.evidence)
    ? body.evidence.filter(item => typeof item === 'string').slice(-32).map(item => item.slice(0, 16_000)) : [];
  return { evidence, title: body.title, summary: body.summary, hypothesis: body.hypothesis,
    expectedBehavior: body.expectedBehavior, testPlan: body.testPlan };
}

export function generationInput(body, allowed, sourceFiles, engineeringContext) {
  return { task: engineeringTask(body), allowedPaths: [...allowed], sourceFiles, engineeringContext };
}
