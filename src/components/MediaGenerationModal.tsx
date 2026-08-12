import React, {
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Download,
  Image as ImageIcon,
  Loader2,
  Sparkles,
  Square,
  Video,
  X,
  Zap,
} from 'lucide-react';
import {
  GeneratedImage,
  ImageAspectRatio,
  MediaGenerationService,
  VideoAspectRatio,
  VideoJob,
  VideoQuality,
} from '../services/mediaGenerationService';

interface MediaGenerationModalProps {
  isOpen: boolean;
  mode: 'image' | 'video';
  initialPrompt: string;
  onClose: () => void;
  onCreditsChanged?: () => void;
}

const VIDEO_QUALITY_OPTIONS: Array<{
  id: VideoQuality;
  name: string;
  description: string;
  credits: number;
}> = [
  {
    id: 'lite',
    name: 'Lite',
    description: 'Prévia rápida para ideias e testes',
    credits: 30,
  },
  {
    id: 'fast',
    name: 'Fast',
    description: 'Equilíbrio entre velocidade e qualidade',
    credits: 46,
  },
  {
    id: 'standard',
    name: 'Standard',
    description: 'Qualidade máxima disponível',
    credits: 120,
  },
];

export const MediaGenerationModal: React.FC<
  MediaGenerationModalProps
