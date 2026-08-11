import React, { useState, useEffect } from 'react';
import { X, Lock, Mail, User, LogIn, KeyRound, Loader2, AlertCircle, Eye, EyeOff, ShieldCheck, Check, Sparkles } from 'lucide-react';
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

  // Password strength logic
  const getPasswordStrength = (pwd: string) => {
    if (!pwd) return { score: 0, label: '', color: 'bg-white/10' };
    let score = 0;
    if (pwd.length >= 6) score += 1;
    if (pwd.length >= 8) score += 1;
    if (/[A-Z]/.test(pwd)) score += 1;
    if (/[0-9]/.test(pwd)) score += 1;
    if (/[^A-Za-z0-9]/.test(pwd)) score += 1;

    if (score <= 1) return { score: 1, label: 'Muito Fraca', color: 'bg-rose-500' };
    if (score === 2) return { score: 2, label: 'Fraca', color: 'bg-orange-500' };
    if (score === 3) return { score: 3, label: 'Média', color: 'bg-amber-400' };
    if (score === 4) return { score: 4, label: 'Forte', color: 'bg-emerald-400' };
    return { score: 5, label: 'Excelente', color: 'bg-cyan-400' };
  };

  const strength = getPasswordStrength(password);

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
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-2xl flex items-center justify-center p-4 select-none animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-modal-title"
    >
      <div className="w-full max-w-md glass-panel rounded-[32px] p-7 shadow-[0_16px_60px_rgba(0,0,0,0.6)] border border-white/15 text-white space-y-6 relative overflow-hidden">
        {/* Glow backdrop effects */}
        <div className="absolute -top-24 -left-24 w-48 h-48 bg-purple-600/30 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -right-24 w-48 h-48 bg-amber-400/20 rounded-full blur-3xl pointer-events-none" />

        <button
          onClick={handleClose}
          className="absolute top-5 right-5 text-white/50 hover:text-white p-2 rounded-full glass-button transition-all hover:scale-105"
          disabled={isSubmitting}
          aria-label="Fechar janela de autenticação"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Brand & Logo */}
        <div className="text-center space-y-2">
          <div className="flex items-center justify-center gap-2.5">
            <img
              src="https://portalvipbrasil.com.br/wp-content/uploads/2026/08/Froc.Ia_.png"
              alt="Froc.IA Logo"
              referrerPolicy="no-referrer"
              className="h-10 w-auto object-contain filter drop-shadow-[0_0_12px_rgba(251,191,36,0.3)]"
            />
            <span id="auth-modal-title" className="text-2xl font-black tracking-tight froc-gold-gradient-text">Froc.IA</span>
          </div>
          <p className="text-xs text-white/60 font-medium">
            {mode === 'register' && 'Crie sua conta na plataforma de IA de última geração'}
            {mode === 'login' && 'Acesse seu ecossistema inteligente de criação'}
            {mode === 'forgot' && 'Recupere o acesso à sua conta'}
          </p>
        </div>

        {/* Alert Messages */}
        {error && (
          <div className="p-3.5 rounded-2xl bg-rose-500/20 border border-rose-500/40 text-rose-200 text-xs flex items-center gap-2.5 animate-in fade-in">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
            <span className="leading-tight">{error}</span>
          </div>
        )}

        {infoMessage && (
          <div className="p-3.5 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-200 text-xs flex items-center gap-2.5 animate-in fade-in">
            <Check className="w-4 h-4 shrink-0 text-emerald-400" />
            <span className="leading-tight">{infoMessage}</span>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'register' && (
            <div>
              <label className="block text-xs font-semibold text-white/80 mb-1.5">Seu Nome</label>
              <div className="relative">
                <User className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-white/40" />
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Seu Nome Completo"
                  disabled={isSubmitting}
                  className="w-full glass-input rounded-2xl pl-10 pr-4 py-3 text-xs text-white placeholder-white/40 focus:outline-none focus:border-amber-400/50 transition-all"
                />
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-white/80 mb-1.5">E-mail</label>
            <div className="relative">
              <Mail className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-white/40" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="seuemail@exemplo.com"
                disabled={isSubmitting}
                className="w-full glass-input rounded-2xl pl-10 pr-4 py-3 text-xs text-white placeholder-white/40 focus:outline-none focus:border-amber-400/50 transition-all"
              />
            </div>
          </div>

          {mode !== 'forgot' && (
            <div>
              <div className="flex justify-between items-center mb-1.5">
                <label className="text-xs font-semibold text-white/80">Senha</label>
                {mode === 'login' && (
                  <button
                    type="button"
                    onClick={() => { setMode('forgot'); setError(null); }}
                    className="text-[11px] text-amber-300 hover:text-amber-200 hover:underline font-semibold transition-colors"
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
                  className="w-full glass-input rounded-2xl pl-10 pr-10 py-3 text-xs text-white placeholder-white/40 focus:outline-none focus:border-amber-400/50 transition-all"
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

              {/* Password Strength Meter for Register/Reset */}
              {mode === 'register' && password.length > 0 && (
                <div className="mt-2.5 space-y-1.5">
                  <div className="flex justify-between items-center text-[10px]">
                    <span className="text-white/50">Força da Senha:</span>
                    <span className="font-bold text-white/80">{strength.label}</span>
                  </div>
                  <div className="grid grid-cols-5 gap-1 h-1.5">
                    {[1, 2, 3, 4, 5].map((level) => (
                      <div
                        key={level}
                        className={`h-full rounded-full transition-all duration-300 ${
                          level <= strength.score ? strength.color : 'bg-white/10'
                        }`}
                      />
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-1 text-[10px] text-white/50 pt-1">
                    <span className={password.length >= 6 ? 'text-emerald-400 flex items-center gap-1' : ''}>
                      ✓ Mínimo 6 caracteres
                    </span>
                    <span className={/[A-Z]/.test(password) ? 'text-emerald-400 flex items-center gap-1' : ''}>
                      ✓ Letra maiúscula
                    </span>
                    <span className={/[0-9]/.test(password) ? 'text-emerald-400 flex items-center gap-1' : ''}>
                      ✓ Número
                    </span>
                    <span className={/[^A-Za-z0-9]/.test(password) ? 'text-emerald-400 flex items-center gap-1' : ''}>
                      ✓ Símbolo especial
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-3.5 rounded-2xl froc-gold-button font-black text-xs shadow-xl flex items-center justify-center gap-2 transition-all disabled:opacity-50 cursor-pointer active:scale-95"
          >
            {isSubmitting ? (
              <Loader2 className="w-4 h-4 animate-spin text-black" />
            ) : mode === 'register' ? (
              <>
                <LogIn className="w-4 h-4 text-black" />
                <span>Criar Minha Conta Grátis</span>
              </>
            ) : mode === 'login' ? (
              <>
                <LogIn className="w-4 h-4 text-black" />
                <span>Entrar na Froc.IA</span>
              </>
            ) : (
              <>
                <KeyRound className="w-4 h-4 text-black" />
                <span>Enviar E-mail de Recuperação</span>
              </>
            )}
          </button>
        </form>

        {mode !== 'forgot' && (
          <>
            <div className="relative flex py-1 items-center">
              <div className="flex-grow border-t border-white/10"></div>
              <span className="flex-shrink mx-4 text-[10px] text-white/40 uppercase tracking-widest font-mono">ou continuar com</span>
              <div className="flex-grow border-t border-white/10"></div>
            </div>

            {/* Google OAuth Login */}
            <button
              onClick={handleGoogleLogin}
              disabled={isSubmitting}
              className="w-full py-3 rounded-2xl glass-button hover:bg-white/15 text-white font-bold text-xs flex items-center justify-center gap-2.5 transition-all disabled:opacity-50 cursor-pointer"
            >
              <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
                <path
                  fill="#EA4335"
                  d="M12 5c1.6 0 3 .6 4.1 1.6l3.1-3.1C17.3 1.7 14.8 1 12 1 7.5 1 3.7 3.6 1.9 7.3l3.7 2.9C6.5 7.2 9 5 12 5z"
                />
                <path
                  fill="#4285F4"
                  d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5c-.3 1.5-1.1 2.8-2.4 3.7l3.7 2.9c2.2-2 3.7-5 3.7-8.8z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.6 14.8c-.2-.7-.4-1.5-.4-2.3s.2-1.6.4-2.3L1.9 7.3C.7 9.7 0 12.4 0 15.2s.7 5.5 1.9 7.9l3.7-2.9c-.6-1.6-1-3.3-1-5.4z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c3.2 0 6-1.1 8-3l-3.7-2.9c-1.1.7-2.5 1.2-4.3 1.2-3 0-5.5-2.2-6.4-5.2L1.9 16c1.8 3.7 5.6 7 10.1 7z"
                />
              </svg>
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
                className="text-amber-300 font-bold underline hover:text-white transition-colors"
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
                className="text-amber-300 font-bold underline hover:text-white transition-colors"
              >
                Cadastre-se grátis
              </button>
            </p>
          )}

          {mode === 'forgot' && (
            <button
              type="button"
              onClick={() => { setMode('login'); setError(null); }}
              className="text-amber-300 font-bold underline hover:text-white transition-colors"
            >
              Voltar ao Login
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

