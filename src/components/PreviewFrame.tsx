import React, { useRef, useEffect } from 'react';
import {
  RotateCcw,
  ExternalLink,
  Maximize2,
  Wand2,
  Sparkles
} from 'lucide-react';
import { DeviceView, GeneratedSite } from '../types';

interface PreviewFrameProps {
  site: GeneratedSite | null;
  deviceView: DeviceView;
  isGenerating: boolean;
  onOpenFullscreen: () => void;
  onRefresh: () => void;
}

export const PreviewFrame: React.FC<PreviewFrameProps> = ({
  site,
  deviceView,
  isGenerating,
  onOpenFullscreen,
  onRefresh
}) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Set iframe srcdoc whenever HTML changes
  useEffect(() => {
    if (iframeRef.current && site?.html) {
      iframeRef.current.srcdoc = site.html;
    }
  }, [site?.html]);

    const openNewTab = () => {
    if (!site?.html) return;

    const escapedHtml = site.html
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    const sandboxedDocument = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Prévia segura - Froc.IA</title>
  <style>
    html, body, iframe {
      width: 100%;
      height: 100%;
      margin: 0;
      border: 0;
      overflow: hidden;
    }
  </style>
</head>
<body>
  <iframe
    title="Prévia segura Froc.IA"
    sandbox="allow-scripts allow-forms"
    srcdoc="${escapedHtml}"
  ></iframe>
</body>
</html>`;

    const blob = new Blob([sandboxedDocument], {
      type: 'text/html;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);

    window.open(url, '_blank', 'noopener,noreferrer');
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  const getContainerWidthClass = () => {
    switch (deviceView) {
      case 'mobile':
        return 'w-[375px] h-[720px] my-auto rounded-[38px] border-[10px] border-white/20 shadow-2xl relative overflow-hidden bg-black';
      case 'tablet':
        return 'w-[768px] h-[880px] my-auto rounded-[28px] border-[8px] border-white/20 shadow-2xl relative overflow-hidden bg-black';
      case 'desktop':
      default:
        return 'w-full h-full rounded-[32px] border border-white/10 shadow-2xl overflow-hidden flex flex-col bg-white/5 backdrop-blur-xl';
    }
  };

  return (
    <div id="froc-preview-container" className="flex-1 bg-transparent flex flex-col h-full overflow-hidden relative text-white">
      {/* Top Preview Status Bar */}
      <div className="h-10 bg-white/5 border-b border-white/10 px-4 flex items-center justify-between text-xs text-white/60 shrink-0 z-10 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <div className="flex gap-1.5 mr-2">
            <div className="w-2.5 h-2.5 rounded-full bg-red-500/60"></div>
            <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/60"></div>
            <div className="w-2.5 h-2.5 rounded-full bg-green-500/60"></div>
          </div>
          <div className="mx-auto bg-black/40 px-3 py-0.5 rounded-md border border-white/5 text-[10px] text-white/50 font-mono">
            www.{site ? site.title.toLowerCase().replace(/[^a-z0-9]/g, '-') : 'projeto'}.froc.ia
          </div>
        </div>

        {site && (
          <div className="flex items-center gap-3">
            <button
              onClick={onRefresh}
              className="hover:text-white transition-colors flex items-center gap-1 text-[11px]"
              title="Recarregar Frame"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Recarregar</span>
            </button>

            <button
              onClick={openNewTab}
              className="hover:text-white transition-colors flex items-center gap-1 text-[11px]"
              title="Nova Aba"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Nova Aba</span>
            </button>

            <button
              onClick={onOpenFullscreen}
              className="hover:text-white transition-colors flex items-center gap-1 text-[11px]"
              title="Tela Cheia"
            >
              <Maximize2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Tela Cheia</span>
            </button>
          </div>
        )}
      </div>

      {/* Main Preview Area */}
      <div className="flex-1 p-4 flex items-center justify-center overflow-auto bg-grid relative custom-scrollbar">
        {/* Loading Overlay */}
        {isGenerating && (
          <div className="absolute inset-0 bg-black/70 backdrop-blur-xl z-30 flex flex-col items-center justify-center p-6 text-center space-y-4">
            <div className="relative">
              <div className="w-20 h-20 rounded-3xl bg-gradient-to-tr from-purple-500 via-pink-500 to-blue-500 animate-spin flex items-center justify-center shadow-2xl shadow-purple-500/30"></div>
              <div className="absolute inset-2 rounded-2xl bg-black flex items-center justify-center">
                <Wand2 className="w-8 h-8 text-pink-400 animate-pulse" />
              </div>
            </div>
            <div className="space-y-1">
              <h3 className="text-xl font-bold text-white tracking-tight">froc.ia está gerando o projeto Frosted Glass...</h3>
              <p className="text-xs text-white/60 max-w-sm">Construindo a interface moderna, componentes responsivos e código HTML/Tailwind CSS.</p>
            </div>
          </div>
        )}

        {/* Render Frame or Empty State */}
        {site ? (
          <div className={`transition-all duration-300 relative ${getContainerWidthClass()}`}>
            {/* Device Speaker Notch simulation for mobile/tablet */}
            {deviceView !== 'desktop' && (
              <div className="absolute top-2 left-1/2 -translate-x-1/2 w-20 h-3 bg-black/80 rounded-full z-20"></div>
            )}
            <iframe
              ref={iframeRef}
              id="live-preview-iframe"
              title="froc.ia Live Preview"
              className="w-full h-full border-none bg-white rounded-b-[28px]"
              sandbox="allow-scripts allow-forms"
            />
          </div>
        ) : (
          <div className="max-w-md text-center p-8 rounded-[32px] glass-panel shadow-2xl space-y-6 my-auto">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-purple-500 to-pink-500 text-white flex items-center justify-center mx-auto text-3xl shadow-xl shadow-purple-500/30 font-serif italic">
              F
            </div>
            <div className="space-y-2">
              <h3 className="text-2xl font-extrabold text-white">Bem-vindo ao froc.ia</h3>
              <p className="text-xs text-white/60 leading-relaxed">
                Descreva seu projeto no painel lateral para gerar um site completo com estéticas Frosted Glass em segundos.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 text-left pt-2">
              <div className="p-3.5 rounded-2xl bg-white/5 border border-white/10 text-[11px] text-white/80">
                <span className="font-bold text-pink-300 block mb-0.5">⚡ IA em Tempo Real</span>
                Gera HTML, CSS e componentes com IA.
              </div>
              <div className="p-3.5 rounded-2xl bg-white/5 border border-white/10 text-[11px] text-white/80">
                <span className="font-bold text-purple-300 block mb-0.5">📱 100% Responsivo</span>
                Visualização para Desktop, Tablet e Mobile.
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

