import React, { useState, useRef, useEffect } from 'react';
import {
  User,
  LayoutDashboard,
  CreditCard,
  Sliders,
  LogOut,
  Sparkles,
  Zap,
  Moon,
  Sun,
  ShieldCheck,
  ChevronRight,
  Camera,
  Check
} from 'lucide-react';
import { UserProfile, AppNavigationMode } from '../types';

interface UserDropdownProps {
  user: UserProfile;
  setNavMode: (mode: AppNavigationMode) => void;
  onLogout?: () => void;
  onOpenAvatarModal?: () => void;
  onCloseDropdown: () => void;
}

export const UserDropdown: React.FC<UserDropdownProps> = ({
  user,
  setNavMode,
  onLogout,
  onOpenAvatarModal,
  onCloseDropdown,
}) => {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  const creditPercentage =
    user.creditsMax > 0
      ? Math.min(100, Math.max(0, (user.creditsRemaining / user.creditsMax) * 100))
      : 0;

  const toggleTheme = () => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
    if (nextTheme === 'light') {
      document.documentElement.classList.add('froc-light-mode');
    } else {
      document.documentElement.classList.remove('froc-light-mode');
    }
  };

  return (
    <div className="absolute right-0 top-12 z-50 w-80 rounded-3xl border border-white/15 bg-[#0a0a0c]/95 p-4 text-white shadow-[0_20px_50px_rgba(0,0,0,0.7)] backdrop-blur-2xl animate-in fade-in slide-in-from-top-2 duration-150">
      {/* Header Info */}
      <div className="flex items-center gap-3 border-b border-white/10 pb-4">
        <div className="relative group shrink-0">
          {user.avatarUrl ? (
            <img
              src={user.avatarUrl}
              alt={user.name}
              referrerPolicy="no-referrer"
              className="h-12 w-12 rounded-full object-cover border-2 border-amber-300/60 shadow-lg"
            />
          ) : (
            <div className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-amber-300/60 bg-gradient-to-br from-amber-200 via-amber-400 to-amber-700 text-base font-black text-black shadow-lg">
              {user.name.trim().charAt(0).toUpperCase() || 'U'}
            </div>
          )}

          {onOpenAvatarModal && (
            <button
              type="button"
              onClick={() => {
                onCloseDropdown();
                onOpenAvatarModal();
              }}
              className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full bg-amber-400 text-slate-950 shadow hover:scale-110 transition-transform"
              title="Alterar foto de perfil"
            >
              <Camera className="h-3 w-3" />
            </button>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-1">
            <h4 className="truncate text-sm font-black text-white">{user.name}</h4>
            <span className="shrink-0 rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[9px] font-extrabold text-amber-300">
              {user.plan || 'PRO'}
            </span>
          </div>
          <p className="truncate text-xs text-white/50">{user.email}</p>
        </div>
      </div>

      {/* Credit / Token consumption bar */}
      <div className="my-3 rounded-2xl border border-white/8 bg-white/[0.03] p-3 space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="flex items-center gap-1.5 font-bold text-amber-300 text-[11px]">
            <Zap className="h-3.5 w-3.5 fill-amber-300 text-amber-300" />
            <span>Créditos Froc.IA</span>
          </span>
          <span className="font-extrabold text-white text-[11px]">
            {user.creditsRemaining} <span className="text-white/40 font-normal">/ {user.creditsMax}</span>
          </span>
        </div>

        <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-gradient-to-r from-amber-500 via-amber-300 to-yellow-100 transition-[width] duration-500"
            style={{ width: `${creditPercentage}%` }}
          />
        </div>

        <button
          type="button"
          onClick={() => {
            onCloseDropdown();
            setNavMode('pricing');
          }}
          className="w-full text-center text-[10px] font-bold text-amber-300 hover:text-amber-200 transition-colors pt-0.5"
        >
          + Comprar mais créditos via Pix
        </button>
      </div>

      {/* Navigation Items */}
      <div className="space-y-1 pt-1">
        <button
          type="button"
          onClick={() => {
            onCloseDropdown();
            setNavMode('dashboard');
          }}
          className="flex w-full items-center justify-between rounded-xl p-2.5 text-xs font-semibold text-white/80 hover:bg-white/10 hover:text-white transition-all"
        >
          <span className="flex items-center gap-2.5">
            <User className="h-4 w-4 text-amber-300" />
            <span>Meu Perfil & Configurações</span>
          </span>
          <ChevronRight className="h-3.5 w-3.5 text-white/30" />
        </button>

        <button
          type="button"
          onClick={() => {
            onCloseDropdown();
            setNavMode('dashboard');
          }}
          className="flex w-full items-center justify-between rounded-xl p-2.5 text-xs font-semibold text-white/80 hover:bg-white/10 hover:text-white transition-all"
        >
          <span className="flex items-center gap-2.5">
            <LayoutDashboard className="h-4 w-4 text-purple-400" />
            <span>Meus Projetos</span>
          </span>
          <ChevronRight className="h-3.5 w-3.5 text-white/30" />
        </button>

        <button
          type="button"
          onClick={() => {
            onCloseDropdown();
            setNavMode('pricing');
          }}
          className="flex w-full items-center justify-between rounded-xl p-2.5 text-xs font-semibold text-white/80 hover:bg-white/10 hover:text-white transition-all"
        >
          <span className="flex items-center gap-2.5">
            <CreditCard className="h-4 w-4 text-emerald-400" />
            <span>Planos & Recargas</span>
          </span>
          <ChevronRight className="h-3.5 w-3.5 text-white/30" />
        </button>

        <button
          type="button"
          onClick={() => {
            onCloseDropdown();
            setNavMode('integrations');
          }}
          className="flex w-full items-center justify-between rounded-xl p-2.5 text-xs font-semibold text-white/80 hover:bg-white/10 hover:text-white transition-all"
        >
          <span className="flex items-center gap-2.5">
            <Sliders className="h-4 w-4 text-cyan-400" />
            <span>Integrações & Chaves API</span>
          </span>
          <ChevronRight className="h-3.5 w-3.5 text-white/30" />
        </button>

        {/* Theme Toggle */}
        <button
          type="button"
          onClick={toggleTheme}
          className="flex w-full items-center justify-between rounded-xl p-2.5 text-xs font-semibold text-white/80 hover:bg-white/10 hover:text-white transition-all"
        >
          <span className="flex items-center gap-2.5">
            {theme === 'dark' ? (
              <Moon className="h-4 w-4 text-indigo-400" />
            ) : (
              <Sun className="h-4 w-4 text-amber-400" />
            )}
            <span>Modo {theme === 'dark' ? 'Escuro' : 'Claro'}</span>
          </span>
          <span className="text-[10px] font-bold text-white/40 uppercase tracking-widest">
            {theme}
          </span>
        </button>

        {user.role === 'admin' && (
          <button
            type="button"
            onClick={() => {
              onCloseDropdown();
              setNavMode('admin');
            }}
            className="flex w-full items-center justify-between rounded-xl p-2.5 text-xs font-semibold text-amber-300 hover:bg-amber-400/10 transition-all"
          >
            <span className="flex items-center gap-2.5">
              <ShieldCheck className="h-4 w-4 text-amber-400" />
              <span>Painel de Administração</span>
            </span>
            <ChevronRight className="h-3.5 w-3.5 text-amber-400/50" />
          </button>
        )}
      </div>

      {/* Logout */}
      {onLogout && (
        <div className="mt-3 pt-2 border-t border-white/10">
          <button
            type="button"
            onClick={() => {
              onCloseDropdown();
              onLogout();
            }}
            className="flex w-full items-center gap-2.5 rounded-xl p-2.5 text-xs font-extrabold text-rose-300 hover:bg-rose-500/20 hover:text-rose-200 transition-all"
          >
            <LogOut className="h-4 w-4" />
            <span>Sair da Conta</span>
          </button>
        </div>
      )}
    </div>
  );
};
