import { RiskLevel } from './selfEvolutionTypes.js';

export class SelfEvolutionPolicyEngine {
  private static readonly PROTECTED_PATHS: string[] = [
    'AGENTS.md',
    '.env',
    '.env.example',
    '.github/',
    'server/middlewares/requireAuth.ts',
    'server/middlewares/requireAdmin.ts',
    'server/services/creditWalletService.ts',
    'server/services/mercadoPagoService.ts',
    'server/routes/selfEvolutionRoutes.ts',
    'server/selfEvolution/selfEvolutionPolicyEngine.ts',
    'firestore.rules',
    'storage.rules',
    'vercel.json',
  ];

  static isPathProtected(filePath: string): boolean {
    const normalized = filePath.replace(/\\/g, '/');
    return this.PROTECTED_PATHS.some((protectedPath) =>
      normalized === protectedPath || normalized.startsWith(protectedPath)
    );
  }

  static classifyRisk(affectedFiles: string[], isSecurityComponent: boolean = false): RiskLevel {
    if (isSecurityComponent) {
      return 'R3';
    }

    const hasProtectedFile = affectedFiles.some((f) => this.isPathProtected(f));
    if (hasProtectedFile) {
      return 'R3';
    }

    const isBusinessLogic = affectedFiles.some(
      (f) =>
        f.startsWith('server/routes/') ||
        f.startsWith('server/services/') ||
        f.startsWith('server/ai/')
    );

    if (isBusinessLogic) {
      return 'R2';
    }

    const isUIOnly = affectedFiles.every(
      (f) => f.startsWith('src/') || f.endsWith('.md') || f.endsWith('.json')
    );

    if (isUIOnly) {
      return 'R1';
    }

    return 'R0';
  }

  private static systemEnabledOverride: boolean | null = null;

  static setSystemEnabled(enabled: boolean): void {
    this.systemEnabledOverride = enabled;
  }

  static isSelfEvolutionEnabled(): boolean {
    if (this.systemEnabledOverride !== null) {
      return this.systemEnabledOverride;
    }
    return process.env.SELF_EVOLUTION_ENABLED === 'true';
  }

  static isAutonomousProductionDeployAllowed(): boolean {
    return process.env.AUTONOMOUS_PRODUCTION_DEPLOY_ENABLED === 'true';
  }

  static validateBranchName(branchName: string): boolean {
    if (branchName === 'main' || branchName === 'master') {
      return false;
    }
    return branchName.startsWith('froc-evolution/');
  }
}
