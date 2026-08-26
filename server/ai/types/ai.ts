export type AIMode =
  | 'fast'
  | 'smart'
  | 'deep'
  | 'code'
  | 'research'
  | 'site-builder'
  | 'image'
  | 'video'
  | 'document';

export type SpecialistDomain =
  | 'general'
  | 'research'
  | 'marketing'
  | 'sales'
  | 'code'
  | 'site-builder'
  | 'ux-accessibility'
  | 'data-documents'
  | 'security'
  | 'finance'
  | 'legal'
  | 'health'
  | 'social-media';

export type RequestComplexity =
  | 'simple'
  | 'standard'
  | 'complex';

export type RequestSensitivity =
  | 'normal'
  | 'personal-data'
  | 'high-stakes';

export interface RequestClassification {
  domain: SpecialistDomain;
  complexity: RequestComplexity;
  sensitivity: RequestSensitivity;
  requiresSearch: boolean;
  requiresTools: boolean;
  requiresCode: boolean;
  requiresIndependentVerification: boolean;
  reasons: string[];
}

export interface ModelCapabilities {
  text: boolean;
  vision: boolean;
  audio: boolean;
  video: boolean;
  code: boolean;
  tools: boolean;
  structuredOutput: boolean;
  longContext: boolean;
  embeddings: boolean;
}

export interface AIModelDefinition {
  id: string;
  provider: 'google';
  enabled: boolean;
  capabilities: ModelCapabilities;
  priority: number;
  timeoutMs: number;
  maxRetries: number;
  costProfile: string;
  pricing: {
    inputTokensPerCredit: number;
    outputTokensPerCredit: number;
    baseCreditCost: number;
  };
}

export interface RouterInput {
  mode: AIMode;
  prompt: string;
  hasImages?: boolean;
  hasFiles?: boolean;
  contextSizeEstimate?: number;
  requiresTools?: boolean;
  requiresSearch?: boolean;
  requiresCode?: boolean;
  domain?: SpecialistDomain;
  complexity?: RequestComplexity;
  sensitivity?: RequestSensitivity;
  preferredModel?: string;
}

export interface RouterResult {
  selectedModel: string;
  fallbackModels: string[];
  reasonCode: string;
  estimatedCredits: number;
  requiredCapabilities: Partial<ModelCapabilities>;
}

export type ToolAuthScope =
  | 'user'
  | 'project'
  | 'admin'
  | 'external_oauth';

export interface ToolDeclaration {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  authScopes: ToolAuthScope[];
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  requiredRole?: 'user' | 'admin';
  mutatesState: boolean;
  requiresConfirmation: boolean;
  idempotencyRequired: boolean;
  timeoutMs: number;
  maxRetries: number;
  retryBackoffMs: number;
  costLimitCredits: number;
  rateLimit: {
    windowMs: number;
    maxRequests: number;
  };
  redactFields: string[];
  verificationStrategy:
    | 'deterministic'
    | 'provider_receipt'
    | 'human_review';
}

export interface ExecutionParams {
  userId: string;
  tenantId?: string;
  userDisplayName?: string;
  conversationId?: string | null;
  projectId?: string | null;
  mode: AIMode;
  prompt: string;
  attachments?: Array<{ type: string; url?: string; data?: string; mimeType?: string; name?: string }>;
  systemInstruction?: string;
  idempotencyKey?: string;
  responseFormat?: 'text' | 'json';
  jsonSchema?: Record<string, any>;
  tools?: string[];
  knowledgeBaseIds?: string[];
  modelOverride?: string;
  abortSignal?: AbortSignal;
}

