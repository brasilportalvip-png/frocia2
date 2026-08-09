import React, {
  useCallback,
  useEffect,
  useState
} from 'react';
import {
  Server,
  Flame,
  CreditCard,
  Github,
  BrainCircuit,
  Rocket,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  XCircle
} from 'lucide-react';
import { apiClient } from '../services/apiClient';

interface HealthResponse {
  status: string;
  service: string;
  correlationId: string;
  firebaseConfigured: boolean;
  mercadoPagoConfigured: boolean;
}

type StatusTone =
  | 'operational'
  | 'warning'
  | 'offline';

interface StatusCardProps {
  title: string;
  description: string;
  status: string;
  details: string;
  tone: StatusTone;
  icon: React.ComponentType<{
    className?: string;
  }>;
}

const toneStyles: Record<
  StatusTone,
  {
    badge: string;
    icon: string;
  }
> = {
  operational: {
    badge:
      'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
    icon:
      'bg-emerald-500/15 text-emerald-400'
  },
  warning: {
    badge:
      'bg-amber-500/20 text-amber-300 border-amber-500/30',
    icon:
      'bg-amber-500/15 text-amber-400'
  },
  offline: {
    badge:
      'bg-rose-500/20 text-rose-300 border-rose-500/30',
    icon:
      'bg-rose-500/15 text-rose-400'
  }
};

const StatusCard: React.FC<StatusCardProps> = ({
  title,
  description,
  status,
  details,
  tone,
  icon: Icon
}) => {
  const styles = toneStyles[tone];

  return (
    <article className="p-6 rounded-[32px] glass-panel border border-white/15 space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div
            className={`w-12 h-12 rounded-2xl flex items-center justify-center ${styles.icon}`}
          >
            <Icon className="w-6 h-6" />
          </div>

          <div>
            <h2 className="text-lg font-bold text-white">
              {title}
            </h2>
            <p className="text-xs text-white/50">
              {description}
            </p>
          </div>
        </div>

        <span
          className={`px-3 py-1 rounded-full border text-[10px] font-bold whitespace-nowrap ${styles.badge}`}
        >
          {status}
        </span>
      </div>

      <p className="text-xs text-white/70 leading-relaxed">
        {details}
      </p>
    </article>
  );
};

