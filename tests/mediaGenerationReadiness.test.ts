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
      'uses a dedicated media API key',
      () => {
        expect(mediaRoutesSource).toContain(
          'process.env.GEMINI_MEDIA_API_KEY'
        );

        expect(mediaRoutesSource).not.toContain(
          'const apiKey = process.env.GEMINI_API_KEY'
        );

        expect(
          capabilityRegistrySource
        ).toContain(
          'process.env.GEMINI_MEDIA_API_KEY'
        );

        expect(envExampleSource).toContain(
          'GEMINI_MEDIA_API_KEY='
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
          '18 créditos por imagem 2K concluída'
        );

        expect(
          capabilityRegistrySource
        ).toContain(
          'Lite: 30; Fast: 46; Standard: 120 créditos'
        );
      }
    );

        it(
      'uses current image and video models',
      () => {
        expect(mediaRoutesSource).toContain(
          "'gemini-3.1-flash-image'"
        );

        expect(mediaRoutesSource).toContain(
          "'veo-3.1-lite-generate-preview'"
        );

        expect(mediaRoutesSource).toContain(
          "'veo-3.1-fast-generate-preview'"
        );

        expect(mediaRoutesSource).toContain(
          "'veo-3.1-generate-preview'"
        );

        expect(mediaRoutesSource).not.toContain(
          "'imagen-3.0-generate-002'"
        );

        expect(mediaRoutesSource).not.toContain(
          "'veo-2.0-generate-001'"
        );

        expect(mediaRoutesSource).not.toContain(
          "'veo-3.1-lite-generate-001'"
        );

        expect(mediaRoutesSource).not.toContain(
          "'veo-3.1-fast-generate-001'"
        );

        expect(mediaRoutesSource).not.toContain(
          "'veo-3.1-generate-001'"
        );

        expect(envExampleSource).toContain(
          'GEMINI_IMAGE_MODEL="gemini-3.1-flash-image"'
        );

        expect(envExampleSource).toContain(
          'VEO_LITE_MODEL="veo-3.1-lite-generate-preview"'
        );

        expect(envExampleSource).toContain(
          'VEO_FAST_MODEL="veo-3.1-fast-generate-preview"'
        );

        expect(envExampleSource).toContain(
          'VEO_STANDARD_MODEL="veo-3.1-generate-preview"'
        );
      }
    );
    it(
      'uses supported video durations and aspect ratios',
      () => {
        expect(mediaRoutesSource).toContain(
          "type VideoDuration = 4 | 6 | 8"
        );

        expect(mediaRoutesSource).toContain(
          "type VideoAspectRatio = '9:16' | '16:9'"
        );

        expect(mediaRoutesSource).not.toContain(
          "type VideoAspectRatio = '1:1' | '16:9'"
        );

        expect(mediaRoutesSource).toContain(
          'return 4;'
        );

        expect(mediaRoutesSource).toContain(
          'return 6;'
        );

        expect(mediaRoutesSource).toContain(
          'return 8;'
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
      'requires provider confirmation before cancellation refund',
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
          'cancelProviderVideoOperation'
        );

        expect(mediaRoutesSource).toContain(
          'if (!providerCancelled)'
        );

        expect(mediaRoutesSource).toContain(
          'Estorno após cancelamento confirmado pelo provedor'
        );

        expect(mediaRoutesSource).toContain(
          'Estorno após falha definitiva na geração de vídeo'
        );

        expect(mediaRoutesSource).not.toContain(
          'Estorno por cancelamento manual de vídeo'
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
          'temporary_browser_delivery'
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
        ).not.toContain('imageDataUrl');

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

    it(
      'uses the media formats accepted by the providers',
      () => {
        expect(mediaRoutesSource).toContain(
          "mime_type: 'image/jpeg'"
        );

        expect(mediaRoutesSource).not.toContain(
          "mime_type: 'image/png'"
        );

        expect(mediaServiceSource).toContain(
          "export type VideoDuration = 4 | 6 | 8"
        );

        expect(mediaServiceSource).toContain(
          "| '9:16'"
        );

        expect(mediaModalSource).toContain(
          'useState<VideoDuration>(4)'
        );

        expect(mediaModalSource).toContain(
          '<option value={4}>'
        );

        expect(mediaModalSource).toContain(
          '<option value={6}>'
        );

        expect(mediaModalSource).toContain(
          '<option value={8}>'
        );

        expect(mediaModalSource).not.toContain(
          '<option value={5}>'
        );

        expect(mediaModalSource).not.toContain(
          '<option value={7}>'
        );

        expect(mediaModalSource).toContain(
          '<option value="9:16">'
        );

        expect(mediaModalSource).not.toContain(
          '<option value="1:1">'
        );

        expect(mediaModalSource).toContain(
          'Baixar imagem em JPEG'
        );

        expect(mediaModalSource).toContain(
          'Solicitar cancelamento'
        );

        expect(mediaModalSource).not.toContain(
          'Cancelar e devolver créditos'
        );

        expect(mediaModalSource).toContain(
          'RESOURCE_EXHAUSTED'
        );
      }
    );
  }
);