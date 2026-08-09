import React, { useState } from 'react';
import { Copy, Check, Edit3, FileCode2 } from 'lucide-react';
import { GeneratedSite } from '../types';

interface CodeViewerProps {
  site: GeneratedSite | null;
  onUpdateHtml: (newHtml: string) => void;
}

export const CodeViewer: React.FC<CodeViewerProps> = ({ site, onUpdateHtml }) => {
  const [copied, setCopied] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editedCode, setEditedCode] = useState(site?.html || '');

  React.useEffect(() => {
    if (site?.html) {
      setEditedCode(site.html);
    }
  }, [site?.html]);

  const handleCopyCode = () => {
    if (!site?.html) return;
    navigator.clipboard.writeText(site.html);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleApplyEdits = () => {
    onUpdateHtml(editedCode);
    setIsEditing(false);
  };

  if (!site) {
    return (
      <div className="flex-1 bg-transparent flex items-center justify-center p-8 text-center text-white/50 text-sm">
        Nenhum código para exibir. Gere um projeto primeiro.
      </div>
    );
  }

  return (
    <div id="froc-code-viewer" className="flex-1 bg-transparent flex flex-col h-full overflow-hidden select-none text-white">
      {/* Code Viewer Actions Header */}
      <div className="h-12 bg-white/5 border-b border-white/10 px-4 flex items-center justify-between shrink-0 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <FileCode2 className="w-4 h-4 text-pink-400" />
          <span className="text-xs font-bold text-white">index.html</span>
          <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-white/10 text-white/60 font-mono">
            {editedCode.length} caracteres
          </span>
        </div>

        <div className="flex items-center gap-2">
          {isEditing ? (
            <button
              onClick={handleApplyEdits}
              className="px-3.5 py-1.5 rounded-full bg-gradient-to-r from-purple-600 to-pink-600 text-white font-bold text-xs shadow-lg flex items-center gap-1.5"
            >
              <Check className="w-3.5 h-3.5" />
              <span>Aplicar Alterações</span>
            </button>
          ) : (
            <button
              onClick={() => setIsEditing(true)}
              className="px-3.5 py-1.5 rounded-full glass-button text-white text-xs font-medium flex items-center gap-1.5"
            >
              <Edit3 className="w-3.5 h-3.5 text-pink-300" />
              <span>Editar Código</span>
            </button>
          )}

          <button
            onClick={handleCopyCode}
            className="px-3.5 py-1.5 rounded-full glass-button text-white text-xs font-medium flex items-center gap-1.5"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-emerald-400 font-bold">Copiado!</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                <span>Copiar HTML</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Code Body Area */}
      <div className="flex-1 overflow-auto p-4 font-mono text-xs text-white/90 leading-relaxed custom-scrollbar bg-black/40">
        {isEditing ? (
          <textarea
            value={editedCode}
            onChange={(e) => setEditedCode(e.target.value)}
            className="w-full h-full glass-input rounded-2xl p-4 text-pink-300 font-mono text-xs focus:outline-none resize-none leading-relaxed"
          />
        ) : (
          <pre className="whitespace-pre-wrap break-all text-white/90 select-text p-4 glass-panel rounded-2xl">
            <code>{site.html}</code>
          </pre>
        )}
      </div>
    </div>
  );
};