export interface ExecutionRecord {
  executionId: string;
  userId: string;
  conversationId: string | null;
  projectId: string | null;
  mode: AIMode;
  selectedModel: string;
  fallbackModels: string[];
  attemptedModels: string[];
  status: 'created' | 'running' | 'waiting_tool' | 'completed' | 'failed' | 'cancelled';
  promptVersion: string;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedTokens: number | null;
  estimatedCredits: number;
  consumedCredits: number | null;
  reservationId: string;
  latencyMs: number | null;
  fallbackUsed: boolean;
  correlationId: string;
  errorCode: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  requestDomain?: SpecialistDomain;
  requestComplexity?: RequestComplexity;
  requestSensitivity?: RequestSensitivity;
  requiresSearch?: boolean;
  toolsRequested?: string[];
  researchEvidenceStatus?:
    | 'not_requested'
    | 'supported'
    | 'limited'
    | 'unsupported';
  ragEvidenceStatus?:
    | 'not_requested'
    | 'supported'
    | 'limited'
    | 'unsupported';
  sourceCount?: number;
  sourceDomains?: string[];
  contextTruncated?: boolean;
  omittedHistoryCount?: number;
}

export interface Conversation {
  id: string;
  userId: string;
  projectId: string | null;
  title: string;
  mode: AIMode;
  summary?: string;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MessageCitation {
  index?: number;
  title: string;
  uri: string;
  snippet?: string;
  sourceType: 'web' | 'knowledge_base';
  docId?: string;
  domain?: string;
  retrievedAt?: string;
}

export interface Message {
  id: string;
  conversationId: string;
  userId: string;
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
  attachments?: any[];
  citations?: MessageCitation[];
  executionId?: string | null;
  model?: string;
  createdAt: string;
}

export interface UserMemory {
  id: string;
  userId: string;
  tenantId: string;
  scope: 'user' | 'organization' | 'project' | 'conversation';
  scopeId: string | null;
  category: string;
  content: string;
  source: string;
  confidence: number;
  purpose:
    | 'personalization'
    | 'project_continuity'
    | 'conversation_context'
    | 'user_note';
  sensitivity: 'standard' | 'personal';
  retentionDays: number;
  consentVersion: string;
  consentedAt: string;
  sourceMessageIds: string[];
  validFrom: string;
  validUntil: string | null;
  status: 'active' | 'superseded' | 'deleted';
  userApproved: boolean;
  retrievalReason?: string;
  relevanceScore?: number;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeBase {
  id: string;
  userId: string;
  name: string;
  description: string;
  collaborators: string[];
  status: 'active' | 'archived';
  documentCount: number;
  version: string;
  lastIndexedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeDocument {
  id: string;
  knowledgeBaseId: string;
  userId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  status: 'uploaded' | 'processing' | 'indexed' | 'failed' | 'deleted';
  chunkCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeChunk {
  id: string;
  documentId: string;
  knowledgeBaseId: string;
  userId: string;
  text: string;
  filename?: string;
  page?: number;
  section?: string;
  chunkIndex: number;
  contentHash: string;
  revisionId?: string;
  documentVersion?: string;
  sourceUrl?: string;
  effectiveAt?: string | null;
  expiresAt?: string | null;
  embeddingModel: string;
  embeddingVersion: string;
  embedding?: number[];
  createdAt: string;
}

export interface PromptDefinition {
  id: string;
  name: string;
  agent: string;
  mode: AIMode;
  activeVersionId: string;
  createdAt: string;
  updatedAt: string;
}

export interface PromptVersion {
  id: string;
  promptId: string;
  version: string;
  status: 'draft' | 'testing' | 'staging' | 'production' | 'retired';
  compatibleModels: string[];
  content: string;
  variables: string[];
  authorUid: string;
  evalScore: number | null;
  distributionPercentage: number;
  createdAt: string;
}

export interface EvaluationResult {
  id: string;
  testName: string;
  category: 'accuracy' | 'rag' | 'tool_calling' | 'safety' | 'code' | 'latency';
  input: string;
  expectedBehavior: string;
  actualOutput: string;
  score: number; // 0 to 1
  model: string;
  promptVersion: string;
  latencyMs: number;
  costCredits: number;
  status: 'passed' | 'failed';
  evaluatedAt: string;
}
