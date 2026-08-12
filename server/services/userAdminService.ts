import {
  adminAuth,
  adminDb,
  isFirebaseAdminConfigured
} from '../lib/firebaseAdmin.js';
import {
  FieldPath
} from 'firebase-admin/firestore';

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
          const PAGE_SIZE = 400;
      const emailMap =
        new Map<string, string[]>();

      let lastDocumentId:
        | string
        | null = null;

      while (true) {
        let query = adminDb
          .collection('users')
          .orderBy(
            FieldPath.documentId()
          )
          .limit(PAGE_SIZE);

        if (lastDocumentId) {
          query = query.startAfter(
            lastDocumentId
          );
        }

        const snapshot =
          await query.get();

        if (snapshot.empty) {
          break;
        }

        report.totalUsersScanned +=
          snapshot.size;

        snapshot.forEach((document) => {
          const data =
            document.data() || {};

          const rawEmail = String(
            data.email || ''
          )
            .trim()
            .toLowerCase();

          if (!rawEmail) {
            return;
          }

          const existing =
            emailMap.get(rawEmail) || [];

          existing.push(document.id);
          emailMap.set(
            rawEmail,
            existing
          );
        });

        lastDocumentId =
          snapshot.docs.at(-1)?.id ??
          null;

        if (
          snapshot.size < PAGE_SIZE ||
          !lastDocumentId
        ) {
          break;
        }
      }

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
