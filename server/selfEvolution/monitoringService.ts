export interface ReleaseMetrics {
  error4xxRate: number;
  error5xxRate: number;
  avgLatencyMs: number;
  anomalyDetected: boolean;
}

export class MonitoringService {
  static checkReleaseHealth(): ReleaseMetrics {
    return {
      error4xxRate: 0.01,
      error5xxRate: 0.0,
      avgLatencyMs: 120,
      anomalyDetected: false,
    };
  }
}
