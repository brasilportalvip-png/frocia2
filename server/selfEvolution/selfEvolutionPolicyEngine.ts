import {
  adminDb,
  isFirebaseAdminConfigured
} from '../lib/firebaseAdmin.js';
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
    'vercel.json'
  ];

  private static systemEnabledOverride:
    | boolean
    | null = null;

  static isPathProtected(
    filePath: string
  ): boolean {
    const normalized = filePath.replace(/\\/g, '/');

    return this.PROTECTED_PATHS.some(
      (protectedPath) =>
        normalized === protectedPath ||
        normalized.startsWith(protectedPath)
    );
  }

  static classifyRisk(
    affectedFiles: string[],
    isSecurityComponent: boolean = false
  ): RiskLevel {
    if (isSecurityComponent) {
      return 'R3';
    }

    const hasProtectedFile = affectedFiles.some(
      (file) => this.isPathProtected(file)
    );

    if (hasProtectedFile) {
      return 'R3';
    }

    const isBusinessLogic = affectedFiles.some(
      (file) =>
        file.startsWith('server/routes/') ||
        file.startsWith('server/services/') ||
        file.startsWith('server/ai/')
    );

    if (isBusinessLogic) {
      return 'R2';
    }

    const isUIOnly = affectedFiles.every(
      (file) =>
        file.startsWith('src/') ||
        file.endsWith('.md') ||
        file.endsWith('.json')
    );

    if (isUIOnly) {
      return 'R1';
    }

    return 'R0';
  }

  static setSystemEnabled(
    enabled: boolean
  ): void {
    this.systemEnabledOverride = enabled;
  }

  static isSelfEvolutionEnabled(): boolean {
    if (this.systemEnabledOverride !== null) {
      return this.systemEnabledOverride;
    }

    return (
      process.env.SELF_EVOLUTION_ENABLED ===
      'true'
    );
  }

  static async isSelfEvolutionEnabledPersisted():
    Promise<boolean> {
    const enabledByEnvironment =
      process.env.SELF_EVOLUTION_ENABLED ===
      'true';

    if (!enabledByEnvironment) {
      return false;
    }

    if (
      this.systemEnabledOverride === false
    ) {
      return false;
    }

    if (!isFirebaseAdminConfigured()) {
      return enabledByEnvironment;
    }

    try {
      const snapshot = await adminDb
        .collection('self_evolution_config')
        .doc('system')
        .get();

      if (
        snapshot.exists &&
        snapshot.data()
          ?.SELF_EVOLUTION_ENABLED === false
      ) {
        this.systemEnabledOverride = false;
        return false;
      }

      return (
        this.systemEnabledOverride ??
        enabledByEnvironment
      );
    } catch (error) {
      console.error(
        'Falha ao consultar a parada persistente da autoevolução:',
        error
      );

      // Falha segura: se não for possível confirmar
      // o estado persistente, a execução não continua.
      return false;
    }
  }

  static isAutonomousProductionDeployAllowed():
    boolean {
    return (
      process.env
        .AUTONOMOUS_PRODUCTION_DEPLOY_ENABLED ===
      'true'
    );
  }

  static validateBranchName(
    branchName: string
  ): boolean {
    if (
      branchName === 'main' ||
      branchName === 'master'
    ) {
      return false;
    }

    return branchName.startsWith(
      'froc-evolution/'
    );
  }
}