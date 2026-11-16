import React, { useMemo, useState } from 'react';
import { Check, Copy, FileCode2, FileText } from 'lucide-react';
import { buildProductionBundleFiles } from '../utils/projectPackager';

interface CodeExplorerProps {
  projectName: string;
  files: Record<string, string>;
  standaloneHtml?: string;
  activeFilePath: string;
  onSelectFile: (path: string) => void;
  onUpdateFile: (path: string, content: string) => void;
}

export const CodeExplorer: React.FC<CodeExplorerProps> = ({
  projectName,
  files,
  standaloneHtml,
  activeFilePath,
  onSelectFile,
  onUpdateFile,
}) => {
  const [copied, setCopied] = useState(false);

  const allFiles = useMemo(() => {
    return buildProductionBundleFiles(projectName, files, standaloneHtml);
  }, [projectName, files, standaloneHtml]);

  const fileList = useMemo(() => {
    const priority = [
      'src/App.tsx',
      'src/main.tsx',
      'src/index.css',
      'index.html',
    ];
    return Object.keys(allFiles).sort((a, b) => {
      const ia = priority.indexOf(a);
      const ib = priority.indexOf(b);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      const aIsSrc = a.startsWith('src/');
      const bIsSrc = b.startsWith('src/');
      if (aIsSrc && !bIsSrc) return -1;
      if (!aIsSrc && bIsSrc) return 1;
      return a.localeCompare(b);
    });
  }, [allFiles]);

  const resolvedPath =
    allFiles[activeFilePath] !== undefined ? activeFilePath : fileList[0] || '';

  const content = allFiles[resolvedPath] ?? '';
  const isSourceFile = files[resolvedPath] !== undefined;
  const lineCount = content ? content.split('\n').length : 0;
  const byteSize = new Blob([content]).size;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      // Clipboard blocked
    }
  };

  if (fileList.length === 0) {
    return (
      <div className="h-full w-full flex flex-col items-center justify-center p-8 text-center bg-slate-50 dark:bg-[#0B0F17]">
        <div className="max-w-md space-y-2">
          <FileCode2 className="w-8 h-8 text-slate-400 mx-auto" />
          <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
            Nenhum arquivo gerado ainda
          </h2>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Assim que o site for criado, todos os componentes React, TypeScript e configurações de deploy aparecerão aqui.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full flex bg-white dark:bg-[#0B0F17] overflow-hidden">
      {/* File Tree Sidebar */}
      <div className="w-60 shrink-0 border-r border-slate-200 dark:border-slate-800/90 bg-slate-50/70 dark:bg-[#0E131D] flex flex-col">
        <div className="px-3 py-2.5 border-b border-slate-200 dark:border-slate-800/90 text-xs font-semibold text-slate-600 dark:text-slate-400">
          Arquivos do Projeto ({fileList.length})
        </div>
        <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5">
          {fileList.map((filePath) => {
            const active = filePath === resolvedPath;
            const isCode = /\.(tsx?|jsx?|css|html)$/i.test(filePath);
            return (
              <button
                key={filePath}
                type="button"
                onClick={() => onSelectFile(filePath)}
                className={`w-full px-2.5 py-2 rounded-md flex items-center justify-between gap-2 text-left text-xs transition-colors ${
                  active
                    ? 'bg-blue-600/10 dark:bg-blue-500/15 text-blue-700 dark:text-blue-300 font-medium'
                    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200/50 dark:hover:bg-slate-800/60'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  {isCode ? (
                    <FileCode2 className="w-3.5 h-3.5 shrink-0 opacity-80" />
                  ) : (
                    <FileText className="w-3.5 h-3.5 shrink-0 opacity-60" />
                  )}
                  <span className="font-mono truncate">{filePath}</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Code Viewer / Editor */}
      <div className="flex-1 flex flex-col min-w-0 bg-white dark:bg-[#0B0F17]">
        <div className="h-10 shrink-0 px-4 border-b border-slate-200 dark:border-slate-800/90 flex items-center justify-between gap-4 bg-slate-50/40 dark:bg-[#0E131D]/60">
          <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400 min-w-0">
            <span className="font-mono font-medium text-slate-900 dark:text-slate-100 truncate">
              {resolvedPath}
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums whitespace-nowrap">
              {lineCount} linhas
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums whitespace-nowrap">
              {(byteSize / 1024).toFixed(1)} KB
            </span>
            {!isSourceFile && (
              <>
                <span aria-hidden="true">·</span>
                <span className="text-slate-500 dark:text-slate-400 whitespace-nowrap">
                  Gerado para deploy
                </span>
              </>
            )}
          </div>

          <button
            type="button"
            onClick={handleCopy}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded border border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                <span>Copiado</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                <span>Copiar</span>
              </>
            )}
          </button>
        </div>

        <div className="flex-1 relative overflow-hidden">
          {isSourceFile ? (
            <textarea
              value={content}
              onChange={(e) => onUpdateFile(resolvedPath, e.target.value)}
              spellCheck={false}
              aria-label={`Editor de código para ${resolvedPath}`}
              className="w-full h-full p-4 font-mono text-[13px] leading-6 bg-transparent text-slate-800 dark:text-slate-200 outline-none resize-none overflow-auto"
            />
          ) : (
            <pre className="w-full h-full p-4 font-mono text-[13px] leading-6 text-slate-800 dark:text-slate-200 overflow-auto">
              <code>{content}</code>
            </pre>
          )}
        </div>
      </div>
    </div>
  );
};
