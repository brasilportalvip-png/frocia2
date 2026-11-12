import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { BLOB_CHUNK_BYTES, blobDocId, splitIntoChunks } from '../server/lib/mediaBlobStore.js';

const read = (file: string) => fs.readFileSync(path.resolve(process.cwd(), file), 'utf8');

describe('Vídeo e imagem não se perdem quando o Storage recusa', () => {
  it('divide o arquivo em pedaços que cabem no Firestore e remonta igual', () => {
    const bytes = Buffer.alloc(BLOB_CHUNK_BYTES * 2 + 1234, 7);
    const chunks = splitIntoChunks(bytes);
    expect(chunks).toHaveLength(3);
    expect(chunks.every((chunk) => chunk.length <= BLOB_CHUNK_BYTES)).toBe(true);
    expect(Buffer.concat(chunks).equals(bytes)).toBe(true);
    expect(blobDocId('media/u1/videos/job_vid_1.mp4')).toBe('media__u1__videos__job_vid_1.mp4');
  });

  it('o vídeo pronto é guardado com reserva e não falha por causa do Storage', () => {
    const media = read('server/routes/mediaRoutes.ts');
    expect(media).toContain("videoStorage = await saveMediaBlob(storagePath");
    expect(media).toContain('readMediaBlob(job.storagePath, job.videoStorage)');
    expect(media).toContain("storageStatus = await saveMediaBlob(objectPath");
    expect(media).toContain("['private_bucket', 'firestore_chunks'].includes(media?.storageStatus)");
    expect(media).not.toContain('await bucket.file(storagePath).save(');
    const store = read('server/lib/mediaBlobStore.ts');
    expect(store).toContain("await saveToFirestore(path, bytes, contentType);");
  });
});
