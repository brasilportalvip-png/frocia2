import React, { useState, useRef, useEffect } from 'react';
import {
  Code2,
  Columns,
  Cpu,
  CreditCard,
  Download,
  Eye,
  ChevronDown,
  LayoutDashboard,
  LogOut,
  Maximize2,
  Menu,
  Monitor,
  Plus,
  ShieldCheck,
  Sliders,
  Smartphone,
  Sparkles,
  Tablet,
  User,
  Zap
} from 'lucide-react';
import {
  AppNavigationMode,
  DeviceView,
  UserProfile,
  ViewMode
} from '../types';
import { UserDropdown } from './UserDropdown';
import { AvatarUploadModal } from './AvatarUploadModal';
import { ModelSelectorModal } from './ModelSelectorModal';
import { MemoryManagerModal } from './MemoryManagerModal';

const FROC_LOGO_URL =
  'https://portalvipbrasil.com.br/wp-content/uploads/2026/08/frocialogo-removebg-preview.png';

interface HeaderProps {
  navMode: AppNavigationMode;
  setNavMode: (mode: AppNavigationMode) => void;
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  deviceView: DeviceView;
  setDeviceView: (device: DeviceView) => void;
  onNewSite: () => void;
  onExport: () => void;
  onOpenFullscreen: () => void;
  selectedModel: string;
  setSelectedModel: (model: string) => void;
  hasActiveSite: boolean;
  siteTitle?: string;
  user: UserProfile;
  onOpenAuth: () => void;
  onLogout?: () => void;
  onToggleMobileMenu?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  navMode,
  setNavMode,
  viewMode,
  setViewMode,
  deviceView,
  setDeviceView,
  onNewSite,
  onExport,
  onOpenFullscreen,
  selectedModel,
  setSelectedModel,
  hasActiveSite,
  siteTitle,
  user,
  onOpenAuth,
  onLogout,
  onToggleMobileMenu
}) => {
  const [logoFailed, setLogoFailed] = useState(false);
  const [isUserDropdownOpen, setIsUserDropdownOpen] = useState(false);
  const [isAvatarModalOpen, setIsAvatarModalOpen] = useState(false);
  const [isModelModalOpen, setIsModelModalOpen] = useState(false);
  const [isMemoryManagerOpen, setIsMemoryManagerOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsUserDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const creditPercentage =
    user.creditsMax > 0
      ? Math.min(
          100,
          Math.max(
            0,
            (user.creditsRemaining / user.creditsMax) *
              100
          )
        )
      : 0;

  return (
    <header
      id="froc-header"
      className="relative z-40 flex h-16 shrink-0 select-none items-center justify-between border-b border-white/[0.07] bg-[#060606]/96 px-3 text-white shadow-[0_8px_35px_rgba(0,0,0,0.24)] backdrop-blur-2xl sm:px-4 lg:px-6"
    >
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-amber-300/20 to-transparent" />

      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
        {onToggleMobileMenu && (
          <button
            type="button"
            onClick={onToggleMobileMenu}
            className="glass-button flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-amber-300 hover:text-white lg:hidden"
            aria-label="Abrir menu de navegação"
            title="Abrir menu"
          >
            <Menu className="h-5 w-5" />
          </button>
        )}

        <button
          type="button"
          onClick={() => setNavMode('studio')}
          className="group flex shrink-0 items-center gap-2.5 rounded-xl"
          title="Ir para o início"
        >
          <span className="relative flex h-10 w-10 items-center justify-center">
            <span
              aria-hidden="true"
              className="absolute inset-1 rounded-full bg-amber-300/10 blur-lg transition-opacity group-hover:opacity-100"
            />

            {!logoFailed ? (
              <img
                src={FROC_LOGO_URL}
                alt="Froc.IA"
                referrerPolicy="no-referrer"
                draggable={false}
                onError={() => setLogoFailed(true)}
                className="froc-avatar-glow relative h-10 w-10 object-contain"
              />
            ) : (
              <span className="froc-gold-button relative flex h-9 w-9 items-center justify-center rounded-xl text-sm font-black">
                F
              </span>
            )}
          </span>

          <span className="hidden flex-col text-left sm:flex">
            <span className="froc-gold-gradient-text text-base font-black leading-none tracking-tight">
              Froc.IA
            </span>
            <span className="mt-1 text-[8px] uppercase tracking-[0.16em] text-white/32">
              Inteligência artificial
            </span>
          </span>
        </button>

        <span className="hidden h-6 w-px bg-white/10 sm:block" />

        {navMode === 'studio' ? (
          <div className="flex min-w-0 items-center gap-2">
            <Sparkles className="h-4 w-4 shrink-0 text-amber-300" />

            <span className="max-w-[150px] truncate text-xs font-semibold text-white/72 md:max-w-[240px]">
              {siteTitle || 'Nova conversa'}
            </span>

            <button
              type="button"
              onClick={onNewSite}
              disabled={!hasActiveSite}
              className="glass-button hidden rounded-lg p-1.5 disabled:cursor-not-allowed disabled:opacity-35 sm:flex"
              title="Novo projeto"
            >
              <Plus className="h-3.5 w-3.5 text-amber-300" />
            </button>
          </div>
        ) : (
          <nav className="hidden items-center gap-1 lg:flex">
            

            <NavigationButton
              label="Froc.IA"
              icon={Sparkles}
              active={false}
              onClick={() => setNavMode('studio')}
            />

            <NavigationButton
              label="Projetos"
              icon={LayoutDashboard}
              active={navMode === 'dashboard'}
              onClick={() => setNavMode('dashboard')}
            />

            <NavigationButton
              label="Planos"
              icon={CreditCard}
              active={navMode === 'pricing'}
              onClick={() => setNavMode('pricing')}
            />

            <NavigationButton
              label="Integrações"
              icon={Sliders}
              active={navMode === 'integrations'}
              onClick={() => setNavMode('integrations')}
            />

            {user.role === 'admin' && (
              <NavigationButton
                label="Administração"
                icon={ShieldCheck}
                active={navMode === 'admin'}
                onClick={() => setNavMode('admin')}
              />
            )}
          </nav>
        )}
      </div>

      {navMode === 'studio' && (
        <div className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-1 rounded-xl border border-white/8 bg-white/[0.035] p-1 xl:flex">
          {viewMode !== 'code' && (
            <div className="mr-1 flex items-center gap-0.5 border-r border-white/10 pr-1">
              <IconControl
                label="Desktop"
                icon={Monitor}
                active={deviceView === 'desktop'}
                onClick={() =>
                  setDeviceView('desktop')
                }
              />

              <IconControl
                label="Tablet"
                icon={Tablet}
                active={deviceView === 'tablet'}
                onClick={() =>
                  setDeviceView('tablet')
                }
              />

              <IconControl
                label="Celular"
                icon={Smartphone}
                active={deviceView === 'mobile'}
                onClick={() =>
                  setDeviceView('mobile')
                }
              />
            </div>
          )}

          <ViewControl
            label="Prévia"
            icon={Eye}
            active={viewMode === 'preview'}
            onClick={() => setViewMode('preview')}
          />

          <ViewControl
            label="Dividido"
            icon={Columns}
            active={viewMode === 'split'}
            onClick={() => setViewMode('split')}
          />

          <ViewControl
            label="Código"
            icon={Code2}
            active={viewMode === 'code'}
            onClick={() => setViewMode('code')}
          />
        </div>
      )}

      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={() => setNavMode('pricing')}
          className="glass-button hidden items-center gap-2 rounded-full px-3 py-1.5 sm:flex"
          title="Ver planos e créditos"
        >
          <Zap className="h-3.5 w-3.5 fill-amber-300 text-amber-300" />

          <span className="text-[10px] font-bold text-white/75">
            {user.creditsRemaining}
          </span>

          <span className="hidden text-[9px] text-white/35 md:inline">
            / {user.creditsMax}
          </span>

          <span className="hidden h-1.5 w-12 overflow-hidden rounded-full bg-white/10 md:block">
            <span
              className="block h-full rounded-full bg-gradient-to-r from-amber-600 via-amber-300 to-yellow-100 transition-[width] duration-500"
              style={{
                width: `${creditPercentage}%`
              }}
            />
          </span>
        </button>

        <button
          type="button"
          onClick={() => setIsModelModalOpen(true)}
          className="hidden items-center gap-1.5 rounded-full border border-amber-400/20 bg-amber-400/10 px-3 py-1.5 hover:bg-amber-400/20 transition-all sm:flex"
          title="Alternar Modelo de Inteligência Artificial"
        >
          <Cpu className="h-3.5 w-3.5 text-amber-300 shrink-0" />
          <span className="text-[10px] font-bold text-white/90">
            {selectedModel === 'gemini-3.6-flash' ? 'Gemini Flash' : selectedModel === 'gemini-3.1-pro-preview' ? 'Gemini Pro' : 'Froc.IA Ultra'}
          </span>
          <ChevronDown className="h-3 w-3 text-amber-300/70 shrink-0" />
        </button>

        {navMode === 'studio' && hasActiveSite && (
          <>
            <button
              type="button"
              onClick={onOpenFullscreen}
              className="glass-button hidden rounded-xl p-2.5 lg:flex"
              title="Abrir em tela cheia"
            >
              <Maximize2 className="h-4 w-4" />
            </button>

            <button
              type="button"
              onClick={onExport}
              className="froc-gold-button flex items-center gap-1.5 rounded-xl px-3 py-2 text-[10px] font-black"
            >
              <Download className="h-3.5 w-3.5 text-black" />
              <span className="hidden sm:inline">
                Exportar
              </span>
            </button>
          </>
        )}

        {user.isAuthenticated ? (
          <div className="relative" ref={dropdownRef}>
            <button
              type="button"
              onClick={() => setIsUserDropdownOpen(!isUserDropdownOpen)}
              className="glass-button flex items-center gap-2 rounded-full p-1 pl-2.5 hover:border-amber-400/50 transition-all cursor-pointer"
              title="Menu do Usuário Froc.IA"
            >
              <span className="hidden max-w-24 truncate text-[10px] font-extrabold text-white/80 sm:inline">
                {user.name.split(' ')[0]}
              </span>

              {user.avatarUrl ? (
                <img
                  src={user.avatarUrl}
                  alt={user.name}
                  referrerPolicy="no-referrer"
                  className="h-7 w-7 rounded-full object-cover border-2 border-amber-300/60 shadow"
                />
              ) : (
                <span className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-amber-300/60 bg-gradient-to-br from-amber-200 via-amber-400 to-amber-700 text-xs font-black text-black shadow">
                  {user.name
                    .trim()
                    .charAt(0)
                    .toUpperCase() || 'U'}
                </span>
              )}
            </button>

            {/* Dropdown Menu */}
            {isUserDropdownOpen && (
              <UserDropdown
                user={user}
                setNavMode={setNavMode}
                onLogout={onLogout}
                onOpenAvatarModal={() => setIsAvatarModalOpen(true)}
                onOpenMemoryManager={() => setIsMemoryManagerOpen(true)}
                onCloseDropdown={() => setIsUserDropdownOpen(false)}
              />
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={onOpenAuth}
            className="froc-gold-button flex items-center gap-1.5 rounded-xl px-3 py-2 text-[10px] font-black cursor-pointer"
          >
            <User className="h-3.5 w-3.5 text-black" />
            <span>Entrar</span>
          </button>
        )}
      </div>

      {/* Avatar Upload Modal */}
      <AvatarUploadModal
        isOpen={isAvatarModalOpen}
        onClose={() => setIsAvatarModalOpen(false)}
        user={user}
      />

      {/* Model Selector Modal */}
      <ModelSelectorModal
        isOpen={isModelModalOpen}
        onClose={() => setIsModelModalOpen(false)}
        selectedModel={selectedModel}
        onSelectModel={setSelectedModel}
      />

      <MemoryManagerModal
        isOpen={isMemoryManagerOpen}
        onClose={() => setIsMemoryManagerOpen(false)}
      />
    </header>
  );
};

interface NavigationButtonProps {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  active: boolean;
  onClick: () => void;
}

const NavigationButton: React.FC<
  NavigationButtonProps
> = ({
  label,
  icon: Icon,
  active,
  onClick
}) => {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 text-[10px] font-bold transition-all ${
        active
          ? 'froc-menu-active'
          : 'border-transparent text-white/48 hover:bg-white/5 hover:text-white'
      }`}
    >
      <Icon
        className={`h-3.5 w-3.5 ${
          active ? 'text-amber-300' : ''
        }`}
      />
      <span>{label}</span>
    </button>
  );
};

interface IconControlProps {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  active: boolean;
  onClick: () => void;
}

const IconControl: React.FC<IconControlProps> = ({
  label,
  icon: Icon,
  active,
  onClick
}) => {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`rounded-lg p-1.5 transition-all ${
        active
          ? 'bg-amber-300/15 text-amber-300'
          : 'text-white/35 hover:bg-white/5 hover:text-white'
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
};

interface ViewControlProps
  extends IconControlProps {}

const ViewControl: React.FC<ViewControlProps> = ({
  label,
  icon: Icon,
  active,
  onClick
}) => {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1 rounded-lg px-2 py-1.5 text-[9px] font-bold transition-all ${
        active
          ? 'bg-amber-300/15 text-amber-200'
          : 'text-white/38 hover:bg-white/5 hover:text-white'
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
      <span>{label}</span>
    </button>
  );
};
