import React, { useState } from 'react';
import {
  FolderOpen,
  Plus,
  Search,
  Star,
  Trash2,
  ExternalLink,
  Calendar,
  Sparkles,
  Zap,
  User,
  Shield,
  CreditCard,
  Mail,
  CheckCircle,
  AlertCircle,
  Save,
  Loader2,
  LogOut
} from 'lucide-react';
import { GeneratedSite, UserProfile } from '../types';
import { apiClient } from '../services/apiClient';
import { useAuth } from '../context/AuthContext';

interface DashboardProps {
  savedSites: GeneratedSite[];
  onSelectSite: (site: GeneratedSite) => void;
  onNewSite: () => void;
  onDeleteSite: (siteId: string) => void;
  onToggleFavorite: (siteId: string) => void;
  user: UserProfile;
  onNavigateToPricing: () => void;
  onRefreshProfile?: () => Promise<void>;
  onLogout?: () => void;
}

export const Dashboard: React.FC<DashboardProps> = ({
  savedSites,
  onSelectSite,
  onNewSite,
  onDeleteSite,
  onToggleFavorite,
  user,
  onNavigateToPricing,
  onRefreshProfile,
  onLogout
}) => {
  const { sendVerificationEmail, updateUserProfile, profileError } = useAuth();
  const [activeTab, setActiveTab] = useState<'projects' | 'profile'>('projects');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('todos');
  const [showOnlyFavorites, setShowOnlyFavorites] = useState(false);

  // Profile Edit State
  const [displayName, setDisplayName] = useState(user.name);
  const [avatarUrl, setAvatarUrl] = useState(user.avatarUrl || '');
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isSendingVerification, setIsSendingVerification] = useState(false);
  const [profileSuccessMsg, setProfileSuccessMsg] = useState<string | null>(null);
  const [profileErrorMsg, setProfileErrorMsg] = useState<string | null>(null);
  const [avatarLoadError, setAvatarLoadError] = useState(false);

  const categories = ['todos', 'Software / Tecnologia', 'Gastronomia & Restaurantes', 'Portfólio Pessoal', 'E-commerce', 'Sistema'];

  const filteredSites = savedSites.filter((site) => {
    const matchesSearch = site.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          site.description.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = selectedCategory === 'todos' || site.category === selectedCategory;
    const matchesFavorite = !showOnlyFavorites || site.isFavorite;
    return matchesSearch && matchesCategory && matchesFavorite;
  });

  const handleResendVerification = async () => {
    setIsSendingVerification(true);
    setProfileSuccessMsg(null);
    setProfileErrorMsg(null);
    try {
      await sendVerificationEmail();
      setProfileSuccessMsg('E-mail de verificação enviado com sucesso! Verifique sua caixa de entrada.');
    } catch (err: any) {
      setProfileErrorMsg(err.message || 'Erro ao enviar e-mail de verificação.');
    } finally {
      setIsSendingVerification(false);
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingProfile(true);
    setProfileSuccessMsg(null);
    setProfileErrorMsg(null);

    const cleanName = displayName.replace(/[\x00-\x1F\x7F]/g, '').trim();
    if (cleanName.length < 2 || cleanName.length > 80) {
      setProfileErrorMsg('O nome deve conter entre 2 e 80 caracteres.');
      setIsSavingProfile(false);
      return;
    }

    const cleanAvatar = avatarUrl.trim();
    if (cleanAvatar && (!cleanAvatar.startsWith('https://') || cleanAvatar.length > 2048)) {
      setProfileErrorMsg('A URL do avatar deve começar com https:// e ter no máximo 2048 caracteres.');
      setIsSavingProfile(false);
      return;
    }

    try {
      await updateUserProfile(cleanName, cleanAvatar);
      setProfileSuccessMsg('Perfil atualizado com sucesso!');
      setAvatarLoadError(false);
    } catch (err: any) {
      setProfileErrorMsg(err.message || 'Erro ao salvar alterações no perfil.');
    } finally {
      setIsSavingProfile(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto bg-slate-950 text-white p-6 md:p-8 custom-scrollbar">
      <div className="max-w-7xl mx-auto space-y-8">
        {profileError && (
          <div className="p-4 rounded-2xl bg-amber-500/20 border border-amber-500/40 text-amber-200 text-xs flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
              <span>{profileError}</span>
            </div>
            {onRefreshProfile && (
              <button
                type="button"
                onClick={() => onRefreshProfile()}
                className="px-3 py-1.5 rounded-xl bg-amber-400/20 hover:bg-amber-400/30 text-amber-300 font-bold"
              >
                Tentar novamente
              </button>
            )}
          </div>
        )}

        {/* Navigation Tabs Header */}
        <div className="flex items-center justify-between border-b border-white/10 pb-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setActiveTab('projects')}
              className={`flex items-center gap-2 px-4 py-2 rounded-2xl text-xs font-bold transition-all ${
                activeTab === 'projects'
                  ? 'bg-purple-600 text-white shadow-lg'
                  : 'glass-button text-white/60 hover:text-white'
              }`}
            >
              <FolderOpen className="w-4 h-4 text-pink-400" />
              <span>Meus Projetos ({savedSites.length})</span>
            </button>

            <button
              onClick={() => setActiveTab('profile')}
              className={`flex items-center gap-2 px-4 py-2 rounded-2xl text-xs font-bold transition-all ${
                activeTab === 'profile'
                  ? 'bg-purple-600 text-white shadow-lg'
                  : 'glass-button text-white/60 hover:text-white'
              }`}
            >
              <User className="w-4 h-4 text-amber-300" />
              <span>Meu Perfil & Configurações</span>
            </button>
          </div>

          <div
            onClick={onNavigateToPricing}
            className="glass-panel px-4 py-2 rounded-2xl flex items-center gap-3 cursor-pointer hover:border-amber-400/50 transition-all"
          >
            <Zap className="w-4 h-4 text-amber-400" />
            <div className="text-left">
              <div className="text-xs font-bold text-white">{user.creditsRemaining} Créditos</div>
              <div className="text-[10px] text-white/50">Recarregar via Pix</div>
            </div>
          </div>
        </div>

        {activeTab === 'profile' ? (
          /* Profile & Account View */
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {/* User Overview Card */}
            <div className="md:col-span-1 glass-panel p-6 rounded-[32px] border border-white/10 space-y-6 text-center">
              <div className="relative inline-block mx-auto">
                {user.avatarUrl && !avatarLoadError ? (
                  <img
                    src={user.avatarUrl}
                    alt={user.name}
                    referrerPolicy="no-referrer"
                    onError={() => setAvatarLoadError(true)}
                    className="w-24 h-24 rounded-full object-cover border-2 border-amber-300/50 mx-auto shadow-xl"
                  />
                ) : (
                  <div className="w-24 h-24 rounded-full bg-gradient-to-br from-amber-200 via-amber-400 to-amber-700 border-2 border-amber-300/50 flex items-center justify-center text-3xl font-black text-black mx-auto shadow-xl">
                    {user.name.trim().charAt(0).toUpperCase() || 'U'}
                  </div>
                )}
              </div>

              <div>
                <h2 className="text-xl font-bold text-white">{user.name}</h2>
                <p className="text-xs text-white/60 flex items-center justify-center gap-1.5 mt-1">
                  <Mail className="w-3.5 h-3.5" />
                  <span>{user.email}</span>
                </p>
              </div>

              <div className="pt-4 border-t border-white/10 space-y-3 text-left">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-white/60">Plano Atual:</span>
                  <span className="font-extrabold text-amber-300 px-2.5 py-1 bg-amber-400/10 rounded-full border border-amber-400/20">
                    {user.plan || 'Inicial'}
                  </span>
                </div>

                <div className="flex justify-between items-center text-xs">
                  <span className="text-white/60">Saldo Disponível:</span>
                  <span className="font-bold text-emerald-400">{user.creditsRemaining} créditos</span>
                </div>

                <div className="flex justify-between items-start text-xs">
                  <span className="text-white/60 pt-0.5">E-mail:</span>
                  {user.emailVerified ? (
                    <span className="font-semibold text-emerald-400 flex items-center gap-1">
                      <CheckCircle className="w-3.5 h-3.5" /> E-mail verificado
                    </span>
                  ) : (
                    <div className="flex flex-col items-end gap-1">
                      <span className="font-semibold text-amber-400 flex items-center gap-1">
                        <AlertCircle className="w-3.5 h-3.5" /> E-mail não verificado
                      </span>
                      <button
                        type="button"
                        onClick={handleResendVerification}
                        disabled={isSendingVerification}
                        className="text-[10px] text-amber-300 hover:underline flex items-center gap-1 mt-1"
                      >
                        {isSendingVerification ? <Loader2 className="w-3 h-3 animate-spin" /> : <Mail className="w-3 h-3" />}
                        <span>Reenviar e-mail de verificação</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <button
                type="button"
                onClick={onNavigateToPricing}
                className="w-full py-3 rounded-2xl bg-gradient-to-r from-amber-400 to-amber-600 hover:from-amber-300 hover:to-amber-500 text-slate-950 font-black text-xs shadow-lg flex items-center justify-center gap-2 cursor-pointer"
              >
                <Zap className="w-4 h-4 fill-current" />
                <span>Comprar Mais Créditos</span>
              </button>

              {onLogout && (
                <button
                  type="button"
                  onClick={onLogout}
                  className="w-full py-2.5 rounded-2xl glass-button hover:bg-rose-500/20 hover:text-rose-200 text-xs text-white/60 font-semibold flex items-center justify-center gap-2 cursor-pointer transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                  <span>Sair da Conta</span>
                </button>
              )}
            </div>

            {/* Profile Edit Form */}
            <div className="md:col-span-2 glass-panel p-6 rounded-[32px] border border-white/10 space-y-6">
              <div className="border-b border-white/10 pb-4">
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                  <User className="w-5 h-5 text-purple-400" />
                  <span>Editar Perfil</span>
                </h2>
                <p className="text-xs text-white/60 mt-1">
                  Atualize seu nome de exibição e avatar pessoal.
                </p>
              </div>

              {profileSuccessMsg && (
                <div className="p-3 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-200 text-xs">
                  {profileSuccessMsg}
                </div>
              )}

              {profileErrorMsg && (
                <div className="p-3 rounded-xl bg-rose-500/20 border border-rose-500/40 text-rose-200 text-xs">
                  {profileErrorMsg}
                </div>
              )}

              <form onSubmit={handleSaveProfile} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-white/70 mb-1.5">Nome de Exibição</label>
                  <input
                    type="text"
                    required
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Seu nome no sistema"
                    disabled={isSavingProfile}
                    className="w-full glass-input rounded-2xl px-4 py-2.5 text-xs text-white placeholder-white/40 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-white/70 mb-1.5">URL da Foto de Perfil (Opcional - https://...)</label>
                  <input
                    type="url"
                    value={avatarUrl}
                    onChange={(e) => setAvatarUrl(e.target.value)}
                    placeholder="https://exemplo.com/sua-foto.jpg"
                    disabled={isSavingProfile}
                    className="w-full glass-input rounded-2xl px-4 py-2.5 text-xs text-white placeholder-white/40 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-white/70 mb-1.5">Endereço de E-mail (Somente leitura)</label>
                  <input
                    type="email"
                    disabled
                    value={user.email}
                    className="w-full glass-input opacity-50 cursor-not-allowed rounded-2xl px-4 py-2.5 text-xs text-white/60"
                  />
                </div>

                <div className="pt-4 border-t border-white/10 flex justify-end">
                  <button
                    type="submit"
                    disabled={isSavingProfile}
                    className="px-6 py-3 rounded-2xl bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white font-extrabold text-xs shadow-lg flex items-center gap-2 cursor-pointer disabled:opacity-50"
                  >
                    {isSavingProfile ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <>
                        <Save className="w-4 h-4" />
                        <span>Salvar Alterações</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        ) : (
          /* Projects List View */
          <>
            {/* Filter Controls Bar */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
              {/* Search Input */}
              <div className="relative w-full sm:w-80">
                <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-white/40" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Buscar por nome do projeto..."
                  className="w-full glass-input rounded-xl pl-10 pr-4 py-2 text-xs text-white placeholder-white/40 focus:outline-none"
                />
              </div>

              {/* Category Chips */}
              <div className="flex items-center gap-2 overflow-x-auto w-full sm:w-auto custom-scrollbar pb-1">
                <button
                  onClick={() => setShowOnlyFavorites(!showOnlyFavorites)}
                  className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all flex items-center gap-1.5 shrink-0 ${
                    showOnlyFavorites ? 'bg-amber-500 text-slate-950' : 'glass-button text-white/70'
                  }`}
                >
                  <Star className="w-3.5 h-3.5 fill-current" />
                  <span>Favoritos</span>
                </button>

                {categories.map((cat) => (
                  <button
                    key={cat}
                    onClick={() => setSelectedCategory(cat)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium capitalize transition-all shrink-0 ${
                      selectedCategory === cat ? 'bg-purple-600 text-white font-semibold' : 'glass-button text-white/60'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>

            {/* Projects Grid */}
            {filteredSites.length === 0 ? (
              <div className="p-12 text-center rounded-[32px] glass-panel border border-white/10 space-y-4 max-w-md mx-auto my-12">
                <Sparkles className="w-12 h-12 text-pink-400 mx-auto animate-pulse" />
                <h3 className="text-xl font-bold text-white">Nenhum projeto encontrado</h3>
                <p className="text-xs text-white/60">
                  Não encontramos projetos com estes filtros. Que tal criar uma nova ideia agora?
                </p>
                <button
                  onClick={onNewSite}
                  className="px-5 py-2.5 rounded-xl bg-purple-600 text-white font-bold text-xs shadow-lg"
                >
                  Criar Novo Projeto
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {filteredSites.map((site) => (
                  <div
                    key={site.id}
                    className="p-6 rounded-[28px] glass-panel border border-white/10 hover:border-pink-500/40 transition-all flex flex-col justify-between space-y-4 group relative"
                  >
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="px-3 py-1 rounded-full bg-purple-500/20 text-purple-300 text-[10px] font-bold border border-purple-500/30">
                          {site.category || 'Geral'}
                        </span>
                        <button
                          onClick={() => onToggleFavorite(site.id)}
                          className={`p-1.5 rounded-full hover:bg-white/10 transition-colors ${
                            site.isFavorite ? 'text-amber-400' : 'text-white/30'
                          }`}
                          title="Favoritar Projeto"
                        >
                          <Star className="w-4 h-4 fill-current" />
                        </button>
                      </div>

                      <h3 className="text-xl font-bold text-white group-hover:text-pink-300 transition-colors">
                        {site.title}
                      </h3>
                      <p className="text-xs text-white/60 leading-relaxed line-clamp-2">
                        {site.description}
                      </p>
                    </div>

                    <div className="pt-4 border-t border-white/10 flex items-center justify-between">
                      <div className="flex items-center gap-1 text-[10px] text-white/40">
                        <Calendar className="w-3 h-3" />
                        <span>{new Date(site.updatedAt).toLocaleDateString('pt-BR')}</span>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => onDeleteSite(site.id)}
                          className="p-2 rounded-xl text-white/40 hover:text-red-400 hover:bg-white/5 transition-colors"
                          title="Excluir Projeto"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>

                        <button
                          onClick={() => onSelectSite(site)}
                          className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs shadow-md flex items-center gap-1.5 transition-all"
                        >
                          <span>Abrir Studio</span>
                          <ExternalLink className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
