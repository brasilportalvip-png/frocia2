import React, { useState } from 'react';
import {
  FolderOpen,
  Plus,
  Search,
  Star,
  Archive,
  Trash2,
  ExternalLink,
  Code2,
  Calendar,
  Sparkles,
  Zap,
  Download,
  Filter
} from 'lucide-react';
import { GeneratedSite, UserProfile } from '../types';

interface DashboardProps {
  savedSites: GeneratedSite[];
  onSelectSite: (site: GeneratedSite) => void;
  onNewSite: () => void;
  onDeleteSite: (siteId: string) => void;
  onToggleFavorite: (siteId: string) => void;
  user: UserProfile;
  onNavigateToPricing: () => void;
}

export const Dashboard: React.FC<DashboardProps> = ({
  savedSites,
  onSelectSite,
  onNewSite,
  onDeleteSite,
  onToggleFavorite,
  user,
  onNavigateToPricing
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('todos');
  const [showOnlyFavorites, setShowOnlyFavorites] = useState(false);

  const categories = ['todos', 'Software / Tecnologia', 'Gastronomia & Restaurantes', 'Portfólio Pessoal', 'E-commerce', 'Sistema'];

  const filteredSites = savedSites.filter((site) => {
    const matchesSearch = site.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          site.description.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = selectedCategory === 'todos' || site.category === selectedCategory;
    const matchesFavorite = !showOnlyFavorites || site.isFavorite;
    return matchesSearch && matchesCategory && matchesFavorite;
  });

  return (
    <div className="flex-1 overflow-y-auto bg-slate-950 text-white p-6 md:p-8 custom-scrollbar">
      <div className="max-w-7xl mx-auto space-y-8">
        {/* Header Section */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 pb-6 border-b border-white/10">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <FolderOpen className="w-6 h-6 text-pink-400" />
              <h1 className="text-2xl sm:text-3xl font-extrabold">Meus Projetos Froc.IA</h1>
            </div>
            <p className="text-xs text-white/60">
              Gerencie, edite, exporte e publique seus sites e aplicações criadas com IA.
            </p>
          </div>

          <div className="flex items-center gap-3">
            {/* Credits Summary Badge */}
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

            <button
              onClick={onNewSite}
              className="px-5 py-2.5 rounded-2xl bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white font-extrabold text-xs shadow-lg shadow-purple-500/30 flex items-center gap-2 transition-all"
            >
              <Plus className="w-4 h-4" />
              <span>Novo Projeto</span>
            </button>
          </div>
        </div>

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
      </div>
    </div>
  );
};
