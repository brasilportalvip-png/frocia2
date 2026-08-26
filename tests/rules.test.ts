import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Firestore and Storage Security Rules Unit Verification', () => {
  const firestoreRulesPath = path.join(process.cwd(), 'firestore.rules');
  const storageRulesPath = path.join(process.cwd(), 'storage.rules');

  it('should verify firestore.rules exists and contains critical security guards', () => {
    expect(fs.existsSync(firestoreRulesPath)).toBe(true);
    const rules = fs.readFileSync(firestoreRulesPath, 'utf-8');

    // Rule structure verification
    expect(rules).toContain("rules_version = '2';");
    expect(rules).toContain('service cloud.firestore');

    // Owner and Admin checks
expect(rules).toContain('function isAuthenticated()');
expect(rules).toContain('function isOwner(userId)');
expect(rules).toContain('function isAdmin()');

// Projects must be created and updated only for the authenticated owner
expect(rules).toContain('match /projects/{projectId}');
expect(rules).toContain(
  'request.resource.data.userId == request.auth.uid'
);
expect(rules).toContain(
  'resource.data.userId == request.auth.uid'
);
expect(rules).not.toContain('resource == null');
expect(rules).toContain("'tenantId', 'companyId', 'organizationId'");

// Strict backend-only financial mutations
    expect(rules).toContain('match /payments/{paymentId}');
    expect(rules).toContain('match /credit_transactions/{txId}');
    expect(rules).toContain('match /credit_reservations/{resId}');

    // Memory content and its audit trail are API/backend only.
    expect(rules).toContain('match /user_memories/{memId}');
    expect(rules).toContain('match /memory_audit_events/{eventId}');
    expect(rules).toContain('match /durable_executions/{executionId}');
    expect(rules).toContain('match /durable_execution_events/{eventId}');
    expect(rules).toContain('match /durable_execution_outbox/{outboxId}');

    // Default deny rule
    expect(rules).toContain('match /{document=**}');
    expect(rules).toContain('allow read, write: if false;');
  });

  it('should verify storage.rules prevents cross-user read access', () => {
    expect(fs.existsSync(storageRulesPath)).toBe(true);
    const rules = fs.readFileSync(storageRulesPath, 'utf-8');

    // Rule structure verification
    expect(rules).toContain("rules_version = '2';");
    expect(rules).toContain('service firebase.storage');

    // User path security
    expect(rules).toContain('match /users/{userId}/{allPaths=**}');
    expect(rules).toContain('allow read: if isOwner(userId) || isAdmin();');
    expect(rules).not.toContain('allow read: if isAuthenticated();');

    // File size and MIME checks
    expect(rules).toContain('function isValidSize()');
    expect(rules).toContain('function isAllowedMimeType()');

    // Default deny
    expect(rules).toContain('allow read, write: if false;');
  });
});
