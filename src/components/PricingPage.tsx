import React, { useState, useEffect } from 'react';
import {
  Zap,
  Check,
  QrCode,
  Copy,
  CheckCircle2,
  Clock,
  CreditCard,
  Sparkles,
  HelpCircle,
  X,
  AlertCircle,
  Loader2
} from 'lucide-react';
import { UserProfile, CreditPackage } from '../types';
import { getIdToken } from '../lib/firebase';

interface PricingPageProps {
  user: UserProfile;
  onRefreshProfile?: () => void;
}

export const PricingPage: React.FC<PricingPageProps> = ({ user, onRefreshProfile }) => {
  const [packages, setPackages] = useState<CreditPackage[]>([]);
  const [isLoadingPackages, setIsLoadingPackages] = useState(true);
  const [selectedPkg, setSelectedPkg] = useState<CreditPackage | null>(null);
  
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [isStartingCheckout, setIsStartingCheckout] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  // Active Payment State from Mercado Pago
  const [activePayment, setActivePayment] = useState<{
    paymentDocumentId: string;
    providerPaymentId?: string;
    qrCode?: string;
    qrCodeBase64?: string;
    checkoutUrl?: string;
    amountBrl: number;
    totalCredits: number;
    status: string;
    credited?: boolean;
  } | null>(null);

  const [pixCopied, setPixCopied] = useState(false);

  // Fetch Credit Packages from Backend
  useEffect(() => {
    async function loadPackages() {
      try {
        const res = await fetch('/api/credits/packages');
        if (res.ok) {
          const data = await res.json();
          if (data.packages && Array.isArray(data.packages)) {
            setPackages(data.packages.map((p: any) => ({
              id: p.id,
              name: p.name,
              credits: p.credits,
              priceBrl: p.priceBrl,
              bonus: p.bonusCredits || 0,
              badge: p.badge,
              popular: p.popular,
              features: p.features || [],
            })));
            return;
          }
        }
      } catch (err) {
        console.warn('Erro ao carregar pacotes do backend:', err);
      } finally {
        setIsLoadingPackages(false);
      }
    }
    loadPackages();
  }, []);

  // Poll Payment Status
  useEffect(() => {
    if (!isCheckoutOpen || !activePayment || activePayment.status === 'approved' || activePayment.credited) {
      return;
    }

    const intervalId = setInterval(async () => {
      try {
        const token = await getIdToken();
        const res = await fetch(`/api/payments/${activePayment.paymentDocumentId}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });

        if (res.ok) {
          const data = await res.json();
          if (data.status === 'approved' || data.credited) {
            setActivePayment((prev) => prev ? { ...prev, status: 'approved', credited: true } : null);
            if (onRefreshProfile) {
              onRefreshProfile();
            }
          } else {
            setActivePayment((prev) => prev ? { ...prev, status: data.status } : null);
          }
        }
      } catch (err) {
        console.warn('Erro ao polling status do pagamento:', err);
      }
    }, 3000);

    return () => clearInterval(intervalId);
  }, [isCheckoutOpen, activePayment, onRefreshProfile]);

  const handleStartCheckout = async (pkg: CreditPackage) => {
    setSelectedPkg(pkg);
    setIsCheckoutOpen(true);
    setIsStartingCheckout(true);
    setCheckoutError(null);
    setActivePayment(null);

    try {
      const token = await getIdToken();
      if (!token) {
        throw new Error('Você precisa estar autenticado para realizar uma compra.');
      }

      const res = await fetch('/api/payments/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          packageId: pkg.id,
          paymentMethod: 'pix',
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Erro ao comunicar com o servidor de pagamento.');
      }

      setActivePayment(data);
    } catch (err: any) {
      console.error('Erro no checkout:', err);
      setCheckoutError(err.message || 'Falha ao gerar cobrança Pix.');
    } finally {
      setIsStartingCheckout(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto bg-slate-950 text-white p-6 md:p-10 custom-scrollbar">
      <div className="max-w-7xl mx-auto space-y-12">
        {/* Header */}
        <div className="text-center max-w-3xl mx-auto space-y-3">
          <span className="text-xs font-bold text-amber-400 uppercase tracking-widest bg-amber-500/10 px-4 py-1.5 rounded-full border border-amber-500/20">
            Mercado Pago & Pix Real em Produção
          </span>
          <h1 className="text-3xl sm:text-5xl font-black text-white">
            Pacotes de Créditos Froc.IA
          </h1>
          <p className="text-sm text-white/60">
            Adquira créditos para utilizar com inteligência artificial multimodal. Sem mensalidades veladas. Pague apenas pelo que usar.
          </p>

          {/* Current Balance */}
          <div className="inline-flex items-center gap-3 px-6 py-3 rounded-2xl glass-panel border border-white/20 mt-4 shadow-xl">
            <Zap className="w-5 h-5 text-amber-400 animate-pulse" />
            <div className="text-left">
              <span className="text-xs text-white/50 block">Saldo Atual na Carteira:</span>
              <span className="text-xl font-bold text-white">{user.creditsRemaining} Créditos Disponíveis</span>
            </div>
          </div>
        </div>

        {/* Packages Grid */}
        {isLoadingPackages ? (
          <div className="flex items-center justify-center py-20 text-white/50 gap-3">
            <Loader2 className="w-6 h-6 animate-spin text-purple-400" />
            <span>Carregando pacotes oficiais do servidor...</span>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 items-stretch">
            {packages.map((pkg) => (
              <div
                key={pkg.id}
                className={`p-6 rounded-[32px] glass-panel border flex flex-col justify-between relative transition-all duration-300 hover:-translate-y-1 ${
                  pkg.popular
                    ? 'border-purple-500 bg-purple-950/20 shadow-2xl shadow-purple-500/20'
                    : 'border-white/10'
                }`}
              >
                {pkg.badge && (
                  <span className="absolute -top-3.5 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-gradient-to-r from-purple-600 to-pink-600 text-white text-[10px] font-extrabold uppercase tracking-wider shadow-lg">
                    {pkg.badge}
                  </span>
                )}

                <div className="space-y-6">
                  <div>
                    <h3 className="text-xl font-extrabold text-white">{pkg.name}</h3>
                    <div className="mt-4 flex items-baseline gap-1">
                      <span className="text-3xl font-black text-white">R$ {pkg.priceBrl}</span>
                      <span className="text-xs text-white/50">/ pagamento único</span>
                    </div>
                    <div className="mt-2 text-xs text-pink-300 font-bold flex items-center gap-1">
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>{pkg.bonus > 0 ? `${pkg.credits} + ${pkg.bonus} Créditos Bônus` : `${pkg.credits} Créditos`}</span>
                    </div>
                  </div>

                  <ul className="space-y-3 text-xs text-white/80 border-t border-white/10 pt-4">
                    {pkg.features.map((feat, idx) => (
                      <li key={idx} className="flex items-center gap-2">
                        <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                        <span>{feat}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <button
                  onClick={() => handleStartCheckout(pkg)}
                  className="w-full mt-8 py-3.5 rounded-2xl bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white font-extrabold text-xs shadow-lg transition-all flex items-center justify-center gap-2"
                >
                  <CreditCard className="w-4 h-4" />
                  <span>Comprar via Pix</span>
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Cost Reference Table */}
        <div className="p-8 rounded-[32px] glass-panel border border-white/10 max-w-4xl mx-auto space-y-6">
          <div className="flex items-center gap-3">
            <HelpCircle className="w-6 h-6 text-pink-400" />
            <h3 className="text-xl font-bold text-white">Tabela Oficial de Consumo de Créditos</h3>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 text-xs">
            <div className="p-4 rounded-2xl bg-white/5 border border-white/10 space-y-1">
              <span className="text-white/50 block">Pergunta Simples</span>
              <span className="text-lg font-bold text-emerald-400">3 a 5 Créditos</span>
            </div>
            <div className="p-4 rounded-2xl bg-white/5 border border-white/10 space-y-1">
              <span className="text-white/50 block">Conversa Inteligente</span>
              <span className="text-lg font-bold text-emerald-400">5 Créditos</span>
            </div>
            <div className="p-4 rounded-2xl bg-white/5 border border-white/10 space-y-1">
              <span className="text-white/50 block">Análise Profunda / Pesquisa</span>
              <span className="text-lg font-bold text-cyan-400">10 a 18 Créditos</span>
            </div>
            <div className="p-4 rounded-2xl bg-white/5 border border-white/10 space-y-1">
              <span className="text-white/50 block">Geração / Edição de Imagem</span>
              <span className="text-lg font-bold text-pink-400">18 Créditos</span>
            </div>
            <div className="p-4 rounded-2xl bg-white/5 border border-white/10 space-y-1">
              <span className="text-white/50 block">Geração de Vídeo (Lite / Fast / Std)</span>
              <span className="text-lg font-bold text-purple-400">30 / 46 / 120+ Créditos</span>
            </div>
            <div className="p-4 rounded-2xl bg-white/5 border border-white/10 space-y-1">
              <span className="text-white/50 block">Edição / Refatoração de Código</span>
              <span className="text-lg font-bold text-purple-400">40 a 60 Créditos</span>
            </div>
            <div className="p-4 rounded-2xl bg-white/5 border border-white/10 space-y-1 sm:col-span-2 md:col-span-3">
              <span className="text-white/50 block">Criação de Site / Landing Page Profissional</span>
              <span className="text-lg font-bold text-amber-400">250 a 300 Créditos</span>
            </div>
          </div>
        </div>
      </div>

      {/* Mercado Pago Real Pix Modal */}
      {isCheckoutOpen && selectedPkg && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xl flex items-center justify-center p-4">
          <div className="w-full max-w-md glass-panel rounded-[32px] p-6 shadow-2xl border border-white/20 text-white space-y-6 relative">
            <button
              onClick={() => setIsCheckoutOpen(false)}
              className="absolute top-5 right-5 text-white/50 hover:text-white p-2 rounded-full glass-button"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="text-center space-y-2">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-cyan-400 to-blue-600 text-white flex items-center justify-center mx-auto shadow-lg">
                <QrCode className="w-6 h-6" />
              </div>
              <h3 className="text-xl font-bold">Pagamento Oficial Mercado Pago</h3>
              <p className="text-xs text-white/60">
                {selectedPkg.name} — Total: <span className="font-bold text-white">R$ {selectedPkg.priceBrl},00</span>
              </p>
            </div>

            {isStartingCheckout ? (
              <div className="py-12 text-center space-y-3">
                <Loader2 className="w-8 h-8 text-cyan-400 animate-spin mx-auto" />
                <p className="text-xs text-white/70">Gerando cobrança Pix oficial no Mercado Pago...</p>
              </div>
            ) : checkoutError ? (
              <div className="p-4 rounded-2xl bg-rose-500/20 border border-rose-500/40 text-center space-y-2 text-rose-300 text-xs">
                <AlertCircle className="w-6 h-6 mx-auto text-rose-400" />
                <p className="font-bold">{checkoutError}</p>
                <button
                  onClick={() => handleStartCheckout(selectedPkg)}
                  className="mt-2 px-4 py-2 rounded-xl bg-rose-500 hover:bg-rose-600 text-white font-bold"
                >
                  Tentar Novamente
                </button>
              </div>
            ) : activePayment?.status === 'approved' || activePayment?.credited ? (
              <div className="p-6 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 text-center space-y-3">
                <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto animate-bounce" />
                <h4 className="text-lg font-bold text-emerald-300">Pagamento Aprovado!</h4>
                <p className="text-xs text-white/80">
                  Seus créditos foram creditados com sucesso em sua carteira no servidor.
                </p>
                <button
                  onClick={() => setIsCheckoutOpen(false)}
                  className="w-full py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs"
                >
                  Concluir
                </button>
              </div>
            ) : activePayment ? (
              <div className="space-y-4">
                {/* Official Base64 QR Code */}
                {activePayment.qrCodeBase64 ? (
                  <div className="p-3 bg-white rounded-2xl w-48 h-48 mx-auto flex items-center justify-center shadow-xl">
                    <img
                      src={`data:image/jpeg;base64,${activePayment.qrCodeBase64}`}
                      alt="Pix QR Code Mercado Pago"
                      className="w-full h-full object-contain"
                    />
                  </div>
                ) : (
                  <div className="p-4 bg-white/10 rounded-2xl text-center text-xs text-white/60">
                    Utilize a chave 'Copia e Cola' abaixo no aplicativo do seu banco.
                  </div>
                )}

                {/* Pix Copia e Cola */}
                {activePayment.qrCode && (
                  <div className="p-3 rounded-2xl bg-black/40 border border-white/10 flex items-center justify-between text-xs font-mono">
                    <span className="truncate max-w-[240px] text-white/60">{activePayment.qrCode}</span>
                    <button
                      onClick={() => {
                        if (activePayment.qrCode) {
                          navigator.clipboard.writeText(activePayment.qrCode);
                          setPixCopied(true);
                          setTimeout(() => setPixCopied(false), 2000);
                        }
                      }}
                      className="p-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-[11px] font-bold flex items-center gap-1 shrink-0"
                    >
                      {pixCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{pixCopied ? 'Copiado!' : 'Copiar'}</span>
                    </button>
                  </div>
                )}

                <div className="flex items-center justify-center gap-2 text-xs text-amber-300 pt-2">
                  <Clock className="w-4 h-4 animate-spin" />
                  <span>Aguardando confirmação em tempo real pelo Mercado Pago...</span>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
};
