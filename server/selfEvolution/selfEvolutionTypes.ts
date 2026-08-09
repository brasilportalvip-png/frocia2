export type CandidateState =
  | 'detected'
  | 'triaged'
  | 'duplicate'
  | 'rejected'
  | 'awaiting_work_approval'
  | 'approved_for_work'
  | 'agent_running'
  | 'reproduction_created'
  | 'patch_created'
  | 'tests_failed'
  | 'tests_passed'
  | 'security_review_failed'
  | 'security_review_passed'
  | 'pull_request_opened'
  | 'ci_pending'
  | 'ci_failed'
  | 'ci_passed'
  | 'preview_deployed'
  | 'preview_failed'
  | 'awaiting_release_approval'
  | 'approved_for_release'
  | 'canary_deployed'
  | 'monitoring'
  | 'accepted'
  | 'rolled_back'
  | 'cancelled'
  | 'failed';

export type RiskLevel = 'R0' | 'R1' | 'R2' | 'R3';

export type MemoryType =
  | 'user_preference'
  | 'project_context'
  | 'approved_instruction'
  | 'previous_decision'
  | 'user_provided_fact'
  | 'confirmed_fix'
  | 'temporary_memory'
  | 'permanent_memory';

export interface UserMemory {
  id: string;
  userId: string;
  projectId?: string;
  conversationId?: string;
  type: MemoryType;
  category: string;
  content: string;
  contentHash: string;
  source: string;
  confidence: number;
  userApproved: boolean;
  status: 'active' | 'archived' | 'expired';
  expiresAt?: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string;
  usageCount: number;
}

export interface FeedbackEvent {
  id: string;
  userId: string;
  projectId?: string;
  type: 'explicit' | 'implicit';
  category: 'positive' | 'negative' | 'wrong_answer' | 'security_issue' | 'rephrased' | 'execution_failed' | 'cancelled';
  details: string;
  sanitizedContent: string;
  correlationId?: string;
  createdAt: string;
}

export interface KnowledgeDocument {
  id: string;
  ownerId: string;
  title: string;
  url?: string;
  contentHash: string;
  version: number;
  author: string;
  confidence: number;
  approved: boolean;
  permissions: string[];
  embeddingModel: string;
  embeddingDimension: number;
  indexingState: 'pending' | 'indexed' | 'failed';
  updatedAt: string;
}

export interface ImprovementCandidate {
  id: string;
  title: string;
  summary: string;
  evidence: string[];
  frequency: number;
  affectedUsersCount: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
  confidence: number;
  affectedComponents: string[];
  probableFiles: string[];
  hypothesis: string;
  expectedBehavior: string;
  riskLevel: RiskLevel;
  estimatedCostCredits: number;
  testPlan: string;
  rollbackStrategy: string;
  duplicates: string[];
  requiresApproval: boolean;
  state: CandidateState;
  branchName?: string;
  pullRequestUrl?: string;
  previewUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AuditRecord {
  id: string;
  actor: string;
  action: string;
  resource: string;
  previousState?: any;
  newState?: any;
  reason?: string;
  riskLevel: RiskLevel;
  result: 'success' | 'failure' | 'rejected';
  correlationId?: string;
  commitHash?: string;
  prUrl?: string;
  deployUrl?: string;
  previousRecordHash?: string;
  recordHash: string;
  timestamp: string;
}

export interface SelfEvolutionBudget {
  dailyCreditLimit: number;
  dailyCreditsUsed: number;
  monthlyCreditLimit: number;
  monthlyCreditsUsed: number;
  dailyMaxAgentRuns: number;
  dailyAgentRunsCount: number;
  lastResetDate: string;
}

export interface LeaseLock {
  id: string;
  resourceId: string;
  lockOwner: string;
  lockedAt: string;
  lockExpiresAt: string;
  heartbeatAt: string;
  attempt: number;
  maxAttempts: number;
}
