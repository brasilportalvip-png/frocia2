export class ExecutionAbortRegistry {
  private static readonly controllers =
    new Map<string, AbortController>();

  static register(executionId: string): AbortSignal {
    const previous = this.controllers.get(executionId);

    if (previous && !previous.signal.aborted) {
      previous.abort(
        new Error('Execução substituída por uma nova chamada.')
      );
    }

    const controller = new AbortController();
    this.controllers.set(executionId, controller);

    return controller.signal;
  }

  static cancel(
    executionId: string,
    reason = 'Execução cancelada pelo usuário.'
  ): boolean {
    const controller = this.controllers.get(executionId);

    if (!controller) {
      return false;
    }

    if (!controller.signal.aborted) {
      controller.abort(new Error(reason));
    }

    this.controllers.delete(executionId);
    return true;
  }

  static clear(executionId: string): void {
    this.controllers.delete(executionId);
  }
}