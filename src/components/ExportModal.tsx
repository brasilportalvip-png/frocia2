import React, { useState } from 'react';
import { X, Download, Copy, Check, FileCode, Globe } from 'lucide-react';
import { GeneratedSite } from '../types';

interface ExportModalProps {
  site: GeneratedSite | null;
  isOpen: boolean;
  onClose: () => void;
}

export const ExportModal: React.FC<ExportModalProps> = ({ site, isOpen, onClose }) => {
  const [copied, setCopied] = useState(false);

  if (!isOpen || !site) return null;

  const downloadHtmlFile = () => {
    const filename = `${site.title.toLowerCase().replace(/[^a-z0-9]/g, '-') || 'projeto-froc-ia'}.html`;
    const blob = new Blob([site.html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const copyCode = () => {
    navigator.clipboard.writeText(site.html);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xl flex items-center justify-center p-4">
      <div className="w-full max-w-lg glass-panel rounded-[32px] p-6 shadow-2xl space-y-6 relative border border-white/20 text-white">
        <button
          onClick={onClose}
          className="absolute top-5 right-5 text-white/60 hover:text-white p-2 rounded-full glass-button transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="space-y-1">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-purple-500 to-pink-500 text-white flex items-center justify-center text-xl mb-3 shadow-lg shadow-purple-500/30">
            <Download className="w-6 h-6" />
          </div>
          <h3 className="text-xl font-extrabold text-white">Exportar Projeto de froc.ia</h3>
          <p className="text-xs text-white/60">
            Baixe o arquivo HTML5 pronto para publicar em qualquer hospedagem (Vercel, Netlify, GitHub Pages, Hostinger).
          </p>
        </div>

        <div className="space-y-3">
          {/* Download HTML Button */}
          <button
            onClick={downloadHtmlFile}
            className="w-full p-4 rounded-2xl bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white font-extrabold text-sm transition-all shadow-xl shadow-purple-500/30 flex items-center justify-between group"
          >
            <div className="flex items-center gap-3">
              <FileCode className="w-5 h-5 text-white" />
              <div className="text-left">
                <div>Baixar Arquivo HTML Completo (.html)</div>
                <div className="text-[11px] font-normal opacity-80">Pronto com Tailwind CSS CDN e Scripts</div>
              </div>
            </div>
            <Download className="w-5 h-5 transform group-hover:translate-y-0.5 transition-transform" />
          </button>

          {/* Copy Code Button */}
          <button
            onClick={copyCode}
            className="w-full p-4 rounded-2xl glass-button text-white font-bold text-sm transition-all flex items-center justify-between"
          >
            <div className="flex items-center gap-3">
              <Copy className="w-5 h-5 text-pink-300" />
              <div className="text-left">
                <div>Copiar Código-Fonte para a Área de Transferência</div>
                <div className="text-[11px] text-white/50 font-normal">Para colar no seu editor (VS Code)</div>
              </div>
            </div>
            {copied ? <Check className="w-5 h-5 text-emerald-400" /> : <Copy className="w-5 h-5" />}
          </button>
        </div>

        <div className="p-4 rounded-2xl bg-white/5 border border-white/10 text-xs text-white/70 space-y-2">
          <div className="font-semibold text-white flex items-center gap-1.5">
            <Globe className="w-4 h-4 text-pink-400" />
            <span>Como publicar seu site grátis?</span>
          </div>
          <ol className="list-decimal list-inside space-y-1 text-[11px] text-white/60 leading-relaxed">
            <li>Baixe o arquivo <code className="text-pink-300">index.html</code> acima.</li>
            <li>Acesse a Vercel ou Netlify Drop.</li>
            <li>Arraste o arquivo baixado e seu site estará online em segundos!</li>
          </ol>
        </div>
      </div>
    </div>
  );
};

