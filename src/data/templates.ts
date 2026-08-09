import { SiteTemplate } from '../types';

export const STARTER_TEMPLATES: SiteTemplate[] = [
  {
    id: 'template-saas-launch',
    title: 'SaaS Platform & AI Tech',
    category: 'Landing Page',
    description: 'Landing page moderna de alta conversão para produtos de software, SaaS e Inteligência Artificial.',
    badge: 'Popular',
    iconName: 'Rocket',
    colorPalette: 'Deep Blue & Neon Cyan',
    prompt: 'Crie uma landing page moderna para uma plataforma SaaS de Inteligência Artificial com hero section, métricas, grade de recursos, depoimentos e tabela de preços.',
    sampleHtml: `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>NexusAI — Inteligência Artificial para Negócios</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;800&display=swap" rel="stylesheet">
  <style>body { font-family: 'Plus Jakarta Sans', sans-serif; }</style>
</head>
<body class="bg-slate-950 text-slate-100 antialiased selection:bg-cyan-500 selection:text-black">
  <header class="border-b border-slate-800/80 sticky top-0 bg-slate-950/80 backdrop-blur-md z-50">
    <div class="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center font-bold text-black text-xl">N</div>
        <span class="font-extrabold text-xl tracking-tight text-white">Nexus<span class="text-cyan-400">AI</span></span>
      </div>
      <nav class="hidden md:flex items-center gap-8 text-sm font-semibold text-slate-300">
        <a href="#recursos" class="hover:text-cyan-400 transition-colors">Recursos</a>
        <a href="#metricas" class="hover:text-cyan-400 transition-colors">Métricas</a>
        <a href="#precos" class="hover:text-cyan-400 transition-colors">Planos</a>
      </nav>
      <button class="bg-gradient-to-r from-cyan-500 to-blue-600 hover:opacity-90 text-slate-950 font-extrabold px-6 py-2.5 rounded-xl transition-all shadow-lg shadow-cyan-500/20">
        Começar Grátis
      </button>
    </div>
  </header>

  <main>
    <section class="relative py-24 md:py-32 overflow-hidden text-center">
      <div class="max-w-4xl mx-auto px-6 relative z-10 space-y-8">
        <div class="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-cyan-500/30 bg-cyan-500/10 text-cyan-400 text-xs font-bold tracking-wide uppercase">
          ✨ Nova Versão 3.0 Disponível
        </div>
        <h1 class="text-4xl md:text-6xl font-black tracking-tight leading-tight">
          Acelere seus resultados com o motor de <span class="bg-gradient-to-r from-cyan-400 via-blue-400 to-purple-500 bg-clip-text text-transparent">IA Avançada</span>
        </h1>
        <p class="text-lg md:text-xl text-slate-400 max-w-2xl mx-auto font-normal">
          Automatize fluxos de trabalho, analise dados em tempo real e construa protótipos em segundos com nossa plataforma integrada.
        </p>
        <div class="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4">
          <button class="w-full sm:w-auto bg-cyan-400 text-slate-950 font-extrabold px-8 py-4 rounded-xl shadow-xl shadow-cyan-500/25 hover:bg-cyan-300 transition-all">
            Criar Conta Gratuita
          </button>
          <button class="w-full sm:w-auto border border-slate-700 bg-slate-900/50 hover:bg-slate-800 text-slate-200 font-bold px-8 py-4 rounded-xl transition-all">
            Ver Demonstração
          </button>
        </div>
      </div>
    </section>

    <section id="metricas" class="py-16 border-y border-slate-800/80 bg-slate-900/30">
      <div class="max-w-7xl mx-auto px-6 grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
        <div>
          <p class="text-3xl md:text-4xl font-extrabold text-cyan-400">99.9%</p>
          <p class="text-sm text-slate-400 mt-1">Uptime Garantido</p>
        </div>
        <div>
          <p class="text-3xl md:text-4xl font-extrabold text-cyan-400">10x</p>
          <p class="text-sm text-slate-400 mt-1">Mais Rápido</p>
        </div>
        <div>
          <p class="text-3xl md:text-4xl font-extrabold text-cyan-400">50k+</p>
          <p class="text-sm text-slate-400 mt-1">Usuários Ativos</p>
        </div>
        <div>
          <p class="text-3xl md:text-4xl font-extrabold text-cyan-400">24/7</p>
          <p class="text-sm text-slate-400 mt-1">Suporte Especializado</p>
        </div>
      </div>
    </section>
  </main>

  <footer class="py-8 border-t border-slate-900 text-center text-sm text-slate-500">
    <p>© 2026 NexusAI Technologies. Todos os direitos reservados.</p>
  </footer>
</body>
</html>`
  },
  {
    id: 'template-gourmet-bistro',
    title: 'Gourmet Bistro & Restaurante',
    category: 'Gastronomia',
    description: 'Template elegante para restaurantes de alta gastronomia, bistrôs e eventos culinários.',
    badge: 'Elegante',
    iconName: 'Utensils',
    colorPalette: 'Warm Charcoal & Gold',
    prompt: 'Crie um site para um restaurante de alta gastronomia com cardápio interativo, história do chef e sistema de reservas de mesas.',
    sampleHtml: `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>L'Aroma Bistro — Gastronomia Contemporânea</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,600;0,800;1,400&family=Plus+Jakarta+Sans:wght@400;600&display=swap" rel="stylesheet">
  <style>
    h1, h2, h3, .serif-font { font-family: 'Playfair Display', serif; }
    body { font-family: 'Plus Jakarta Sans', sans-serif; }
  </style>
</head>
<body class="bg-stone-950 text-stone-200 antialiased">
  <header class="py-8 px-8 border-b border-stone-800/60 flex items-center justify-between max-w-7xl mx-auto">
    <div class="text-2xl font-bold tracking-wider text-amber-400 serif-font">L'AROMA</div>
    <nav class="hidden md:flex gap-8 text-sm uppercase tracking-widest text-stone-400">
      <a href="#menu" class="hover:text-amber-400 transition-colors">Cardápio</a>
      <a href="#sobre" class="hover:text-amber-400 transition-colors">O Chef</a>
      <a href="#reserva" class="hover:text-amber-400 transition-colors">Reservas</a>
    </nav>
    <button class="border border-amber-400/40 text-amber-400 hover:bg-amber-400 hover:text-stone-950 font-bold px-6 py-2.5 rounded-none transition-all uppercase text-xs tracking-widest">
      Reservar Mesa
    </button>
  </header>

  <main>
    <section class="py-24 text-center px-6">
      <span class="text-amber-400 uppercase tracking-widest text-xs font-bold">Experiência Culinária Única</span>
      <h1 class="text-5xl md:text-7xl font-normal text-stone-100 my-6">Sabores que despertam memórias</h1>
      <p class="text-stone-400 max-w-xl mx-auto text-base">Ingredientes frescos da estação preparados com técnica clássica e apresentação contemporânea.</p>
    </section>

    <section id="menu" class="py-16 max-w-4xl mx-auto px-6">
      <h2 class="text-3xl text-amber-400 text-center mb-12">Destaques do Cardápio</h2>
      <div class="space-y-8">
        <div class="flex justify-between items-baseline border-b border-stone-800 pb-4">
          <div>
            <h3 class="text-xl text-stone-100">Risotto ao Tartufo Nero</h3>
            <p class="text-sm text-stone-500 mt-1">Arroz arbóreo, trufas negras frescas e Parmigiano Reggiano 24 meses</p>
          </div>
          <span class="text-amber-400 font-semibold text-lg">R$ 118</span>
        </div>
        <div class="flex justify-between items-baseline border-b border-stone-800 pb-4">
          <div>
            <h3 class="text-xl text-stone-100">Ancho Wagyu Grelhado</h3>
            <p class="text-sm text-stone-500 mt-1">Acompanhado de mousseline de batata trufada e molho roti de ervas</p>
          </div>
          <span class="text-amber-400 font-semibold text-lg">R$ 165</span>
        </div>
      </div>
    </section>
  </main>

  <footer class="py-8 text-center text-xs text-stone-600 border-t border-stone-900">
    <p>© 2026 L'Aroma Bistro. Alameda dos Anjos, 450 — Jardins.</p>
  </footer>
</body>
</html>`
  },
  {
    id: 'template-minimalist-portfolio',
    title: 'Minimalist Design Studio',
    category: 'Portfólio',
    description: 'Portfólio minimalista e elegante para designers, arquitetos e estúdios criativos.',
    badge: 'Atemporal',
    iconName: 'Layout',
    colorPalette: 'Monochrome & Pure White',
    prompt: 'Crie um portfólio minimalista para um estúdio de design e arquitetura com galeria de projetos, manifesto e formulário de contato.',
    sampleHtml: `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>KRONO — Studio de Design & Arquitetura</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;500;700;900&display=swap" rel="stylesheet">
  <style>body { font-family: 'Plus Jakarta Sans', sans-serif; }</style>
</head>
<body class="bg-neutral-900 text-neutral-100 antialiased p-8 md:p-16">
  <div class="max-w-6xl mx-auto space-y-24">
    <header class="flex justify-between items-center border-b border-neutral-800 pb-8">
      <span class="text-2xl font-black tracking-tighter uppercase">Krono.studio</span>
      <nav class="flex gap-8 text-xs font-semibold uppercase tracking-widest text-neutral-400">
        <a href="#projetos" class="hover:text-white transition-colors">Projetos</a>
        <a href="#sobre" class="hover:text-white transition-colors">Sobre</a>
        <a href="#contato" class="hover:text-white transition-colors">Contato</a>
      </nav>
    </header>

    <section class="space-y-6">
      <h1 class="text-4xl md:text-7xl font-bold tracking-tight max-w-4xl leading-tight">
        Criamos identidades visuais e espaços funcionais com essência minimalista.
      </h1>
      <p class="text-neutral-400 text-lg md:text-xl font-light max-w-2xl">
        Transformamos conceitos complexos em experiências puras, funcionais e esteticamente relevantes.
      </p>
    </section>

    <section id="projetos" class="grid grid-cols-1 md:grid-cols-2 gap-12">
      <div class="space-y-4 group cursor-pointer">
        <div class="h-80 bg-neutral-800 rounded-2xl flex items-center justify-center border border-neutral-800 group-hover:border-neutral-700 transition-all">
          <span class="text-neutral-500 font-mono text-sm">[Projeto 01 — Residência Minimalista]</span>
        </div>
        <h3 class="text-xl font-bold">Casa Monolito</h3>
        <p class="text-xs text-neutral-500 uppercase tracking-wider">Arquitetura / São Paulo, BR</p>
      </div>

      <div class="space-y-4 group cursor-pointer">
        <div class="h-80 bg-neutral-800 rounded-2xl flex items-center justify-center border border-neutral-800 group-hover:border-neutral-700 transition-all">
          <span class="text-neutral-500 font-mono text-sm">[Projeto 02 — Identidade Visual]</span>
        </div>
        <h3 class="text-xl font-bold">Branding Veloce</h3>
        <p class="text-xs text-neutral-500 uppercase tracking-wider">Design de Marca / Lisboa, PT</p>
      </div>
    </section>

    <footer class="border-t border-neutral-800 pt-8 flex justify-between text-xs text-neutral-500">
      <p>© 2026 Krono Studio. Todos os direitos reservados.</p>
      <p>hello@krono.studio</p>
    </footer>
  </div>
</body>
</html>`
  }
];

