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
  preferredModel?: string;
}

export interface RouterResult {
  selectedModel: string;
  fallbackModels: string[];
  reasonCode: string;
  estimatedCredits: number;
  requiredCapabilities: Partial<ModelCapabilities>;
}

export interface ToolDeclaration {
  name: string;
  description: string;
  parameters: Record<string, any>;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  requiredRole?: 'user' | 'admin';
  requiresConfirmation?: boolean;
  timeoutMs?: number;
}

export interface ExecutionParams {
  userId: string;
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
  title: string;
  uri: string;
  snippet?: string;
  sourceType: 'web' | 'knowledge_base';
  docId?: string;
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
  scope: 'user' | 'project' | 'conversation';
  scopeId: string | null;
  category: string;
  content: string;
  source: string;
  confidence: number;
  validFrom: string;
  validUntil: string | null;
  status: 'active' | 'superseded' | 'deleted';
  userApproved: boolean;
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
  page?: number;
  section?: string;
  chunkIndex: number;
  contentHash: string;
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
