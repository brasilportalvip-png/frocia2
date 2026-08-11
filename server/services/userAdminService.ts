import {
  adminAuth,
  adminDb,
  isFirebaseAdminConfigured,
} from '../lib/firebaseAdmin.js';

export interface EmailDuplicateAuditReport {
  timestamp: string;
  totalUsersScanned: number;
  duplicateGroupCount: number;
  duplicateGroups: Array<{
    email: string;
    canonicalUid: string | null;
    firestoreDocIds: string[];
  }>;
}

export class UserAdminService {
  /**
   * Resolves a user by email using canonical adminAuth.getUserByEmail().
   * NEVER accepts the first doc blindly from a simple Firestore query.
   */
  static async resolveCanonicalUserByEmail(email: string): Promise<{ uid: string; email: string; emailVerified: boolean }> {
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) {
      throw new Error('E-mail inválido para busca canônica.');
    }

    try {
      const userRecord = await adminAuth.getUserByEmail(cleanEmail);
      return {
        uid: userRecord.uid,
        email: userRecord.email || cleanEmail,
        emailVerified: Boolean(userRecord.emailVerified),
      };
    } catch (error: any) {
      throw new Error(`Usuário não encontrado no Firebase Auth pelo e-mail '${cleanEmail}': ${error?.message || error}`);
    }
  }

  /**
   * Audits Firestore users collection for duplicate email entries.
   * Produces a secure diagnostic report without modifying data automatically.
   */
  static async auditDuplicateUserEmails(): Promise<EmailDuplicateAuditReport> {
    const report: EmailDuplicateAuditReport = {
      timestamp: new Date().toISOString(),
      totalUsersScanned: 0,
      duplicateGroupCount: 0,
      duplicateGroups: [],
    };

   if (!isFirebaseAdminConfigured()) {
  return report;
}

    try {
      const snapshot = await adminDb.collection('users').get();
      report.totalUsersScanned = snapshot.size;

      const emailMap = new Map<string, string[]>();

      snapshot.forEach((doc) => {
        const data = doc.data() || {};
        const rawEmail = (data.email || '').toString().trim().toLowerCase();
        if (rawEmail) {
          const existing = emailMap.get(rawEmail) || [];
          existing.push(doc.id);
          emailMap.set(rawEmail, existing);
        }
      });

      for (const [email, docIds] of emailMap.entries()) {
        if (docIds.length > 1) {
          let canonicalUid: string | null = null;
          try {
            const canonicalUser = await adminAuth.getUserByEmail(email);
            canonicalUid = canonicalUser.uid;
          } catch {
            canonicalUid = null;
          }

          report.duplicateGroups.push({
            email,
            canonicalUid,
            firestoreDocIds: docIds,
          });
        }
      }

      report.duplicateGroupCount = report.duplicateGroups.length;
    } catch (err) {
      console.error('❌ Erro na auditoria de e-mails duplicados:', err);
    }

    return report;
  }
}
