import React, { useState } from 'react';
import { ExternalLink, KeyRound, Loader2, Rocket, X } from 'lucide-react';

interface ConnectVercelProps {
  /** Conta já conectada (mostra a opção de trocar ou desconectar). */
  username?: string | null;
  isBusy: boolean;
  error?: string | null;
  onConnect: (token: string) => void;
  onDisconnect: () => void;
  onClose: () => void;
}

/**
 * Conectar a conta Vercel da pessoa (uma vez só). Os sites dela ficam na conta dela:
 * sem custo e sem risco para a Froc.IA. O token vai criptografado e nunca volta para a tela.
 */
export const ConnectVercel: React.FC<ConnectVercelProps> = ({ username, isBusy, error, onConnect, onDisconnect, onClose }) => {
  const [token, setToken] = useState('');

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="forja-vercel-title">
      <div className="w-full max-w-md rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111723] text-slate-900 dark:text-slate-100 shadow-2xl">
        <div className="flex items-center justify-between gap-3 px-5 pt-4">
          <h2 id="forja-vercel-title" className="font-display font-semibold text-base flex items-center gap-2">
            <Rocket className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            {username ? 'Sua conta da Vercel' : 'Conecte sua Vercel para publicar'}
          </h2>
          <button type="button" onClick={onClose} aria-label="Fechar" className="p-1.5 rounded-md text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-3 text-sm">
          {username ? (
            <p className="text-slate-600 dark:text-slate-300">
              Seus sites são publicados na conta <strong className="text-slate-900 dark:text-slate-100">{username}</strong>. Para usar outra conta, cole um token novo abaixo.
            </p>
          ) : (
            <p className="text-slate-600 dark:text-slate-300">
              Seu site fica na <strong>sua</strong> conta da Vercel, com link próprio. A Vercel é grátis para sites pessoais. Você faz isso uma vez só.
            </p>
          )}

          <ol className="space-y-2 text-slate-700 dark:text-slate-300 list-decimal pl-5">
            <li>
              Não tem conta?{' '}
              <a href="https://vercel.com/signup" target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 underline underline-offset-2 inline-flex items-center gap-0.5">
                Crie grátis <ExternalLink className="w-3 h-3" />
              </a>
            </li>
            <li>
              Abra{' '}
              <a href="https://vercel.com/account/tokens" target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 underline underline-offset-2 inline-flex items-center gap-0.5">
                vercel.com/account/tokens <ExternalLink className="w-3 h-3" />
              </a>{' '}
              e clique em <strong>Create Token</strong>.
            </li>
            <li>
              Nome: <code className="font-mono text-xs px-1 py-0.5 rounded bg-slate-100 dark:bg-slate-800">froc-ia</code>. Em <strong>Scope</strong>, escolha o seu time (o nome que termina em <strong>Projects</strong>, onde ficam os seus sites). Em <strong>Expiration</strong>, escolha <strong>No Expiration</strong>.
            </li>
            <li>Copie o token e cole aqui:</li>
          </ol>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (token.trim() && !isBusy) onConnect(token.trim());
            }}
            className="space-y-2"
          >
            <label className="sr-only" htmlFor="forja-vercel-token">
              Token da Vercel
            </label>
            <div className="flex items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3">
              <KeyRound className="w-4 h-4 text-slate-400 shrink-0" />
              <input
                id="forja-vercel-token"
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Cole o token da Vercel"
                className="w-full bg-transparent py-2.5 text-sm font-mono outline-none placeholder:text-slate-400"
              />
            </div>
            {error && <p className="text-xs text-red-600 dark:text-red-400" role="alert">{error}</p>}
            <button
              type="submit"
              disabled={!token.trim() || isBusy}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:pointer-events-none text-white"
            >
              {isBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Rocket className="w-4 h-4" />}
              {isBusy ? 'Conectando…' : username ? 'Trocar conta e publicar' : 'Conectar e publicar'}
            </button>
          </form>

          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            O token fica guardado criptografado e só é usado para publicar os seus sites. Você pode apagá-lo a qualquer momento na Vercel.
          </p>

          {username && (
            <button type="button" onClick={onDisconnect} disabled={isBusy} className="text-xs text-red-600 dark:text-red-400 hover:underline">
              Desconectar esta conta
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