> = ({
  isOpen,
  mode,
  initialPrompt,
  onClose,
  onCreditsChanged,
}) => {
  const [prompt, setPrompt] =
    useState(initialPrompt);

  const [imageAspectRatio, setImageAspectRatio] =
    useState<ImageAspectRatio>('1:1');

  const [videoAspectRatio, setVideoAspectRatio] =
    useState<VideoAspectRatio>('16:9');

  const [videoQuality, setVideoQuality] =
    useState<VideoQuality>('lite');

  const [durationSeconds, setDurationSeconds] =
    useState(5);

  const [isGenerating, setIsGenerating] =
    useState(false);

  const [generatedImage, setGeneratedImage] =
    useState<GeneratedImage | null>(null);

  const [videoJob, setVideoJob] =
    useState<VideoJob | null>(null);

  const [errorMessage, setErrorMessage] =
    useState<string | null>(null);

  const abortControllerRef =
    useRef<AbortController | null>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setPrompt(initialPrompt);
    setGeneratedImage(null);
    setVideoJob(null);
    setErrorMessage(null);
    setIsGenerating(false);
  }, [isOpen, initialPrompt, mode]);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  if (!isOpen) {
    return null;
  }

  const selectedVideoOption =
    VIDEO_QUALITY_OPTIONS.find(
      (option) => option.id === videoQuality
    ) || VIDEO_QUALITY_OPTIONS[0];

  const handleGenerateImage = async () => {
    if (!prompt.trim()) {
      setErrorMessage(
        'Descreva a imagem que deseja criar.'
      );
      return;
    }

    setIsGenerating(true);
    setErrorMessage(null);
    setGeneratedImage(null);

    try {
      const image =
        await MediaGenerationService.generateImage({
          prompt: prompt.trim(),
          aspectRatio: imageAspectRatio,
        });

      setGeneratedImage(image);
      onCreditsChanged?.();
    } catch (error: any) {
      setErrorMessage(
        error?.message ||
        'Não foi possível gerar a imagem.'
      );
    } finally {
      setIsGenerating(false);
    }
  };

  const handleGenerateVideo = async () => {
    if (!prompt.trim()) {
      setErrorMessage(
        'Descreva o vídeo que deseja criar.'
      );
      return;
    }

    setIsGenerating(true);
    setErrorMessage(null);
    setVideoJob(null);

    const abortController =
      new AbortController();

    abortControllerRef.current =
      abortController;

    try {
      const startedJob =
        await MediaGenerationService.startVideo({
          prompt: prompt.trim(),
          aspectRatio: videoAspectRatio,
          durationSeconds,
          quality: videoQuality,
        });

      setVideoJob(startedJob);

      const completedJob =
        await MediaGenerationService.waitForVideo(
          startedJob.jobId,
          {
            signal: abortController.signal,
            onProgress: (updatedJob) => {
              setVideoJob(updatedJob);
            },
          }
        );

      setVideoJob(completedJob);
      onCreditsChanged?.();
    } catch (error: any) {
      if (error?.name !== 'AbortError') {
        setErrorMessage(
          error?.message ||
          'Não foi possível gerar o vídeo.'
        );
      }
    } finally {
      abortControllerRef.current = null;
      setIsGenerating(false);
    }
  };

  const handleCancelVideo = async () => {
    abortControllerRef.current?.abort();

    if (!videoJob?.jobId) {
      setIsGenerating(false);
      return;
    }

    try {
      const result =
        await MediaGenerationService.cancelVideo(
          videoJob.jobId
        );

      setVideoJob((current) =>
        current
          ? {
              ...current,
              status: 'cancelled',
              progress: 0,
            }
          : null
      );

      setErrorMessage(result.message);
      onCreditsChanged?.();
    } catch (error: any) {
      setErrorMessage(
        error?.message ||
        'Não foi possível cancelar o vídeo.'
      );
    } finally {
      setIsGenerating(false);
    }
  };

  const handleClose = () => {
    if (isGenerating) {
      setErrorMessage(
        'Cancele a geração antes de fechar esta janela.'
      );
      return;
    }

    onClose();
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/85 p-4 backdrop-blur-xl">
      <div className="custom-scrollbar relative max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-[32px] border border-white/15 bg-[#08080b] p-5 text-white shadow-2xl md:p-7">
        <button
          type="button"
          onClick={handleClose}
          className="absolute right-5 top-5 rounded-full border border-white/10 bg-white/5 p-2 text-white/60 transition hover:bg-white/10 hover:text-white"
          aria-label="Fechar"
        >
          <X className="h-4 w-4" />
        </button>

        <header className="mb-6 flex items-start gap-4 pr-12">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-purple-500 to-pink-500 shadow-lg shadow-purple-500/20">
            {mode === 'image' ? (
              <ImageIcon className="h-6 w-6" />
            ) : (
              <Video className="h-6 w-6" />
            )}
          </div>

          <div>
            <div className="mb-1 flex items-center gap-2">
              <h2 className="text-xl font-black md:text-2xl">
                {mode === 'image'
                  ? 'Criação de Imagem com IA'
                  : 'Criação de Vídeo com IA'}
              </h2>

              <span className="rounded-full border border-amber-400/25 bg-amber-400/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-300">
                Provedor real
              </span>
            </div>

            <p className="text-xs leading-relaxed text-white/50">
              {mode === 'image'
                ? 'Descreva com detalhes a cena, iluminação, enquadramento, materiais, cores e atmosfera.'
                : 'Descreva a cena, os movimentos, a câmera, a iluminação e a evolução temporal do vídeo.'}
            </p>
          </div>
        </header>

        <div className="space-y-5">
          <div>
            <label className="mb-2 block text-xs font-bold text-white/70">
              Prompt criativo
            </label>

            <textarea
              value={prompt}
              onChange={(event) =>
                setPrompt(event.target.value)
              }
              disabled={isGenerating}
              maxLength={5000}
              rows={5}
              placeholder={
                mode === 'image'
                  ? 'Exemplo: retrato fotográfico ultrarrealista, iluminação cinematográfica suave...'
                  : 'Exemplo: plano cinematográfico de uma cidade futurista ao anoitecer, câmera avançando lentamente...'
              }
              className="w-full resize-none rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm leading-relaxed text-white outline-none transition placeholder:text-white/25 focus:border-purple-400/50 disabled:opacity-60"
            />

            <div className="mt-1 text-right text-[10px] text-white/30">
              {prompt.length}/5000
            </div>
          </div>

          {mode === 'image' ? (
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-white/70">
                  Proporção da imagem
                </label>

                <span className="flex items-center gap-1 text-[10px] font-bold text-amber-300">
                  <Zap className="h-3 w-3" />
                  18 créditos
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    ['1:1', 'Quadrada'],
                    ['4:3', 'Clássica'],
                    ['16:9', 'Panorâmica'],
                  ] as Array<
                    [ImageAspectRatio, string]
                  >
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    disabled={isGenerating}
                    onClick={() =>
                      setImageAspectRatio(value)
                    }
                    className={`rounded-xl border px-3 py-3 text-xs font-bold transition ${
                      imageAspectRatio === value
                        ? 'border-purple-400/60 bg-purple-500/15 text-purple-200'
                        : 'border-white/10 bg-white/[0.03] text-white/55 hover:border-white/25'
                    }`}
                  >
                    <span className="block">
                      {value}
                    </span>
                    <span className="mt-0.5 block text-[9px] font-normal opacity-60">
                      {label}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          ) : (
            <>
              <section className="space-y-3">
                <label className="text-xs font-bold text-white/70">
                  Qualidade e consumo
                </label>

                <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                  {VIDEO_QUALITY_OPTIONS.map(
                    (option) => (
                      <button
                        key={option.id}
                        type="button"
                        disabled={isGenerating}
                        onClick={() =>
                          setVideoQuality(option.id)
                        }
                        className={`rounded-2xl border p-4 text-left transition ${
                          videoQuality === option.id
                            ? 'border-purple-400/60 bg-purple-500/15'
                            : 'border-white/10 bg-white/[0.03] hover:border-white/25'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-black">
                            {option.name}
                          </span>
                          <span className="text-xs font-bold text-amber-300">
                            {option.credits}
                          </span>
                        </div>

                        <p className="mt-2 text-[10px] leading-relaxed text-white/45">
                          {option.description}
                        </p>
                      </button>
                    )
                  )}
                </div>
              </section>

              <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-2 block text-xs font-bold text-white/70">
                    Proporção
                  </label>

                  <select
                    value={videoAspectRatio}
                    disabled={isGenerating}
                    onChange={(event) =>
                      setVideoAspectRatio(
                        event.target
                          .value as VideoAspectRatio
                      )
                    }
                    className="w-full rounded-xl border border-white/10 bg-black/50 px-4 py-3 text-xs text-white outline-none focus:border-purple-400/50"
                  >
                    <option value="16:9">
                      16:9 — Paisagem
                    </option>
                    <option value="1:1">
                      1:1 — Quadrado
                    </option>
                  </select>
                </div>

                <div>
                  <label className="mb-2 block text-xs font-bold text-white/70">
                    Duração
                  </label>

                  <select
                    value={durationSeconds}
                    disabled={isGenerating}
                    onChange={(event) =>
                      setDurationSeconds(
                        Number(event.target.value)
                      )
                    }
                    className="w-full rounded-xl border border-white/10 bg-black/50 px-4 py-3 text-xs text-white outline-none focus:border-purple-400/50"
                  >
                    <option value={5}>
                      5 segundos
                    </option>
                    <option value={6}>
                      6 segundos
                    </option>
                    <option value={7}>
                      7 segundos
                    </option>
                    <option value={8}>
                      8 segundos
                    </option>
                  </select>
                </div>
              </section>
            </>
          )}

          {errorMessage && (
            <div className="flex items-start gap-3 rounded-2xl border border-rose-400/30 bg-rose-500/10 p-4 text-xs text-rose-200">
              <AlertCircle className="h-5 w-5 shrink-0 text-rose-400" />
              <span>{errorMessage}</span>
            </div>
          )}

          {generatedImage && (
            <section className="space-y-4 rounded-3xl border border-emerald-400/25 bg-emerald-500/5 p-4">
              <div className="flex items-center gap-2 text-sm font-bold text-emerald-300">
                <CheckCircle2 className="h-5 w-5" />
                Imagem criada com sucesso
              </div>

              <div className="overflow-hidden rounded-2xl border border-white/10 bg-black">
                <img
                  src={generatedImage.url}
                  alt={generatedImage.prompt}
                  className="max-h-[520px] w-full object-contain"
                />
              </div>

              <button
                type="button"
                onClick={() =>
                  MediaGenerationService.downloadImage(
                    generatedImage
                  )
                }
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-3 text-xs font-black text-black transition hover:bg-emerald-400"
              >
                <Download className="h-4 w-4" />
                Baixar imagem em PNG
              </button>
            </section>
          )}

          {videoJob && (
            <section className="space-y-4 rounded-3xl border border-cyan-400/25 bg-cyan-500/5 p-4">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-cyan-200">
                  {videoJob.status === 'completed'
                    ? 'Vídeo concluído'
                    : videoJob.status === 'cancelled'
                      ? 'Vídeo cancelado'
                      : 'Processando vídeo'}
                </span>

                <span className="font-mono text-white/50">
                  {videoJob.progress}%
                </span>
              </div>

              <div className="h-2 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-purple-500 transition-all duration-500"
                  style={{
                    width: `${videoJob.progress}%`,
                  }}
                />
              </div>

              {videoJob.videoUrl && (
                <video
                  src={videoJob.videoUrl}
                  controls
                  playsInline
                  className="w-full rounded-2xl border border-white/10 bg-black"
                />
              )}
            </section>
          )}

          <footer className="flex flex-col-reverse gap-3 border-t border-white/10 pt-5 sm:flex-row sm:justify-between">
            <button
              type="button"
              onClick={handleClose}
              disabled={isGenerating}
              className="rounded-xl border border-white/10 px-5 py-3 text-xs font-bold text-white/60 transition hover:bg-white/5 hover:text-white disabled:opacity-40"
            >
              Fechar
            </button>

            {isGenerating && mode === 'video' ? (
              <button
                type="button"
                onClick={handleCancelVideo}
                className="flex items-center justify-center gap-2 rounded-xl bg-rose-500 px-5 py-3 text-xs font-black text-white transition hover:bg-rose-400"
              >
                <Square className="h-4 w-4 fill-current" />
                Cancelar e devolver créditos
              </button>
            ) : (
              <button
                type="button"
                disabled={
                  isGenerating ||
                  prompt.trim().length === 0
                }
                onClick={
                  mode === 'image'
                    ? handleGenerateImage
                    : handleGenerateVideo
                }
                className="flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 px-6 py-3 text-xs font-black text-white shadow-lg transition hover:from-purple-500 hover:to-pink-500 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {isGenerating ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}

                {isGenerating
                  ? mode === 'image'
                    ? 'Criando imagem real...'
                    : `Renderizando ${selectedVideoOption.name}...`
                  : mode === 'image'
                    ? 'Gerar imagem — 18 créditos'
                    : `Gerar vídeo — ${selectedVideoOption.credits} créditos`}
              </button>
            )}
          </footer>
        </div>
      </div>
    </div>
  );
};