export type WorkspaceView = 'preview' | 'code' | 'audit';
export type DeviceViewport = 'desktop' | 'tablet' | 'mobile';
export type BuildMode = 'full' | 'quick';
export type DesignPreset =
  | 'auto'
  | 'editorial-light'
  | 'corporate-dark'
  | 'commerce-minimal';

export type BuildPhase = 'idle' | 'planning' | 'coding' | 'verifying' | 'done' | 'error';

export interface GeneratedFileMeta {
  path: string;
  status: 'writing' | 'complete';
  lines: number;
  bytes: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  plan?: string;
  summary?: string;
  phase?: BuildPhase;
  phaseLabel?: string;
  files?: GeneratedFileMeta[];
  error?: string;
  /** Revisão dos especialistas (design, textos e SEO, segurança). */
  review?: SpecialistReviewView[];
  createdAt: number;
}

export interface SpecialistReviewView {
  id: string;
  name: string;
  status: 'ok' | 'issues' | 'skipped';
  issues: { severity: string; problem: string; fix: string; file?: string }[];
}

export interface StudioProject {
  id: string;
  name: string;
  slug: string;
  createdAt: number;
  updatedAt: number;
  files: Record<string, string>;
  messages: ChatMessage[];
  /** Link do site no ar (botão Publicar). */
  productionUrl?: string | null;
}

export interface AuditCheck {
  id: string;
  category: 'HTML & SEO' | 'Design & Responsividade' | 'Interatividade JS' | 'Pacote de Deploy';
  title: string;
  description: string;
  status: 'pass' | 'warn' | 'fail';
  detail: string;
  fixPrompt?: string;
}

export interface RuntimeErrorEvent {
  message: string;
  source?: string;
  line?: number;
  timestamp: number;
}
