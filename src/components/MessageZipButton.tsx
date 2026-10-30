import React, { useMemo, useState } from 'react';
import { extractFileBlocks, shouldOfferZip } from '../services/codeBlocksParse';
import { downloadFilesAsZip } from '../services/codeBlocksZip';

interface MessageZipButtonProps {
  text: string;
}

/** Oferece o download dos blocos de codigo da resposta como uma pasta ZIP. */
export const MessageZipButton: React.FC<MessageZipButtonProps> = ({ text }) => {
  const files = useMemo(() => extractFileBlocks(text), [text]);
  const [error, setError] = useState<string | null>(null);

  if (!shouldOfferZip(files)) return null;

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => {
          try {
            setError(null);
            downloadFilesAsZip(files);
          } catch {
            setError('Não foi possível gerar o ZIP.');
          }
        }}
        className="froc-pop froc-lift froc-shine froc-glow rounded-lg border border-amber-300/30 bg-amber-300/10 px-3 py-2 text-xs font-semibold text-amber-200 hover:bg-amber-300/20"
      >
        Baixar ZIP ({files.length} {files.length === 1 ? 'arquivo' : 'arquivos'})
      </button>
      {error && <span className="text-xs text-red-300">{error}</span>}
    </div>
  );
};
