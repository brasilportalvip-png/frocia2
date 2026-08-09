interface ModelHealthStats {
  modelId: string;
  totalCalls: number;
  successCount: number;
  failureCount: number;
  timeoutCount: number;
  fallbackCount: number;
  avgLatencyMs: number;
  lastCheckedAt: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
}

export class ModelHealthService {
  private static healthData: Map<string, ModelHealthStats> = new Map();

  static recordCall(modelId: string, latencyMs: number, success: boolean, isTimeout = false, isFallback = false) {
    let stats = this.healthData.get(modelId);
    if (!stats) {
      stats = {
        modelId,
        totalCalls: 0,
        successCount: 0,
        failureCount: 0,
        timeoutCount: 0,
        fallbackCount: 0,
        avgLatencyMs: 0,
        lastCheckedAt: new Date().toISOString(),
        status: 'healthy',
      };
      this.healthData.set(modelId, stats);
    }

    stats.totalCalls += 1;
    if (success) {
      stats.successCount += 1;
    } else {
      stats.failureCount += 1;
    }

    if (isTimeout) stats.timeoutCount += 1;
    if (isFallback) stats.fallbackCount += 1;

    stats.avgLatencyMs = Math.round((stats.avgLatencyMs * (stats.totalCalls - 1) + latencyMs) / stats.totalCalls);
    stats.lastCheckedAt = new Date().toISOString();

    const failureRate = stats.failureCount / stats.totalCalls;
    if (failureRate > 0.3) {
      stats.status = 'unhealthy';
    } else if (failureRate > 0.1 || stats.timeoutCount > 2) {
      stats.status = 'degraded';
    } else {
      stats.status = 'healthy';
    }
  }

  static isModelHealthy(modelId: string): boolean {
    const stats = this.healthData.get(modelId);
    if (!stats) return true; // default healthy until proven otherwise
    return stats.status !== 'unhealthy';
  }

  static getHealthOverview() {
    return Array.from(this.healthData.values());
  }
}
