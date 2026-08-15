import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../lib/firebaseAdmin.js';

export const FEATURE_FLAG_DEFINITIONS = {
  ai_chat: {
    name: 'Conversas e gerações com IA',
    category: 'Inteligência Artificial',
    description:
      'Autoriza novas chamadas de conversa e geração pelo motor principal.',
    defaultEnabled: true,
    available: true,
    protectedByKillSwitch: true
  },
  payment_checkout: {
    name: 'Novos checkouts Mercado Pago',
    category: 'Financeiro',
    description:
      'Autoriza a criação de novos pagamentos. Webhooks de pagamentos existentes permanecem ativos.',
    defaultEnabled: true,
    available: true,
    protectedByKillSwitch: true
  },
  automated_evaluations: {
    name: 'Avaliações automatizadas da IA',
    category: 'Qualidade',
    description:
      'Autoriza administradores a executar novas suítes reais de homologação.',
    defaultEnabled: true,
    available: true,
    protectedByKillSwitch: true
  },
  image_generation: {
    name: 'Geração de imagens',
    category: 'Multimídia',
    description:
      'Libera chamadas de geração de imagens quando o provedor correspondente estiver homologado.',
    defaultEnabled: false,
    available: false,
    protectedByKillSwitch: true
  },
  video_generation: {
    name: 'Geração de vídeos',
    category: 'Multimídia',
    description:
      'Libera chamadas de geração de vídeos quando o provedor correspondente estiver homologado.',
    defaultEnabled: false,
    available: false,
    protectedByKillSwitch: true
  }
} as const;

export type FeatureFlagKey =
  keyof typeof FEATURE_FLAG_DEFINITIONS;

interface EmergencyState {
  active: boolean;
  reason: string | null;
  activatedAt: string | null;
  activatedBy: string | null;
  previousValues: Partial<
    Record<FeatureFlagKey, boolean>
  >;
}

export interface FeatureFlagItem {
  key: FeatureFlagKey;
  name: string;
  category: string;
  description: string;
  enabled: boolean;
  available: boolean;
  protectedByKillSwitch: boolean;
}

export interface FeatureFlagSnapshot {
  flags: FeatureFlagItem[];
  emergency: EmergencyState;
  updatedAt: string;
  updatedBy: string | null;
}

const CONFIG_COLLECTION = 'system_config';
const CONFIG_DOCUMENT = 'feature_flags';
const AUDIT_COLLECTION = 'feature_flag_audit';

function defaultFlagValues(): Record<
  FeatureFlagKey,
  boolean
> {
  return Object.fromEntries(
    Object.entries(FEATURE_FLAG_DEFINITIONS).map(
      ([key, definition]) => [
        key,
        definition.defaultEnabled
      ]
    )
  ) as Record<FeatureFlagKey, boolean>;
}

function defaultEmergencyState(): EmergencyState {
  return {
    active: false,
    reason: null,
    activatedAt: null,
    activatedBy: null,
    previousValues: {}
  };
}

function isFeatureFlagKey(
  value: string
): value is FeatureFlagKey {
  return Object.prototype.hasOwnProperty.call(
    FEATURE_FLAG_DEFINITIONS,
    value
  );
}

function normalizeFlagValues(
  value: unknown
): Record<FeatureFlagKey, boolean> {
  const defaults = defaultFlagValues();

  if (!value || typeof value !== 'object') {
    return defaults;
  }

  const raw = value as Record<string, unknown>;

  for (const key of Object.keys(defaults)) {
    if (
      isFeatureFlagKey(key) &&
      typeof raw[key] === 'boolean'
    ) {
      defaults[key] = raw[key] as boolean;
    }
  }

  return defaults;
}

function normalizeEmergency(
  value: unknown
): EmergencyState {
  if (!value || typeof value !== 'object') {
    return defaultEmergencyState();
  }

  const raw = value as Record<string, unknown>;

  return {
    active: raw.active === true,
    reason:
      typeof raw.reason === 'string'
        ? raw.reason
        : null,
    activatedAt:
      typeof raw.activatedAt === 'string'
        ? raw.activatedAt
        : null,
    activatedBy:
      typeof raw.activatedBy === 'string'
        ? raw.activatedBy
        : null,
    previousValues: normalizePartialFlagValues(
      raw.previousValues
    )
  };
}

