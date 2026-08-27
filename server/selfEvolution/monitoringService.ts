export interface ReleaseMetrics {
  status: 'configured' | 'not_configured' | 'healthy' | 'unhealthy';
  error4xxRate: number | null;
  error5xxRate: number | null;
  avgLatencyMs: number | null;
  anomalyDetected: boolean | null;
  message?: string;
}

export class MonitoringService {
  private static isConfigured(): boolean {
    const monitoringUrl = process.env.MONITORING_API_URL;
    return Boolean(monitoringUrl && monitoringUrl.trim().length > 0);
  }

  static async checkReleaseHealth(releaseId?: string): Promise<ReleaseMetrics> {
    if (!this.isConfigured()) {
      return {
        status: 'not_configured',
        error4xxRate: null,
        error5xxRate: null,
        avgLatencyMs: null,
        anomalyDetected: null,
        message: 'Serviço de observabilidade/monitoramento pós-release não configurado (MONITORING_API_URL ausente).',
      };
    }

    try {
      const url = `${process.env.MONITORING_API_URL}/api/metrics${releaseId ? `?releaseId=${releaseId}` : ''}`;
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${process.env.MONITORING_API_KEY || ''}`,
        },
      });

      if (!response.ok) {
        return {
          status: 'unhealthy',
          error4xxRate: null,
          error5xxRate: null,
          avgLatencyMs: null,
          anomalyDetected: true,
          message: `Endpoint de monitoramento retornou HTTP ${response.status}`,
        };
      }

      const data = await response.json() as Record<string, unknown>;
      const error4xxRate =
        typeof data.error4xxRate === 'number' && Number.isFinite(data.error4xxRate)
          ? data.error4xxRate
          : null;
      const error5xxRate =
        typeof data.error5xxRate === 'number' && Number.isFinite(data.error5xxRate)
          ? data.error5xxRate
          : null;
      const avgLatencyMs =
        typeof data.avgLatencyMs === 'number' && Number.isFinite(data.avgLatencyMs)
          ? data.avgLatencyMs
          : null;
      const hasRequiredMetrics = error5xxRate !== null && avgLatencyMs !== null;
      const anomalyDetected = hasRequiredMetrics
        ? error5xxRate > 0.02 || avgLatencyMs > 2000
        : null;

      return {
        status:
          anomalyDetected === null
            ? 'unhealthy'
            : anomalyDetected
              ? 'unhealthy'
              : 'healthy',
        error4xxRate,
        error5xxRate,
        avgLatencyMs,
        anomalyDetected,
        message:
          anomalyDetected === null
            ? 'O provedor não retornou métricas suficientes para avaliar a release.'
            : anomalyDetected
              ? 'Anomalia de performance/erros detectada no monitoramento real.'
              : undefined,
      };
    } catch (err: any) {
      return {
        status: 'unhealthy',
        error4xxRate: null,
        error5xxRate: null,
        avgLatencyMs: null,
        anomalyDetected: true,
        message: `Falha ao consultar métricas de monitoramento: ${err?.message || err}`,
      };
    }
  }
}
