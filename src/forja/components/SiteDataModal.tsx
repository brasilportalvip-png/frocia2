import React, { useEffect, useMemo, useState } from 'react';
import { ClipboardList, X } from 'lucide-react';
import type { SiteVariableField } from '../utils/siteVariables';
import { validateSiteValue } from '../utils/siteVariables';

interface SiteDataModalProps {
  fields: SiteVariableField[];
  values: Record<string, string>;
  /** Construção ainda em andamento (o site continua sendo feito com a janela aberta ou fechada). */
  building: boolean;
  onSave: (values: Record<string, string>) => void;
  onClose: () => void;
}

/**
 * Janela "Dados do site": WhatsApp, endereço, redes, links... Abre sozinha durante a construção
 * quando o site precisa desses dados. Preencher é opcional: fechar não para a construção, e
 * dá para voltar depois pelo botão "Dados do site".
 */
export const SiteDataModal: React.FC<SiteDataModalProps> = ({ fields, values, building, onSave, onClose }) => {
  const [draft, setDraft] = useState<Record<string, string>>(values);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    // Campos novos (a IA pode declarar mais durante a construção) entram sem apagar o que foi digitado.
    setDraft((prev) => {
      const next = { ...prev };
      for (const f of fields) if (next[f.key] === undefined) next[f.key] = values[f.key] ?? '';
      return next;
    });
  }, [fields, values]);

  const errors = useMemo(() => {
    const out: Record<string, string> = {};
    for (const f of fields) {
      const e = validateSiteValue(f, draft[f.key] || '');
      if (e) out[f.key] = e;
    }
    return out;
  }, [fields, draft]);
  const hasErrors = Object.keys(errors).length > 0;

  const save = () => {
    setTouched(true);
    if (hasErrors) return;
    const clean: Record<string, string> = {};
    for (const f of fields) clean[f.key] = (draft[f.key] || '').trim();
    onSave(clean);
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="forja-site-data-title">
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111723] text-slate-900 dark:text-slate-100 shadow-2xl">
        <div className="flex items-center justify-between gap-3 px-5 pt-4">
          <h2 id="forja-site-data-title" className="font-display font-semibold text-base flex items-center gap-2">
            <ClipboardList className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            Dados do seu site
          </h2>
          <button type="button" onClick={onClose} aria-label="Fechar" className="p-1.5 rounded-md text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="px-5 pt-2 text-sm text-slate-600 dark:text-slate-300">
          {building ? 'Seu site já está sendo construído. ' : ''}
          Preencha agora o que já tiver — o que ficar em branco não aparece no site. Você pode fechar e completar depois no botão <strong>Dados do site</strong>.
        </p>
        <form
          className="mt-3 flex-1 space-y-3 overflow-y-auto px-5 pb-2"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          {fields.map((f) => {
            const common = {
              id: `forja-var-${f.key}`,
              value: draft[f.key] ?? '',
              placeholder: f.hint || undefined,
              onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft((d) => ({ ...d, [f.key]: e.target.value })),
              className:
                'w-full rounded-lg border bg-white dark:bg-slate-900 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 ' +
                (touched && errors[f.key] ? 'border-red-400' : 'border-slate-300 dark:border-slate-700'),
            };
            return (
              <div key={f.key}>
                <label htmlFor={common.id} className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  {f.label}
                </label>
                {f.type === 'textarea' ? (
                  <textarea {...common} rows={3} />
                ) : (
                  <input {...common} type={f.type === 'tel' ? 'tel' : f.type === 'email' ? 'email' : f.type === 'url' ? 'url' : 'text'} inputMode={f.type === 'tel' ? 'tel' : undefined} />
                )}
                {touched && errors[f.key] && <p className="mt-1 text-xs text-red-500">{errors[f.key]}</p>}
              </div>
            );
          })}
          <p className="pt-1 text-xs text-slate-500">Esses dados aparecem no site público. Nunca coloque senhas ou chaves secretas.</p>
          <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
        </form>
        <div className="flex justify-end gap-2 border-t border-slate-200 dark:border-slate-800 px-5 py-3">
          <button type="button" onClick={onClose} className="rounded-lg px-3.5 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800">
            Preencher depois
          </button>
          <button type="button" onClick={save} className="rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-700">
            Salvar no site
          </button>
        </div>
      </div>
    </div>
  );
};