function normalizePartialFlagValues(
  value: unknown
): Partial<Record<FeatureFlagKey, boolean>> {
  const result: Partial<
    Record<FeatureFlagKey, boolean>
  > = {};

  if (!value || typeof value !== 'object') {
    return result;
  }

  for (const [key, enabled] of Object.entries(
    value as Record<string, unknown>
  )) {
    if (
      isFeatureFlagKey(key) &&
      typeof enabled === 'boolean'
    ) {
      result[key] = enabled;
    }
  }

  return result;
}

function buildItems(
  values: Record<FeatureFlagKey, boolean>,
  emergencyActive: boolean
): FeatureFlagItem[] {
  return Object.entries(FEATURE_FLAG_DEFINITIONS).map(
    ([rawKey, definition]) => {
      const key = rawKey as FeatureFlagKey;
      const forcedOff =
        emergencyActive &&
        definition.protectedByKillSwitch;

      return {
        key,
        name: definition.name,
        category: definition.category,
        description: definition.description,
        enabled: forcedOff ? false : values[key],
        available: definition.available,
        protectedByKillSwitch:
          definition.protectedByKillSwitch
      };
    }
  );
}

export class FeatureFlagDisabledError extends Error {
  readonly flag: FeatureFlagKey;

  constructor(flag: FeatureFlagKey) {
    super(`feature_disabled:${flag}`);
    this.name = 'FeatureFlagDisabledError';
    this.flag = flag;
  }
}

export class FeatureFlagService {
  private static configRef() {
    return adminDb
      .collection(CONFIG_COLLECTION)
      .doc(CONFIG_DOCUMENT);
  }

  static async getSnapshot(): Promise<FeatureFlagSnapshot> {
    const reference = this.configRef();
    const document = await reference.get();

    if (!document.exists) {
      const flags = defaultFlagValues();
      const emergency = defaultEmergencyState();
      const now = new Date().toISOString();

      await reference.set({
        flags,
        emergency,
        updatedAt: now,
        updatedBy: 'system'
      });

      return {
        flags: buildItems(flags, false),
        emergency,
        updatedAt: now,
        updatedBy: 'system'
      };
    }

    const data = document.data() ?? {};
    const flags = normalizeFlagValues(data.flags);
    const emergency = normalizeEmergency(data.emergency);

    return {
      flags: buildItems(flags, emergency.active),
      emergency,
      updatedAt:
        typeof data.updatedAt === 'string'
          ? data.updatedAt
          : new Date().toISOString(),
      updatedBy:
        typeof data.updatedBy === 'string'
          ? data.updatedBy
          : null
    };
  }

  static async isEnabled(
    key: FeatureFlagKey
  ): Promise<boolean> {
    const snapshot = await this.getSnapshot();
    return (
      snapshot.flags.find((flag) => flag.key === key)
        ?.enabled ?? false
    );
  }

  static async assertEnabled(
    key: FeatureFlagKey
  ): Promise<void> {
    if (!(await this.isEnabled(key))) {
      throw new FeatureFlagDisabledError(key);
    }
  }

  static async updateFlag(input: {
    key: FeatureFlagKey;
    enabled: boolean;
    updatedBy: string;
  }): Promise<FeatureFlagSnapshot> {
    const { key, enabled } = input;
    const updatedBy = input.updatedBy.trim();

    if (!isFeatureFlagKey(key)) {
      throw new Error('feature_flag_not_found');
    }

    if (!updatedBy) {
      throw new Error('feature_flag_actor_required');
    }

    if (
      enabled &&
      !FEATURE_FLAG_DEFINITIONS[key].available
    ) {
      throw new Error('feature_not_available');
    }

    const reference = this.configRef();

    await adminDb.runTransaction(async (transaction) => {
      const document = await transaction.get(reference);
      const data = document.data() ?? {};
      const flags = normalizeFlagValues(data.flags);
      const emergency = normalizeEmergency(data.emergency);

      if (
        emergency.active &&
        FEATURE_FLAG_DEFINITIONS[key]
          .protectedByKillSwitch &&
        enabled
      ) {
        throw new Error('emergency_mode_active');
      }

      const previousValue = flags[key];
      flags[key] = enabled;
      const now = new Date().toISOString();

      transaction.set(
        reference,
        {
          flags,
          emergency,
          updatedAt: now,
          updatedBy
        },
        { merge: true }
      );

      const auditRef = adminDb
        .collection(AUDIT_COLLECTION)
        .doc();

      transaction.set(auditRef, {
        action: 'flag_updated',
        key,
        previousValue,
        newValue: enabled,
        actorUid: updatedBy,
        createdAt: FieldValue.serverTimestamp()
      });
    });

    return this.getSnapshot();
  }

