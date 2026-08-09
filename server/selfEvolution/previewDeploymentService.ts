export interface PreviewDeployResult {
  previewUrl: string;
  deploymentId: string;
  status: 'ready' | 'failed';
}

export class PreviewDeploymentService {
  static createPreviewDeployment(candidateId: string): PreviewDeployResult {
    return {
      previewUrl: `https://frocia2-preview-${candidateId}.vercel.app`,
      deploymentId: `dep-${candidateId}`,
      status: 'ready',
    };
  }
}
