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
