import {
  describe,
  expect,
  it,
} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  FEATURE_FLAG_DEFINITIONS,
} from '../server/services/featureFlagService.js';

function readProjectFile(
  relativePath: string
): string {
  return fs.readFileSync(
    path.resolve(process.cwd(), relativePath),
    'utf8'
  );
}

describe(
  'Image and video production readiness',
  () => {
    const mediaRoutesSource = readProjectFile(
      'server/routes/mediaRoutes.ts'
    );

    const capabilityRegistrySource =
      readProjectFile(
        'server/services/capabilityRegistryService.ts'
      );

    const appSource = readProjectFile(
      'src/App.tsx'
    );

    const mediaModalSource = readProjectFile(
      'src/components/MediaGenerationModal.tsx'
    );

    const mediaServiceSource = readProjectFile(
      'src/services/mediaGenerationService.ts'
    );

    const envExampleSource = readProjectFile(
      '.env.example'
    );

    it(
      'keeps image and video disabled by default',
      () => {
        expect(
          FEATURE_FLAG_DEFINITIONS
            .image_generation
            .available
        ).toBe(
          process.env
            .IMAGE_GENERATION_AVAILABLE ===
            'true'
        );

        expect(
          FEATURE_FLAG_DEFINITIONS
            .video_generation
            .available
        ).toBe(
          process.env
            .VIDEO_GENERATION_AVAILABLE ===
            'true'
        );

        expect(envExampleSource).toContain(
          'IMAGE_GENERATION_AVAILABLE="false"'
        );

        expect(envExampleSource).toContain(
          'IMAGE_GENERATION_ENABLED="false"'
        );

        expect(envExampleSource).toContain(
          'VIDEO_GENERATION_AVAILABLE="false"'
        );

        expect(envExampleSource).toContain(
          'VIDEO_GENERATION_ENABLED="false"'
        );
      }
    );

    it(
      'never creates fake image or video results',
      () => {
        expect(mediaRoutesSource).not.toContain(
          'data:image/svg+xml'
        );

        expect(mediaRoutesSource).not.toContain(
          'op_veo_'
        );

        expect(mediaRoutesSource).not.toContain(
          'Increment progress gradually'
        );

        expect(mediaRoutesSource).toContain(
          'O provedor não retornou uma imagem válida.'
        );

        expect(mediaRoutesSource).toContain(
          'O provedor de vídeo não retornou uma operação válida.'
        );
      }
    );

    it(
      'uses the official media credit matrix',
      () => {
        expect(mediaRoutesSource).toContain(
          'const IMAGE_COST = 18'
        );

        expect(mediaRoutesSource).toMatch(
          /lite:\s*30/
        );

        expect(mediaRoutesSource).toMatch(
          /fast:\s*46/
        );

        expect(mediaRoutesSource).toMatch(
          /standard:\s*120/
        );

        expect(
          capabilityRegistrySource
        ).toContain(
          '18 créditos por imagem concluída'
        );

        expect(
          capabilityRegistrySource
        ).toContain(
          'Lite: 30; Fast: 46; Standard: 120 créditos'
        );
      }
    );

    it(
      'connects image and video modes to the real media modal',
      () => {
        expect(appSource).toContain(
          "mode === 'Imagem'"
        );

        expect(appSource).toContain(
          "mode === 'Vídeo'"
        );

        expect(appSource).toContain(
          '<MediaGenerationModal'
        );

        expect(mediaModalSource).toContain(
          'MediaGenerationService.generateImage'
        );

        expect(mediaModalSource).toContain(
          'MediaGenerationService.startVideo'
        );

        expect(mediaModalSource).toContain(
          'MediaGenerationService.waitForVideo'
        );

        expect(mediaServiceSource).toContain(
          "'/api/ai/media/image'"
        );

        expect(mediaServiceSource).toContain(
          "'/api/ai/media/video'"
        );
      }
    );

    it(
      'supports video polling, cancellation and credit refunds',
      () => {
        expect(mediaServiceSource).toContain(
          'waitForVideo'
        );

        expect(mediaServiceSource).toContain(
          'cancelVideo'
        );

        expect(mediaRoutesSource).toContain(
          'releaseVideoReservation'
        );

        expect(mediaRoutesSource).toContain(
          'Estorno por cancelamento manual de vídeo'
        );

        expect(mediaRoutesSource).toContain(
          'Estorno após falha definitiva na geração de vídeo'
        );
      }
    );

    it(
  'does not persist image base64 inside Firestore',
  () => {
    expect(mediaRoutesSource).toContain(
      'storageStatus'
    );

    expect(mediaRoutesSource).toContain(
      'awaiting_persistent_storage'
    );

    const mediaRecordStart =
      mediaRoutesSource.indexOf(
        'const mediaRecord = {'
      );

    const firestoreWrite =
      mediaRoutesSource.indexOf(
        '.set(mediaRecord)',
        mediaRecordStart
      );

    expect(mediaRecordStart).toBeGreaterThan(-1);
    expect(firestoreWrite).toBeGreaterThan(
      mediaRecordStart
    );

    const persistedRecordSource =
      mediaRoutesSource.slice(
        mediaRecordStart,
        firestoreWrite
      );

    expect(
      persistedRecordSource
    ).not.toContain('url: imageDataUrl');

    const responseImageUrl =
      mediaRoutesSource.indexOf(
        'url: imageDataUrl',
        firestoreWrite
      );

        expect(responseImageUrl).toBeGreaterThan(
      firestoreWrite
    );
  }
);
  }
);