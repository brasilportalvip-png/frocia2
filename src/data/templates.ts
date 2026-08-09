import { SiteTemplate } from '../types';

export const STARTER_TEMPLATES: SiteTemplate[] = [
  {
    id: 'gourmet-bistro',
    title: 'Aroma & Sabor — Restaurante & Bistrô',
    category: 'Gastronomia & Restaurantes',
    description: 'Site sofisticado para restaurante, com menu interativo por abas, reservas online e galeria de pratos.',
    badge: 'Gastronomia',
    iconName: 'Utensils',
    colorPalette: 'Warm Amber & Gold',
    prompt: 'Crie um site elegante e acolhedor para o restaurante Aroma & Sabor, com cardápio por abas, formulário de reserva de mesa e visual aconchegante.',
    sampleHtml: `<!DOCTYPE html>
<html lang="pt-BR" class="scroll-smooth">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Aroma & Sabor — Gastronomia Autêntica</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,600;0,700;1,400&family=Plus+Jakarta+Sans:wght@300;400;500;600&display=swap" rel="stylesheet">
  <style>
    h1, h2, h3, .font-serif-custom { font-family: 'Playfair Display', serif; }
    body { font-family: 'Plus Jakarta Sans', sans-serif; }
  </style>
</head>
<body class="bg-amber-950 text-amber-50 antialiased selection:bg-amber-500 selection:text-slate-950">

  <!-- Header -->
  <header class="fixed top-0 left-0 right-0 z-50 bg-amber-950/90 backdrop-blur-md border-b border-amber-900/50">
    <div class="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
      <a href="#" class="text-2xl font-bold font-serif-custom tracking-wider text-amber-400">Aroma <span class="text-amber-100">& Sabor</span></a>
      <nav class="hidden md:flex items-center gap-8 text-sm uppercase tracking-widest text-amber-200/80 font-medium">
        <a href="#historia" class="hover:text-amber-400 transition-colors">Nossa História</a>
        <a href="#cardapio" class="hover:text-amber-400 transition-colors">Cardápio</a>
        <a href="#reservas" class="hover:text-amber-400 transition-colors">Reservas</a>
        <a href="#contato" class="hover:text-amber-400 transition-colors">Contato</a>
      </nav>
      <a href="#reservas" class="hidden md:inline-block px-6 py-2.5 rounded-full bg-amber-500 hover:bg-amber-400 text-amber-950 font-bold text-sm transition-all shadow-lg shadow-amber-500/20">
        Reservar Mesa
      </a>
    </div>
  </header>

  <!-- Hero Section -->
  <section class="relative h-screen flex items-center justify-center overflow-hidden">
    <img src="https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=1920&q=80" alt="Ambiente do Restaurante" class="absolute inset-0 w-full h-full object-cover brightness-[0.35]" />
    <div class="relative z-10 text-center max-w-4xl px-6">
      <span class="text-xs font-semibold uppercase tracking-[0.3em] text-amber-400 mb-4 block">Culinária Artesanal Contemporânea</span>
      <h1 class="text-5xl sm:text-7xl font-normal text-white mb-6 leading-tight">Uma experiência inesquecível para o seu paladar</h1>
      <p class="text-amber-100/80 text-lg sm:text-xl font-light max-w-2xl mx-auto mb-10">Ingredientes frescos da estação combinados com técnicas clássicas e inovação gastronômica.</p>
      <div class="flex flex-col sm:flex-row gap-4 justify-center">
        <a href="#cardapio" class="px-8 py-4 rounded-full bg-amber-500 hover:bg-amber-400 text-amber-950 font-bold text-base transition-all">Ver Cardápio</a>
        <a href="#reservas" class="px-8 py-4 rounded-full border border-amber-400/50 hover:bg-amber-400/10 text-amber-200 font-semibold text-base transition-all">Fazer Reserva</a>
      </div>
    </div>
  </section>

  <!-- Cardápio Em Destaque -->
  <section id="cardapio" class="py-24 bg-amber-900/20">
    <div class="max-w-6xl mx-auto px-6">
      <div class="text-center mb-16">
        <span class="text-xs font-semibold text-amber-400 uppercase tracking-widest block mb-2">Seleções do Chef</span>
        <h2 class="text-4xl sm:text-5xl font-normal text-amber-100">Nosso Menu Especial</h2>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div class="p-6 rounded-2xl bg-amber-950/80 border border-amber-900/60 flex gap-6 items-center">
          <img src="https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=300&q=80" class="w-24 h-24 rounded-xl object-cover shrink-0" />
          <div class="grow">
            <div class="flex justify-between items-baseline mb-2">
              <h3 class="text-xl font-bold text-amber-200">Costela Prime ao Rôti</h3>
              <span class="text-amber-400 font-bold text-lg">R$ 118</span>
            </div>
            <p class="text-amber-200/60 text-sm">Costela bovina prensada 12h, mousseline de mandioquinha e redução de vinho tinto.</p>
          </div>
        </div>

        <div class="p-6 rounded-2xl bg-amber-950/80 border border-amber-900/60 flex gap-6 items-center">
          <img src="https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?auto=format&fit=crop&w=300&q=80" class="w-24 h-24 rounded-xl object-cover shrink-0" />
          <div class="grow">
            <div class="flex justify-between items-baseline mb-2">
              <h3 class="text-xl font-bold text-amber-200">Risoto de Frutos do Mar</h3>
              <span class="text-amber-400 font-bold text-lg">R$ 135</span>
            </div>
            <p class="text-amber-200/60 text-sm">Camarões rosa, lulas grelhadas, açafrão espanhol e raspas de limão siciliano.</p>
          </div>
        </div>
      </div>
    </div>
  </section>

  <!-- Reservas -->
  <section id="reservas" class="py-24 bg-amber-950 border-t border-amber-900/40">
    <div class="max-w-3xl mx-auto px-6 text-center">
      <h2 class="text-4xl font-normal text-amber-100 mb-4">Garanta a sua mesa</h2>
      <p class="text-amber-200/70 mb-10">Reservas online simples e rápidas para almoços ou jantares especiais.</p>

      <form class="bg-amber-900/40 p-8 rounded-3xl border border-amber-900/60 text-left space-y-6">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <div>
            <label class="block text-xs uppercase tracking-wider text-amber-300 mb-2">Nome Completo</label>
            <input type="text" class="w-full px-4 py-3 rounded-xl bg-amber-950 border border-amber-800 text-amber-100 text-sm focus:outline-none focus:border-amber-400" required />
          </div>
          <div>
            <label class="block text-xs uppercase tracking-wider text-amber-300 mb-2">Telefone / WhatsApp</label>
            <input type="tel" class="w-full px-4 py-3 rounded-xl bg-amber-950 border border-amber-800 text-amber-100 text-sm focus:outline-none focus:border-amber-400" required />
          </div>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-6">
          <div>
            <label class="block text-xs uppercase tracking-wider text-amber-300 mb-2">Data</label>
            <input type="date" class="w-full px-4 py-3 rounded-xl bg-amber-950 border border-amber-800 text-amber-100 text-sm focus:outline-none focus:border-amber-400" required />
          </div>
          <div>
            <label class="block text-xs uppercase tracking-wider text-amber-300 mb-2">Horário</label>
            <select class="w-full px-4 py-3 rounded-xl bg-amber-950 border border-amber-800 text-amber-100 text-sm focus:outline-none focus:border-amber-400">
              <option>19:00</option>
              <option>20:30</option>
              <option>22:00</option>
            </select>
          </div>
          <div>
            <label class="block text-xs uppercase tracking-wider text-amber-300 mb-2">Pessoas</label>
            <select class="w-full px-4 py-3 rounded-xl bg-amber-950 border border-amber-800 text-amber-100 text-sm focus:outline-none focus:border-amber-400">
              <option>2 Pessoas</option>
              <option>4 Pessoas</option>
              <option>6+ Pessoas</option>
            </select>
          </div>
        </div>
        <button type="submit" class="w-full py-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-amber-950 font-bold transition-all">Confirmar Solicitação de Reserva</button>
      </form>
    </div>
  </section>
</body>
</html>`
  },
  {
    id: 'minimalist-portfolio',
    title: 'Lucas Rocha — Portfólio de Designer UX/UI',
    category: 'Portfólio Pessoal',
    description: 'Portfólio minimalista dark mode com biografia, galeria interativa de projetos case-studies e contato rápido.',
    badge: 'Design & Craft',
    iconName: 'User',
    colorPalette: 'Monochrome Dark & Indigo Accent',
    prompt: 'Crie um portfólio minimalista para Lucas Rocha, Product Designer & UX Engineer, com lista de projetos, habilidades e contato por e-mail.',
    sampleHtml: `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Lucas Rocha — Product Designer</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
  <style> body { font-family: 'Inter', sans-serif; } </style>
</head>
<body class="bg-zinc-950 text-zinc-100 antialiased selection:bg-indigo-500 selection:text-white">

  <!-- Header -->
  <header class="max-w-5xl mx-auto px-6 py-10 flex items-center justify-between">
    <div class="text-lg font-bold tracking-tight text-zinc-100">lucas.design</div>
    <div class="flex items-center gap-6 text-sm text-zinc-400 font-medium">
      <a href="#trabalhos" class="hover:text-white transition-colors">Trabalhos</a>
      <a href="#sobre" class="hover:text-white transition-colors">Sobre</a>
      <a href="mailto:contato@lucasrocha.design" class="px-4 py-2 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border border-zinc-800 transition-colors">Contato</a>
    </div>
  </header>

  <!-- Hero Section -->
  <section class="max-w-5xl mx-auto px-6 py-20">
    <div class="inline-block px-3 py-1 rounded-full bg-indigo-500/10 text-indigo-400 text-xs font-semibold mb-6">
      Disponível para novos projetos selecionados
    </div>
    <h1 class="text-4xl sm:text-6xl font-extrabold text-white tracking-tight leading-tight max-w-3xl">
      Criando experiências digitais <span class="text-indigo-400">memoráveis</span> e sistemas de design intuitivos.
    </h1>
    <p class="mt-6 text-xl text-zinc-400 max-w-2xl font-normal leading-relaxed">
      Product Designer sênior com 7 anos de experiência transformando ideias complexas em interfaces elegantes para startups globais.
    </p>
  </section>

  <!-- Projects Grid -->
  <section id="trabalhos" class="max-w-5xl mx-auto px-6 py-12 border-t border-zinc-900">
    <h2 class="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-10">Projetos em Destaque</h2>

    <div class="grid grid-cols-1 md:grid-cols-2 gap-10">
      <!-- Project 1 -->
      <div class="group cursor-pointer">
        <div class="overflow-hidden rounded-2xl bg-zinc-900 border border-zinc-800 mb-4">
          <img src="https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=800&q=80" alt="Fintech App" class="w-full h-72 object-cover group-hover:scale-105 transition duration-500" />
        </div>
        <div class="flex justify-between items-start">
          <div>
            <h3 class="text-xl font-bold text-white group-hover:text-indigo-400 transition-colors">Nova Financial Platform</h3>
            <p class="text-zinc-400 text-sm mt-1">UX Research, Redesign Completo, Design System</p>
          </div>
          <span class="text-xs px-2.5 py-1 rounded bg-zinc-900 text-zinc-400 border border-zinc-800">2025</span>
        </div>
      </div>

      <!-- Project 2 -->
      <div class="group cursor-pointer">
        <div class="overflow-hidden rounded-2xl bg-zinc-900 border border-zinc-800 mb-4">
          <img src="https://images.unsplash.com/photo-1507238691740-187a5b1d37b8?auto=format&fit=crop&w=800&q=80" alt="E-Commerce App" class="w-full h-72 object-cover group-hover:scale-105 transition duration-500" />
        </div>
        <div class="flex justify-between items-start">
          <div>
            <h3 class="text-xl font-bold text-white group-hover:text-indigo-400 transition-colors">Aura Wellness App</h3>
            <p class="text-zinc-400 text-sm mt-1">Mobile App iOS & Android, Micro-interações</p>
          </div>
          <span class="text-xs px-2.5 py-1 rounded bg-zinc-900 text-zinc-400 border border-zinc-800">2024</span>
        </div>
      </div>
    </div>
  </section>

  <!-- Footer -->
  <footer class="max-w-5xl mx-auto px-6 py-16 border-t border-zinc-900 text-zinc-500 text-sm flex justify-between items-center">
    <p>© 2026 Lucas Rocha. Feito com froc.ia AI.</p>
    <div class="flex gap-4 text-zinc-400">
      <a href="#" class="hover:text-white">GitHub</a>
      <a href="#" class="hover:text-white">LinkedIn</a>
      <a href="#" class="hover:text-white">Dribbble</a>
    </div>
  </footer>

</body>
</html>`
  }
];