  static async activateEmergency(input: {
    reason: string;
    activatedBy: string;
  }): Promise<FeatureFlagSnapshot> {
    const reason = input.reason.trim();
    const activatedBy = input.activatedBy.trim();

    if (reason.length < 10 || reason.length > 500) {
      throw new Error('invalid_emergency_reason');
    }

    if (!activatedBy) {
      throw new Error('feature_flag_actor_required');
    }

    const reference = this.configRef();

    await adminDb.runTransaction(async (transaction) => {
      const document = await transaction.get(reference);
      const data = document.data() ?? {};
      const flags = normalizeFlagValues(data.flags);
      const currentEmergency = normalizeEmergency(
        data.emergency
      );

      if (currentEmergency.active) {
        throw new Error('emergency_mode_already_active');
      }

      const previousValues: Partial<
        Record<FeatureFlagKey, boolean>
      > = {};

      for (const rawKey of Object.keys(
        FEATURE_FLAG_DEFINITIONS
      )) {
        const key = rawKey as FeatureFlagKey;

        if (
          FEATURE_FLAG_DEFINITIONS[key]
            .protectedByKillSwitch
        ) {
          previousValues[key] = flags[key];
          flags[key] = false;
        }
      }

      const now = new Date().toISOString();
      const emergency: EmergencyState = {
        active: true,
        reason,
        activatedAt: now,
        activatedBy,
        previousValues
      };

      transaction.set(
        reference,
        {
          flags,
          emergency,
          updatedAt: now,
          updatedBy: activatedBy
        },
        { merge: true }
      );

      const auditRef = adminDb
        .collection(AUDIT_COLLECTION)
        .doc();

      transaction.set(auditRef, {
        action: 'emergency_activated',
        reason,
        previousValues,
        actorUid: activatedBy,
        createdAt: FieldValue.serverTimestamp()
      });
    });

    return this.getSnapshot();
  }

  static async deactivateEmergency(input: {
    reason: string;
    deactivatedBy: string;
  }): Promise<FeatureFlagSnapshot> {
    const reason = input.reason.trim();
    const deactivatedBy = input.deactivatedBy.trim();

    if (reason.length < 10 || reason.length > 500) {
      throw new Error('invalid_emergency_reason');
    }

    if (!deactivatedBy) {
      throw new Error('feature_flag_actor_required');
    }

    const reference = this.configRef();

    await adminDb.runTransaction(async (transaction) => {
      const document = await transaction.get(reference);
      const data = document.data() ?? {};
      const flags = normalizeFlagValues(data.flags);
      const emergency = normalizeEmergency(data.emergency);

      if (!emergency.active) {
        throw new Error('emergency_mode_not_active');
      }

      for (const [rawKey, previousValue] of Object.entries(
        emergency.previousValues
      )) {
        if (
          isFeatureFlagKey(rawKey) &&
          typeof previousValue === 'boolean'
        ) {
          flags[rawKey] = previousValue;
        }
      }

      const now = new Date().toISOString();

      transaction.set(
        reference,
        {
          flags,
          emergency: defaultEmergencyState(),
          updatedAt: now,
          updatedBy: deactivatedBy
        },
        { merge: true }
      );

      const auditRef = adminDb
        .collection(AUDIT_COLLECTION)
        .doc();

      transaction.set(auditRef, {
        action: 'emergency_deactivated',
        reason,
        restoredValues: emergency.previousValues,
        actorUid: deactivatedBy,
        createdAt: FieldValue.serverTimestamp()
      });
    });

    return this.getSnapshot();
  }
}