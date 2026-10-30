import React from 'react';

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

/** Evita tela branca: mostra uma mensagem clara e um botão para recarregar. */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    console.error('Falha ao exibir a tela:', error);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div role="alert" className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center text-white">
        <p className="max-w-sm text-sm text-white/80">
          Não foi possível carregar esta tela. Isso costuma acontecer logo depois de uma atualização do site.
        </p>
        <button
          onClick={() => window.location.reload()}
          className="min-h-11 rounded-xl bg-purple-600 px-5 text-sm font-bold text-white hover:bg-purple-500"
        >
          Recarregar
        </button>
      </div>
    );
  }
}
