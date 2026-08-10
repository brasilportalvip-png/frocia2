export interface ReleaseMetrics {
  status: 'configured' | 'not_configured' | 'healthy' | 'unhealthy';
  error4xxRate: number;
  error5xxRate: number;
  avgLatencyMs: number;
  anomalyDetected: boolean;
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
        error4xxRate: 0,
        error5xxRate: 0,
        avgLatencyMs: 0,
        anomalyDetected: false,
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
          error4xxRate: 0,
          error5xxRate: 0,
          avgLatencyMs: 0,
          anomalyDetected: true,
          message: `Endpoint de monitoramento retornou HTTP ${response.status}`,
        };
      }

      const data = await response.json();
      const anomalyDetected = (data.error5xxRate || 0) > 0.02 || (data.avgLatencyMs || 0) > 2000;

      return {
        status: anomalyDetected ? 'unhealthy' : 'healthy',
        error4xxRate: data.error4xxRate || 0,
        error5xxRate: data.error5xxRate || 0,
        avgLatencyMs: data.avgLatencyMs || 0,
        anomalyDetected,
        message: anomalyDetected ? 'Anomalia de performance/erros detectada no monitoramento real.' : undefined,
      };
    } catch (err: any) {
      return {
        status: 'unhealthy',
        error4xxRate: 0,
        error5xxRate: 0,
        avgLatencyMs: 0,
        anomalyDetected: true,
        message: `Falha ao consultar métricas de monitoramento: ${err?.message || err}`,
      };
    }
  }
}

