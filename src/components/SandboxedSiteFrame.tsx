import React, { useEffect, useMemo, useRef } from 'react';
import { GeneratedSite } from '../types';
import {
  buildSandboxedSiteDocument,
  persistSandboxStorageMessage,
} from '../services/sandboxedSiteStorage';

interface SandboxedSiteFrameProps {
  site: GeneratedSite;
  title: string;
  className?: string;
}

export const SandboxedSiteFrame: React.FC<SandboxedSiteFrameProps> = ({
  site,
  title,
  className,
}) => {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const srcDoc = useMemo(
    () => buildSandboxedSiteDocument(site.html, site.id),
    [site.html, site.id]
  );

  useEffect(() => {
    const receiveStorage = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow) return;
      persistSandboxStorageMessage(event.data, site.id);
    };
    window.addEventListener('message', receiveStorage);
    return () => window.removeEventListener('message', receiveStorage);
  }, [site.id]);

  if (site.professionalBuildId) {
    let published: URL | null = null;
    try { const value = new URL(site.productionUrl || ''); if (value.protocol === 'https:' && !value.username && !value.password) published = value; } catch {}
    return <div className={className} style={{display:'flex',alignItems:'center',justifyContent:'center',padding:24,background:'#0f172a',color:'#fff'}}>
      <div style={{maxWidth:520,textAlign:'center'}}><h2>{published ? site.title : 'Construção profissional em andamento'}</h2><p>{published ? 'Seu projeto está publicado. Abra o endereço para utilizar todos os recursos.' : 'Acompanhe a equipe, os testes e as configurações no painel Variáveis e entrega do projeto.'}</p>{published && <a href={published.href} target="_blank" rel="noopener noreferrer" style={{display:'inline-block',padding:'12px 18px',borderRadius:10,background:'#7c3aed',color:'#fff'}}>Abrir projeto publicado</a>}</div>
    </div>;
  }

  return (
    <iframe
      ref={frameRef}
      srcDoc={srcDoc}
      title={title}
      className={className}
      sandbox="allow-scripts allow-forms"
      referrerPolicy="no-referrer"
    />
  );
};
