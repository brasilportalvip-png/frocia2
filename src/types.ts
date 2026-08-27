export type ViewMode = 'preview' | 'code' | 'split';
export type DeviceView = 'desktop' | 'tablet' | 'mobile';
export type AppNavigationMode = 'landing' | 'studio' | 'dashboard' | 'pricing' | 'integrations' | 'admin';

export interface GeneratedSite {
  id: string;
  title: string;
  description: string;
  prompt: string;
  category: string;
  colorPalette: string;
  tone: string;
  html: string;
  createdAt: number;
  updatedAt: number;
  isFavorite?: boolean;
  isArchived?: boolean;
  type?: 'site' | 'landing' | 'ecommerce' | 'system' | 'app' | 'dashboard';
  suggestedRefinements?: string[];
  stats?: {
    sectionsCount?: number;
    theme?: string;
  };
}

export interface ChatMessage {
  id: string;
  sender: 'user' | 'ai';
  text: string;
  timestamp: number;
  isHtmlUpdate?: boolean;
  citations?: Array<{
    index?: number;
    title: string;
    uri: string;
    snippet?: string;
    sourceType?: 'web' | 'knowledge_base';
    domain?: string;
  }>;
}

export interface Conversation {
  id: string;
  userId: string;
  title: string;
  mode: string;
  summary?: string;
  projectId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SiteTemplate {
  id: string;
  title: string;
  category: string;
  description: string;
  badge: string;
  iconName: string;
  colorPalette: string;
  prompt: string;
  sampleHtml: string;
}

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  avatarUrl: string;
  role: 'admin' | 'user';
  plan: 'Teste' | 'Inicial' | 'Criador' | 'Profissional' | 'Agência';
  creditsRemaining: number;
  creditsMax: number;
  creditsReserved?: number;
  isAuthenticated: boolean;
  emailVerified?: boolean;
}

export interface AIModelConfig {
  id: string;
  name: string;
  provider: 'Google Gemini' | 'Imagen 3' | 'Veo Video' | 'Fallback Local';
  category: 'Raciocínio' | 'Rápido' | 'Código' | 'Imagem' | 'Vídeo' | 'Reserva';
  costPerOp: number;
  speedMs: number | null;
  contextWindow: string;
  status: 'operacional' | 'degradado' | 'manutencao';
  errorRate: string | null;
  isFallbackActive?: boolean;
}

export interface CreditTransaction {
  id: string;
  date: string;
  description: string;
  type: 'consumption' | 'recharge' | 'bonus' | 'refund';
  amount: number;
  balanceAfter: number;
  referenceId?: string;
  status: 'concluido' | 'pendente' | 'cancelado';
}

export interface CreditPackage {
  id: string;
  name: string;
  credits: number;
  priceBrl: number;
  bonus: number;
  badge?: string;
  popular?: boolean;
  features: string[];
}

export interface IntegrationStatus {
  githubConnected: boolean;
  githubUser?: string;
  githubReposCount?: number;
  vercelConnected: boolean;
  vercelUser?: string;
  vercelProjectsCount?: number;
  firebaseConnected: boolean;
  geminiConnected: boolean;
  mercadoPagoConnected: boolean;
  whatsappConnected: boolean;
}

export interface UploadedFile {
  id: string;
  name: string;
  size: number;
  type: 'image' | 'audio' | 'video' | 'document' | 'zip' | 'code' | 'camera' | 'screen' | 'url' | 'github';
  url?: string;
  dataUrl?: string;
  contentBase64?: string;
  contentText?: string;
  relativePath?: string;
  lastModified?: number;
  source?:
    | 'local'
    | 'camera'
    | 'microphone'
    | 'screen'
    | 'url'
    | 'github'
    | 'code'
    | 'zip-analysis'
    | 'knowledge-base';
  status: 'uploading' | 'scanning' | 'ready' | 'quarantine' | 'error';
  progress: number;
  hash?: string;
  mime?: string;
  securityStatus?: {
    appCheckValidated: boolean;
    quotaChecked: boolean;
    hashCalculated: boolean;
    malwareClean: boolean;
    duplicateDetected: boolean;
    metadataExtracted: boolean;
  };
  extractedSummary?: string;
  insights?: {
    docType?: string;
    language?: string;
    keyTopics?: string[];
    codeLanguages?: string[];
    tableDetected?: boolean;
    hasSensativeData?: boolean;
  };
}

export interface AIAttachmentPayload {
  type:
    | 'image'
    | 'audio'
    | 'video'
    | 'document'
    | 'code';
  name: string;
  mimeType: string;
  data: string;
  sizeBytes: number;
  sha256: string;
}

export interface KnowledgeBase {
  id: string;
  name: string;
  description: string;
  owner: string;
  files: UploadedFile[];
  chunksCount: number;
  indexStatus: 'idle' | 'indexing' | 'ready' | 'failed';
  costEstimate: string;
  updatedAt: number;
  collaborators?: string[];
}

export interface ZipProjectAnalysis {
  fileName: string;
  fileTree: Array<{ path: string; isDir: boolean; size?: number }>;
  detectedStack: string[];
  entryPoints: string[];
  dependenciesCount: number;
  envVars: string[];
  secretsExposed: Array<{ file: string; line: number; type: string; snippet: string }>;
  vulnerabilities: Array<{ severity: 'alta' | 'media' | 'baixa'; title: string; fix: string }>;
  architectureSummary: string;
  buildStatus: 'nao_testado' | 'em_sandbox' | 'sucesso' | 'falha';
  sandboxLogs: string[];
}

export interface AgentOrchestrationState {
  activeAgents: Array<{ id: string; name: string; role: string; status: 'idle' | 'working' | 'done'; icon: string }>;
  autonomyMode: 'assistente' | 'copiloto' | 'autonomo_supervisionado';
  verificationState: 'planejamento' | 'desenvolvimento' | 'teste' | 'homologacao' | 'pronto_producao';
  evidenceLog: Array<{ step: string; timestamp: number; passed: boolean; details: string }>;
}

export interface ArtifactData {
  id: string;
  title: string;
  type: 'document' | 'code' | 'site' | 'app' | 'image' | 'video' | 'sheet' | 'presentation' | 'diagram';
  content: string;
  htmlPreview?: string;
  language?: string;
  versions?: Array<{ id: string; timestamp: number; content: string; description: string }>;
}

export type ChatMode = 'Rápido' | 'Inteligente' | 'Profundo' | 'Programação' | 'Pesquisa' | 'Criador de projetos' | 'Imagem' | 'Vídeo';

export interface AuditLog {
  id: string;
  timestamp: string;
  actor: string;
  action: string;
  target: string;
  status: 'sucesso' | 'aviso' | 'erro';
  ip: string;
}
