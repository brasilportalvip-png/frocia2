export function committeeNavigation(href: string): { openAdmin: boolean; candidateId: string | null } {
  const url = new URL(href);
  const openAdmin = url.searchParams.get('view') === 'admin' && url.searchParams.get('tab') === 'selfEvolution';
  const id = url.searchParams.get('committee');
  return { openAdmin, candidateId: openAdmin && id && /^[a-zA-Z0-9_-]{1,100}$/.test(id) ? id : null };
}

export function committeeLink(href: string, candidateId?: string): string {
  const url = new URL(href);
  url.searchParams.set('view', 'admin');
  url.searchParams.set('tab', 'selfEvolution');
  if (candidateId) {
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(candidateId)) throw new Error('Identificador de tarefa inválido.');
    url.searchParams.set('committee', candidateId);
  } else {
    url.searchParams.delete('committee');
  }
  return url.toString();
}
