import React, { useState, useEffect } from 'react';
import { X, Lock, Mail, User, LogIn, KeyRound, Loader2, AlertCircle, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose }) => {
  const { register, login, loginWithGoogle, resetPassword } = useAuth();

  const [mode, setMode] = useState<'login' | 'register' | 'forgot'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [name, setName] = useState('');
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen && !isSubmitting) {
        handleClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isSubmitting]);

  if (!isOpen) return null;

  const resetForm = () => {
    setEmail('');
    setPassword('');
    setName('');
    setError(null);
    setInfoMessage(null);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfoMessage(null);

    if (mode === 'register' && !name.trim()) {
      setError('Por favor, informe seu nome.');
      return;
    }

    if (mode !== 'forgot' && password.length < 6) {
      setError('A senha deve conter no mínimo 6 caracteres.');
      return;
    }

    setIsSubmitting(true);

    try {
      if (mode === 'register') {
        await register(name.trim(), email.trim(), password);
        handleClose();
      } else if (mode === 'login') {
        await login(email.trim(), password);
        handleClose();
      } else if (mode === 'forgot') {
        await resetPassword(email.trim());
        setInfoMessage('E-mail de redefinição enviado com sucesso! Verifique sua caixa de entrada.');
      }
    } catch (err: any) {
      setError(err.message || 'Ocorreu um erro ao processar. Tente novamente.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGoogleLogin = async () => {
    setError(null);
    setIsSubmitting(true);
    try {
      await loginWithGoogle();
      handleClose();
    } catch (err: any) {
      setError(err.message || 'Erro ao realizar login com o Google.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xl flex items-center justify-center p-4 select-none"
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-modal-title"
    >
      <div className="w-full max-w-md glass-panel rounded-[32px] p-6 shadow-2xl border border-white/20 text-white space-y-6 relative">
        <button
          onClick={handleClose}
          className="absolute top-5 right-5 text-white/50 hover:text-white p-2 rounded-full glass-button transition-colors"
          disabled={isSubmitting}
          aria-label="Fechar janela de autenticação"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Brand & Logo */}
        <div className="text-center space-y-2">
          <div className="flex items-center justify-center gap-2">
            <img
              src="https://portalvipbrasil.com.br/wp-content/uploads/2026/08/Froc.Ia_.png"
              alt="Froc.IA Logo"
              referrerPolicy="no-referrer"
              className="h-10 w-auto object-contain filter drop-shadow"
            />
            <span id="auth-modal-title" className="text-2xl font-black tracking-tight text-white">Froc.IA</span>
          </div>
          <p className="text-xs text-white/60">
            {mode === 'register' && 'Crie sua conta real para salvar seus projetos'}
            {mode === 'login' && 'Acesse sua conta para continuar'}
            {mode === 'forgot' && 'Recupere o acesso à sua conta'}
          </p>
        </div>

        {/* Alert Messages */}
        {error && (
          <div className="p-3 rounded-xl bg-rose-500/20 border border-rose-500/40 text-rose-200 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
            <span>{error}</span>
          </div>
        )}

        {infoMessage && (
          <div className="p-3 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-200 text-xs">
            {infoMessage}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'register' && (
            <div>
              <label className="block text-xs font-semibold text-white/70 mb-1.5">Seu Nome</label>
              <div className="relative">
                <User className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-white/40" />
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Seu Nome Completo"
                  disabled={isSubmitting}
                  className="w-full glass-input rounded-2xl pl-10 pr-4 py-2.5 text-xs text-white placeholder-white/40 focus:outline-none"
                />
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-white/70 mb-1.5">E-mail</label>
            <div className="relative">
              <Mail className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-white/40" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="seuemail@exemplo.com"
                disabled={isSubmitting}
                className="w-full glass-input rounded-2xl pl-10 pr-4 py-2.5 text-xs text-white placeholder-white/40 focus:outline-none"
              />
            </div>
          </div>

          {mode !== 'forgot' && (
            <div>
              <div className="flex justify-between items-center mb-1.5">
                <label className="text-xs font-semibold text-white/70">Senha</label>
                {mode === 'login' && (
                  <button
                    type="button"
                    onClick={() => { setMode('forgot'); setError(null); }}
                    className="text-[11px] text-pink-300 hover:underline"
                  >
                    Esqueceu a senha?
                  </button>
                )}
              </div>
              <div className="relative">
                <Lock className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-white/40" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  disabled={isSubmitting}
                  className="w-full glass-input rounded-2xl pl-10 pr-10 py-2.5 text-xs text-white placeholder-white/40 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-white/40 hover:text-white transition-colors"
                  aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white font-extrabold text-xs shadow-lg flex items-center justify-center gap-2 transition-all disabled:opacity-50 cursor-pointer"
          >
            {isSubmitting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : mode === 'register' ? (
              <>
                <LogIn className="w-4 h-4" />
                <span>Criar Minha Conta</span>
              </>
            ) : mode === 'login' ? (
              <>
                <LogIn className="w-4 h-4" />
                <span>Entrar na Froc.IA</span>
              </>
            ) : (
              <>
                <KeyRound className="w-4 h-4" />
                <span>Enviar E-mail de Recuperação</span>
              </>
            )}
          </button>
        </form>

        {mode !== 'forgot' && (
          <>
            <div className="relative flex py-1 items-center">
              <div className="flex-grow border-t border-white/10"></div>
              <span className="flex-shrink mx-4 text-[10px] text-white/40 uppercase tracking-widest font-mono">ou</span>
              <div className="flex-grow border-t border-white/10"></div>
            </div>

            {/* Google Login */}
            <button
              onClick={handleGoogleLogin}
              disabled={isSubmitting}
              className="w-full py-3 rounded-2xl glass-button hover:bg-white/15 text-white font-bold text-xs flex items-center justify-center gap-2 transition-all disabled:opacity-50 cursor-pointer"
            >
              <span>Entrar com Conta Google</span>
            </button>
          </>
        )}

        {/* Toggle Register / Login / Forgot */}
        <div className="text-center text-xs text-white/60 pt-2 space-y-1">
          {mode === 'register' && (
            <p>
              Já tem uma conta?{' '}
              <button
                type="button"
                onClick={() => { setMode('login'); setError(null); }}
                className="text-pink-300 font-bold underline hover:text-white"
              >
                Fazer Login
              </button>
            </p>
          )}

          {mode === 'login' && (
            <p>
              Ainda não possui conta?{' '}
              <button
                type="button"
                onClick={() => { setMode('register'); setError(null); }}
                className="text-pink-300 font-bold underline hover:text-white"
              >
                Cadastre-se grátis
              </button>
            </p>
          )}

          {mode === 'forgot' && (
            <button
              type="button"
              onClick={() => { setMode('login'); setError(null); }}
              className="text-pink-300 font-bold underline hover:text-white"
            >
              Voltar ao Login
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
