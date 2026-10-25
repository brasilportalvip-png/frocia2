/** Credentials are supplied only for this project's verified preview origin. */
export function previewProtectionHeaders(url, target, current = {}, secret = '') {
  const headers = Object.fromEntries(Object.entries(current).filter(([key]) =>
    !['x-vercel-protection-bypass', 'x-vercel-set-bypass-cookie'].includes(key.toLowerCase())));
  const request = new URL(url), preview = new URL(target);
  if (secret && request.origin === preview.origin && preview.protocol === 'https:' &&
      /^frocia2-[a-z0-9-]+-brasilportalvip-4274s-projects\.vercel\.app$/.test(preview.hostname)) {
    headers['x-vercel-protection-bypass'] = secret;
  }
  return headers;
}

export async function installPreviewProtection(context, target, secret = '') {
  if (!secret) return;
  // Production verification uses the same worker. Its public origin must not
  // inherit a preview credential or be blocked merely because one is set.
  if (new URL(target).origin === 'https://frocia2.vercel.app') return;
  if (!previewProtectionHeaders(target, target, {}, secret)['x-vercel-protection-bypass'])
    throw new Error('preview_protection_target_not_allowed');
  await context.route('**/*', async route => {
    const request = route.request();
    const headers = previewProtectionHeaders(request.url(), target, request.headers(), secret);
    if (new URL(request.url()).origin !== new URL(target).origin) {
      await route.continue({ headers });
      return;
    }
    // Fetch each hop independently: never forward the credential to a redirect target.
    const response = await route.fetch({ headers, maxRedirects: 0 });
    await route.fulfill({ response });
  });
}
