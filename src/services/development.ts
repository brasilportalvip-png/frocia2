import { apiClient } from './apiClient';
export const openDevelopmentWorkspace = (workspaceId: string, instruction = '') => window.dispatchEvent(new CustomEvent('froc:development-workspace', { detail: { workspaceId, instruction } }));
export const digest = async (bytes: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice().buffer))].map(b => b.toString(16).padStart(2, '0')).join('');
const base64 = (bytes: Uint8Array) => {
  let text = ''; for (let i = 0; i < bytes.length; i += 32_768) text += String.fromCharCode(...bytes.subarray(i, i + 32_768)); return btoa(text);
};
export async function uploadProjectZip(file: File, onProgress: (value: string) => void) {
  if (!file.size || file.size > 50 * 1024 * 1024) throw new Error('O ZIP deve ter até 50 MiB.');
  onProgress('Conferindo o arquivo original…'); const bytes = new Uint8Array(await file.arrayBuffer());
  const upload = await apiClient<{ id: string; partBytes: number }>('/api/development/uploads', { method: 'POST', body: JSON.stringify({ name: file.name, size: bytes.length, sha256: await digest(bytes) }) });
  for (let i = 0; i * upload.partBytes < bytes.length; i++) {
    onProgress(`Enviando parte ${i + 1} de ${Math.ceil(bytes.length / upload.partBytes)}…`);
    await apiClient(`/api/development/uploads/${upload.id}/parts/${i}`, { method: 'PUT', body: JSON.stringify({ data: base64(bytes.subarray(i * upload.partBytes, (i + 1) * upload.partBytes)) }) });
  }
  onProgress('Validando a árvore e os bytes no servidor…');
  return (await apiClient<{ workspace: any }>(`/api/development/uploads/${upload.id}/complete`, { method: 'POST', body: '{}' })).workspace;
}
export async function loadDevelopmentArtifact(endpoint: string) {
  const metadata = await apiClient<{ revision: string; sha256: string; size: number; chunks: number }>(endpoint);
  if (metadata.size > 50 * 1024 * 1024 || metadata.chunks > 135) throw new Error('Artefato excede o limite.');
  const bytes = new Uint8Array(metadata.size); let offset = 0;
  for (let i = 0; i < metadata.chunks; i++) {
    const part = await apiClient<{ data: string; sha256: string }>(`${endpoint}/parts/${i}?revision=${encodeURIComponent(metadata.revision)}`);
    const chunk = Uint8Array.from(atob(part.data), c => c.charCodeAt(0));
    if (await digest(chunk) !== part.sha256 || offset + chunk.length > bytes.length) throw new Error('Integridade da parte não confirmada.');
    bytes.set(chunk, offset); offset += chunk.length;
  }
  if (offset !== metadata.size || await digest(bytes) !== metadata.sha256) throw new Error('O checksum do artefato diverge do servidor.');
  return bytes;
}
export function saveDevelopmentArtifact(bytes: Uint8Array, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([bytes.slice().buffer], { type })), anchor = document.createElement('a');
  anchor.href = url; anchor.download = name.replace(/[^\w.-]/g, '_'); anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 5000);
}