export const IntegrationsPage: React.FC = () => {
  const [health, setHealth] =
    useState<HealthResponse | null>(null);
  const [loading, setLoading] =
    useState<boolean>(true);
  const [error, setError] =
    useState<string | null>(null);
  const [lastChecked, setLastChecked] =
    useState<string>('');

  const checkIntegrations =
    useCallback(async () => {
      setLoading(true);
      setError(null);

      try {
        const response =
          await apiClient<HealthResponse>(
            '/api/health'
          );

        setHealth(response);
        setLastChecked(
          new Date().toLocaleString('pt-BR')
        );
      } catch (requestError) {
        setHealth(null);
        setError(
          requestError instanceof Error
            ? requestError.message
            : 'Não foi possível consultar o backend.'
        );
      } finally {
        setLoading(false);
      }
    }, []);

  useEffect(() => {
    checkIntegrations();
  }, [checkIntegrations]);

  const backendOnline =
    health?.status === 'ok';

  return (
    <div className="flex-1 overflow-y-auto bg-slate-950 text-white p-6 md:p-8 custom-scrollbar">
      <div className="max-w-6xl mx-auto space-y-8">
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-white/10">
          <div className="space-y-1">
            <h1 className="text-2xl sm:text-3xl font-extrabold">
              Estado das integrações
            </h1>

            <p className="text-xs text-white/60">
              Informações obtidas do backend real do
              Froc.IA. Nenhuma conexão é simulada nesta
              tela.
            </p>
          </div>

          <button
            type="button"
            onClick={checkIntegrations}
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-2xl bg-purple-600 hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed text-xs font-bold transition-colors"
          >
            <RefreshCw
              className={`w-4 h-4 ${
                loading ? 'animate-spin' : ''
              }`}
            />
            {loading
              ? 'Verificando...'
              : 'Verificar novamente'}
          </button>
        </header>

        {error && (
          <div
            role="alert"
            className="flex items-start gap-3 p-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-200"
          >
            <XCircle className="w-5 h-5 shrink-0 mt-0.5" />

            <div>
              <p className="text-sm font-bold">
                Falha ao consultar o backend
              </p>
              <p className="text-xs mt-1">
                {error}
              </p>
            </div>
          </div>
        )}

        <div
          className="grid grid-cols-1 md:grid-cols-2 gap-6"
          aria-live="polite"
        >
          <StatusCard
            title="Backend Froc.IA"
            description="API Express na Vercel"
            status={
              loading
                ? 'Verificando'
                : backendOnline
                  ? 'Operacional'
                  : 'Indisponível'
            }
            tone={
              backendOnline
                ? 'operational'
                : 'offline'
            }
            icon={Server}
            details={
              backendOnline
                ? `Serviço respondeu corretamente. Identificador da verificação: ${health?.correlationId}`
                : 'O backend não respondeu corretamente à verificação de saúde.'
            }
          />

          <StatusCard
            title="Vercel"
            description="Hospedagem e funções serverless"
            status={
              backendOnline
                ? 'Operacional'
                : 'Não verificado'
            }
            tone={
              backendOnline
                ? 'operational'
                : 'warning'
            }
            icon={Rocket}
            details={
              backendOnline
                ? 'O frontend e a função serverless estão respondendo no ambiente de produção.'
                : 'Não foi possível confirmar o ambiente de produção.'
            }
          />

          <StatusCard
            title="Firebase"
            description="Authentication e Firestore"
            status={
              health?.firebaseConfigured
                ? 'Configurado'
                : 'Não configurado'
            }
            tone={
              health?.firebaseConfigured
                ? 'operational'
                : 'offline'
            }
            icon={Flame}
            details={
              health?.firebaseConfigured
                ? 'O Firebase Admin está configurado no backend. Authentication e criação de perfil no Firestore foram homologados.'
                : 'As credenciais do Firebase Admin não foram confirmadas pelo backend.'
            }
          />

          <StatusCard
            title="Mercado Pago"
            description="Cobranças Pix e webhook"
            status={
              health?.mercadoPagoConfigured
                ? 'Configurado'
                : 'Não configurado'
            }
            tone={
              health?.mercadoPagoConfigured
                ? 'operational'
                : 'offline'
            }
            icon={CreditCard}
            details={
              health?.mercadoPagoConfigured
                ? 'A criação de cobrança Pix e a validação de webhook foram homologadas. A aprovação com crédito automático ainda requer teste final.'
                : 'O token do Mercado Pago não foi confirmado pelo backend.'
            }
          />

          <StatusCard
            title="Gemini"
            description="Geração e refinamento com IA"
            status="Homologação pendente"
            tone="warning"
            icon={BrainCircuit}
            details="Os modelos estão implementados e os testes automatizados passam, mas a geração completa em produção ainda precisa ser validada com créditos de teste."
          />

          <StatusCard
            title="GitHub do usuário"
            description="OAuth e publicação de projetos"
            status="Não integrado"
            tone="warning"
            icon={Github}
            details="O repositório do próprio Froc.IA está conectado ao GitHub, mas ainda não existe OAuth para conectar contas e publicar projetos dos usuários."
          />
        </div>

        <footer className="flex items-start gap-3 p-4 rounded-2xl bg-blue-500/10 border border-blue-500/20 text-blue-100">
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />

          <div className="space-y-1">
            <p className="text-sm font-bold">
              Transparência operacional
            </p>
            <p className="text-xs text-blue-100/70">
              “Configurado” confirma que o backend possui
              a integração. “Homologação pendente”
              identifica funções que ainda precisam de um
              teste completo antes de serem oferecidas como
              prontas.
            </p>

            {lastChecked && (
              <p className="text-[11px] text-blue-200/50">
                Última verificação: {lastChecked}
              </p>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
};