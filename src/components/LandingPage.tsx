import React, { useState } from 'react';
import {
  Sparkles,
  ArrowRight,
  Zap,
  Globe,
  Code,
  Layers,
  ShieldCheck,
  Cpu,
  CheckCircle2,
  Video,
  Image as ImageIcon,
  Github,
  Rocket,
  MessageSquare,
  Bot,
  HelpCircle,
  Award
} from 'lucide-react';
import { MascotWidget } from './MascotWidget';
import { SiteTemplate } from '../types';

interface LandingPageProps {
  onStartStudioWithPrompt: (prompt: string) => void;
  onNavigate: (mode: 'studio' | 'pricing' | 'integrations' | 'dashboard') => void;
  templates: SiteTemplate[];
  onSelectTemplate: (template: SiteTemplate) => void;
}

export const LandingPage: React.FC<LandingPageProps> = ({
  onStartStudioWithPrompt,
  onNavigate,
  templates,
  onSelectTemplate
}) => {
  const [heroPrompt, setHeroPrompt] = useState('');

  const handleSubmitHero = (e: React.FormEvent) => {
    e.preventDefault();
    if (!heroPrompt.trim()) return;
    onStartStudioWithPrompt(heroPrompt.trim());
  };

  const samplePrompts = [
    'Criar uma landing page para consultoria financeira com calculadora de investimento',
    'Criar um sistema de agendamento online com painel de controle e pagamento via Pix',
    'Criar um e-commerce minimalista de camisetas ecológicas com carrinho e checkout',
    'Criar um dashboard analítico para monitorar vendas diárias e metas de equipe'
  ];

  return (
    <div className="flex-1 overflow-y-auto bg-slate-950 text-white custom-scrollbar selection:bg-purple-500 selection:text-white">
      {/* Hero Section */}
      <section className="relative pt-12 pb-24 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto text-center overflow-hidden">
        {/* Ambient Glow Effects */}
        <div className="absolute top-10 left-1/2 -translate-x-1/2 w-[700px] h-[350px] bg-gradient-to-tr from-purple-600/20 via-pink-500/15 to-blue-500/20 blur-[130px] rounded-full pointer-events-none"></div>

        {/* Badge & Official Logo Display */}
        <div className="flex flex-col items-center justify-center space-y-4 mb-6">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full glass-pill border border-white/15 text-xs font-semibold text-pink-300 shadow-xl">
            <span className="w-2 h-2 rounded-full bg-pink-400 animate-pulse"></span>
            <span>Plataforma Multimodal de Inteligência Artificial v4.0</span>
          </div>

          <div className="flex items-center justify-center gap-3 bg-white/5 border border-white/10 px-5 py-2.5 rounded-2xl backdrop-blur-md">
            <img
              src="https://portalvipbrasil.com.br/wp-content/uploads/2026/08/Froc.Ia_.png"
              alt="Froc.IA"
              referrerPolicy="no-referrer"
              className="h-10 w-auto object-contain filter drop-shadow-md"
            />
            <div className="text-left border-l border-white/10 pl-3">
              <span className="text-xl font-black tracking-tight text-white block">Froc.IA</span>
              <span className="text-[10px] text-purple-300 uppercase font-mono tracking-widest block -mt-1">Ecosistema Oficial</span>
            </div>
          </div>
        </div>

        {/* Hero Title & Slogan */}
        <h1 className="text-4xl sm:text-6xl lg:text-7xl font-black tracking-tight max-w-5xl mx-auto leading-tight text-white">
          Sua ideia. Nossa inteligência.{' '}
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-purple-400 via-pink-400 to-amber-300">
            Um projeto pronto.
          </span>
        </h1>

        <p className="mt-6 text-base sm:text-lg text-white/70 max-w-3xl mx-auto font-normal leading-relaxed">
          Crie sites completos, aplicativos web, landing pages, imagens, vídeos, refatore código e publique diretamente no GitHub e Vercel com assistentes autônomos multiagentes.
        </p>

        {/* AI Quick Generator Prompt Form */}
        <div className="mt-10 max-w-3xl mx-auto">
          <form onSubmit={handleSubmitHero} className="p-2 rounded-3xl glass-panel shadow-2xl border border-white/20 flex flex-col sm:flex-row items-center gap-2">
            <div className="flex-1 w-full flex items-center gap-3 px-4 py-2">
              <Sparkles className="w-5 h-5 text-pink-400 shrink-0 animate-pulse" />
              <input
                type="text"
                value={heroPrompt}
                onChange={(e) => setHeroPrompt(e.target.value)}
                placeholder="O que vamos criar hoje? Ex: Crie um site de petshop..."
                className="w-full bg-transparent text-white placeholder-white/40 text-sm focus:outline-none font-medium"
              />
            </div>
            <button
              type="submit"
              className="w-full sm:w-auto px-6 py-3.5 rounded-2xl bg-gradient-to-r from-purple-600 via-pink-600 to-amber-500 hover:from-purple-500 hover:to-amber-400 text-white font-extrabold text-sm shadow-xl shadow-purple-500/30 flex items-center justify-center gap-2 shrink-0 transition-all transform hover:scale-[1.02]"
            >
              <span>Gerar Agora</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>

          {/* Quick Prompts Suggestions */}
          <div className="mt-4 flex flex-wrap justify-center gap-2 text-xs">
            <span className="text-white/50 font-medium py-1">Sugestões:</span>
            {samplePrompts.map((p, idx) => (
              <button
                key={idx}
                onClick={() => setHeroPrompt(p)}
                className="px-3 py-1 rounded-full glass-button text-white/80 hover:text-white transition-colors text-[11px] truncate max-w-xs"
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        {/* Mascot & Platform Features Showcase */}
        <div className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-6 text-left max-w-6xl mx-auto">
          {/* Mascot Showcase Card */}
          <div className="p-6 rounded-[32px] glass-panel border border-white/15 flex flex-col items-center justify-center text-center relative overflow-hidden group">
            <MascotWidget size="lg" quote="Olá! Sou o mascote FrocBot. Estou pronto para construir seu projeto em segundos!" />
          </div>

          {/* Feature Card 1 */}
          <div className="p-6 rounded-[32px] glass-panel border border-white/15 space-y-4 hover:border-pink-500/40 transition-all">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-purple-500 to-pink-500 text-white flex items-center justify-center shadow-lg shadow-purple-500/30">
              <Code className="w-6 h-6" />
            </div>
            <h3 className="text-xl font-bold text-white">Criador de Apps & Sites</h3>
            <p className="text-xs text-white/60 leading-relaxed">
              Gere código HTML, CSS, React, TypeScript e Tailwind limpo, responsivo e sem bugs, pronto para hospedagem ou exportação em ZIP.
            </p>
            <div className="pt-2 flex items-center gap-2 text-xs font-semibold text-pink-300">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span>Validação automática de sintaxe</span>
            </div>
          </div>

          {/* Feature Card 2 */}
          <div className="p-6 rounded-[32px] glass-panel border border-white/15 space-y-4 hover:border-pink-500/40 transition-all">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-blue-500 to-cyan-400 text-white flex items-center justify-center shadow-lg shadow-blue-500/30">
              <Rocket className="w-6 h-6" />
            </div>
            <h3 className="text-xl font-bold text-white">Deploy em 1 Clique</h3>
            <p className="text-xs text-white/60 leading-relaxed">
              Conecte suas contas do GitHub e Vercel para publicar seu projeto em domínios customizados instantaneamente.
            </p>
            <div className="pt-2 flex items-center gap-2 text-xs font-semibold text-cyan-300">
              <Github className="w-4 h-4 text-white" />
              <span>Integração de repositórios oficiais</span>
            </div>
          </div>
        </div>
      </section>

      {/* Capabilities Section */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto border-t border-white/10">
        <div className="text-center max-w-3xl mx-auto mb-16 space-y-3">
          <span className="text-xs font-bold text-pink-400 uppercase tracking-widest bg-pink-500/10 px-3 py-1 rounded-full border border-pink-500/20">
            Poder Multimodal Integrado
          </span>
          <h2 className="text-3xl sm:text-5xl font-extrabold text-white">
            Uma IA completa para todo o seu ciclo de desenvolvimento
          </h2>
          <p className="text-sm text-white/60">
            Esqueça alternar entre dezenas de ferramentas soltas. No Froc.IA você tem tudo sob uma única interface esteticamente refinada.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <div className="p-6 rounded-3xl glass-card border border-white/10 space-y-3 hover:bg-white/10 transition-colors">
            <MessageSquare className="w-8 h-8 text-purple-400" />
            <h4 className="text-lg font-bold text-white">Conversa Inteligente</h4>
            <p className="text-xs text-white/60 leading-relaxed">
              Tire dúvidas avançadas, analise documentos grandes, formate textos e planeje a arquitetura de software.
            </p>
          </div>

          <div className="p-6 rounded-3xl glass-card border border-white/10 space-y-3 hover:bg-white/10 transition-colors">
            <ImageIcon className="w-8 h-8 text-pink-400" />
            <h4 className="text-lg font-bold text-white">Geração de Imagens</h4>
            <p className="text-xs text-white/60 leading-relaxed">
              Crie logotipos, banners, artes conceituais, mockups de produtos e avatares com Imagen 3.
            </p>
          </div>

          <div className="p-6 rounded-3xl glass-card border border-white/10 space-y-3 hover:bg-white/10 transition-colors">
            <Video className="w-8 h-8 text-amber-400" />
            <h4 className="text-lg font-bold text-white">Geração de Vídeos</h4>
            <p className="text-xs text-white/60 leading-relaxed">
              Transforme texto e fotos em animações em vídeo curtas para redes sociais e apresentações.
            </p>
          </div>

          <div className="p-6 rounded-3xl glass-card border border-white/10 space-y-3 hover:bg-white/10 transition-colors">
            <Cpu className="w-8 h-8 text-emerald-400" />
            <h4 className="text-lg font-bold text-white">Roteador de Modelos</h4>
            <p className="text-xs text-white/60 leading-relaxed">
              Roteamento dinâmico entre Gemini 3.6 Flash e Gemini Pro com failover de alta disponibilidade automático.
            </p>
          </div>
        </div>
      </section>

      {/* Starter Templates Showcase Carousel */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto border-t border-white/10">
        <div className="flex flex-col md:flex-row md:items-end justify-between mb-12 gap-4">
          <div>
            <span className="text-xs font-bold text-purple-400 uppercase tracking-widest block mb-2">Modelos Prontos</span>
            <h2 className="text-3xl font-extrabold text-white">Comece com projetos pré-construídos</h2>
          </div>
          <button
            onClick={() => onNavigate('studio')}
            className="px-5 py-2.5 rounded-full glass-button text-xs font-bold text-white hover:bg-white/20 transition-all flex items-center gap-2 self-start md:self-auto"
          >
            <span>Ver Todos os Modelos</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {templates.map((tmpl) => (
            <div
              key={tmpl.id}
              onClick={() => {
                onSelectTemplate(tmpl);
                onNavigate('studio');
              }}
              className="p-6 rounded-3xl glass-panel border border-white/15 cursor-pointer hover:border-pink-500/50 hover:scale-[1.01] transition-all space-y-4 group"
            >
              <div className="flex justify-between items-start">
                <span className="px-3 py-1 rounded-full bg-purple-500/20 text-purple-300 text-[10px] font-bold border border-purple-500/30">
                  {tmpl.category}
                </span>
                <span className="text-xs text-pink-400 font-bold group-hover:translate-x-1 transition-transform inline-flex items-center gap-1">
                  Usar Modelo →
                </span>
              </div>
              <h3 className="text-xl font-bold text-white">{tmpl.title}</h3>
              <p className="text-xs text-white/60 leading-relaxed line-clamp-2">{tmpl.description}</p>
              <div className="pt-2 border-t border-white/10 flex items-center justify-between text-[11px] text-white/40 font-mono">
                <span>Paleta: {tmpl.colorPalette}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing / Pix Integration Callout */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto border-t border-white/10 text-center">
        <div className="max-w-3xl mx-auto space-y-4 mb-12">
          <span className="text-xs font-bold text-amber-400 uppercase tracking-widest bg-amber-500/10 px-3 py-1 rounded-full border border-amber-500/20">
            Carteira de Créditos & Mercado Pago
          </span>
          <h2 className="text-3xl sm:text-5xl font-extrabold text-white">
            Preços transparentes com recarga via Pix
          </h2>
          <p className="text-sm text-white/60">
            Recarregue seus créditos com liberação instantânea via Pix ou Cartão pelo Mercado Pago. Pagamento 100% seguro.
          </p>
        </div>

        <button
          onClick={() => onNavigate('pricing')}
          className="px-8 py-4 rounded-2xl bg-gradient-to-r from-purple-600 via-pink-600 to-amber-500 hover:opacity-90 text-white font-extrabold text-base shadow-2xl shadow-purple-500/30 inline-flex items-center gap-2 transition-all transform hover:scale-[1.02]"
        >
          <Zap className="w-5 h-5 text-amber-300" />
          <span>Ver Pacotes e Planos de Créditos</span>
        </button>
      </section>

      {/* Footer */}
      <footer className="py-12 border-t border-white/10 bg-black/60 text-white/50 text-xs">
        <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-3">
            <img
              src="https://portalvipbrasil.com.br/wp-content/uploads/2026/08/Froc.Ia_.png"
              alt="Froc.IA Logo"
              referrerPolicy="no-referrer"
              className="h-7 w-auto object-contain"
            />
            <span className="font-extrabold text-white text-sm">Froc.IA</span>
          </div>
          <p className="text-center md:text-left">
            © 2026 Froc.IA. Sua ideia. Nossa inteligência. Um projeto pronto.
          </p>
          <div className="flex items-center gap-4 text-white/70">
            <button onClick={() => onNavigate('studio')} className="hover:text-white">Editor Studio</button>
            <button onClick={() => onNavigate('pricing')} className="hover:text-white">Planos</button>
            <button onClick={() => onNavigate('integrations')} className="hover:text-white">Integrações</button>
            <button onClick={() => onNavigate('dashboard')} className="hover:text-white">Projetos</button>
          </div>
        </div>
      </footer>
    </div>
  );
};
