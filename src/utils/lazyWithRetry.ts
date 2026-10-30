import { lazy, type ComponentType } from 'react';

const RELOAD_FLAG = 'froc_chunk_reload_once';

/**
 * lazy() que se recupera de "chunk antigo" depois de um deploy: recarrega a página uma única vez
 * (a flag evita laço de recarregamento) e, se ainda falhar, deixa o ErrorBoundary mostrar a falha.
 */
export function lazyWithRetry<T extends ComponentType<any>>(factory: () => Promise<{ default: T }>) {
  return lazy(async () => {
    try {
      const module = await factory();
      try {
        sessionStorage.removeItem(RELOAD_FLAG);
      } catch (storageError) {
        console.warn('sessionStorage indisponível:', storageError);
      }
      return module;
    } catch (error) {
      let alreadyReloaded = true;
      try {
        alreadyReloaded = sessionStorage.getItem(RELOAD_FLAG) === '1';
        if (!alreadyReloaded) sessionStorage.setItem(RELOAD_FLAG, '1');
      } catch (storageError) {
        console.warn('sessionStorage indisponível:', storageError);
      }
      if (!alreadyReloaded) {
        window.location.reload();
        return new Promise<{ default: T }>(() => undefined);
      }
      throw error;
    }
  });
}
