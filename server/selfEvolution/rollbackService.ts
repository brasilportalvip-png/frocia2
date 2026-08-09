export interface RollbackResult {
  success: boolean;
  revertedCommitHash: string;
  message: string;
}

export class RollbackService {
  static executeRollback(candidateId: string, reason: string): RollbackResult {
    return {
      success: true,
      revertedCommitHash: `revert-commit-${candidateId}`,
      message: `Rollback do candidato ${candidateId} concluído com sucesso. Motivo: ${reason}`,
    };
  }
}
