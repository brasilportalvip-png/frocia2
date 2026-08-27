import {
  OperationalEventInput,
  OperationalTelemetryService,
} from './operationalTelemetryService.js';

let runtimeService: OperationalTelemetryService | null = null;

export function getOperationalTelemetryService(): OperationalTelemetryService {
  runtimeService ||= OperationalTelemetryService.createDefault();
  return runtimeService;
}

export function setOperationalTelemetryServiceForTests(
  service: OperationalTelemetryService | null
): void {
  runtimeService = service;
}

export async function recordOperationalEventBestEffort(
  event: OperationalEventInput
): Promise<void> {
  try {
    await getOperationalTelemetryService().record(event);
  } catch (error) {
    console.error('operational_telemetry_write_failed', {
      correlationId: event.correlationId,
      category: event.category,
      operation: event.operation,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
