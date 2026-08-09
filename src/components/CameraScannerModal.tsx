import React, { useEffect, useRef, useState } from 'react';
import {
  Camera,
  Check,
  FileText,
  Loader2,
  RefreshCw,
  Scan,
  ShieldCheck,
  X
} from 'lucide-react';
import { createDataUrlAttachment } from '../services/attachmentService';
import { UploadedFile } from '../types';

interface CameraScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCapture: (file: UploadedFile) => void;
}

const MAX_CAPTURE_WIDTH = 1280;
const MAX_CAPTURE_HEIGHT = 1280;
const JPEG_QUALITY = 0.72;

export const CameraScannerModal: React.FC<CameraScannerModalProps> = ({
  isOpen,
  onClose,
  onCapture
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [mode, setMode] = useState<'photo' | 'document'>('document');
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isPreparingFile, setIsPreparingFile] = useState(false);

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setIsCameraActive(false);
  };

  const startCamera = async () => {
    stopCamera();
    setCameraError(null);

    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('Este navegador não oferece acesso à câmera.');
      return;
    }

    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      });

      streamRef.current = mediaStream;

      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
        await videoRef.current.play();
      }

      setIsCameraActive(true);
    } catch (error) {
      console.warn('Erro ao acessar a câmera:', error);
      setCameraError(
        'Não foi possível abrir a câmera. Autorize o acesso no navegador e tente novamente.'
      );
    }
  };

  useEffect(() => {
    if (isOpen && !capturedImage) {
      void startCamera();
    } else {
      stopCamera();
    }

    return stopCamera;
  }, [isOpen, capturedImage]);

  const handleClose = () => {
    stopCamera();
    setCapturedImage(null);
    setCameraError(null);
    setIsPreparingFile(false);
    onClose();
  };

  const handleTakeSnapshot = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (!video || !canvas || !isCameraActive || video.videoWidth === 0) {
      setCameraError('A câmera ainda não está pronta para capturar.');
      return;
    }

    const scale = Math.min(
      1,
      MAX_CAPTURE_WIDTH / video.videoWidth,
      MAX_CAPTURE_HEIGHT / video.videoHeight
    );

    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));

    const context = canvas.getContext('2d');
    if (!context) {
      setCameraError('Não foi possível processar a imagem capturada.');
      return;
    }

    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    setCapturedImage(canvas.toDataURL('image/jpeg', JPEG_QUALITY));
    setCameraError(null);
  };

  const handleRetake = () => {
    setCapturedImage(null);
    setCameraError(null);
  };

  const handleConfirm = async () => {
    if (!capturedImage || isPreparingFile) return;

    setIsPreparingFile(true);
    setCameraError(null);

    try {
      const timestamp = Date.now();
      const prefix = mode === 'document' ? 'documento-camera' : 'foto-camera';
      const file = await createDataUrlAttachment({
        name: `${prefix}-${timestamp}.jpg`,
        dataUrl: capturedImage,
        source: 'camera',
        type: 'camera'
      });

      onCapture(file);
      handleClose();
    } catch (error) {
      setCameraError(
        error instanceof Error
          ? error.message
          : 'Não foi possível preparar a captura para envio.'
      );
    } finally {
      setIsPreparingFile(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-xl">
      <div className="relative w-full max-w-lg space-y-5 rounded-[32px] border border-amber-400/20 bg-zinc-950 p-6 text-white shadow-2xl shadow-amber-500/10">
        <div className="flex items-center justify-between border-b border-white/10 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-tr from-amber-500 to-yellow-200 text-black shadow-lg shadow-amber-500/20">
              <Camera className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-bold">Capturar pela câmera</h3>
              <p className="text-xs text-white/60">
                Foto real para análise multimodal da Froc.IA
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            disabled={isPreparingFile}
            aria-label="Fechar câmera"
            className="rounded-full p-2 text-white/70 transition hover:bg-white/10 hover:text-white disabled:opacity-40"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="group relative flex aspect-video items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-black">
          {capturedImage ? (
            <img
              src={capturedImage}
              alt="Prévia da captura da câmera"
              className="h-full w-full object-contain"
            />
          ) : (
            <>
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className={`h-full w-full object-cover ${
                  isCameraActive ? '' : 'hidden'
                }`}
              />
              {!isCameraActive && (
                <div className="space-y-3 p-6 text-center">
                  <Scan className="mx-auto h-12 w-12 animate-pulse text-amber-400" />
                  <p className="mx-auto max-w-xs text-xs text-white/70">
                    {cameraError || 'Abrindo a câmera do dispositivo...'}
                  </p>
                  {cameraError && (
                    <button
                      type="button"
                      onClick={() => void startCamera()}
                      className="rounded-xl border border-amber-400/30 px-4 py-2 text-xs font-bold text-amber-300 transition hover:bg-amber-400/10"
                    >
                      Tentar novamente
                    </button>
                  )}
                </div>
              )}
              {isCameraActive && (
                <div className="pointer-events-none absolute inset-8 flex items-center justify-center rounded-2xl border-2 border-dashed border-amber-400/60">
                  <div className="h-0.5 w-12 animate-pulse bg-amber-300 shadow-lg shadow-amber-500/50" />
                </div>
              )}
            </>
          )}
          <canvas ref={canvasRef} className="hidden" />
        </div>

        {!capturedImage && (
          <div className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/5 p-1 text-xs font-medium">
            <button
              type="button"
              onClick={() => setMode('document')}
              className={`flex-1 rounded-lg py-2 transition-all ${
                mode === 'document'
                  ? 'bg-amber-400 font-bold text-black'
                  : 'text-white/60 hover:text-white'
              }`}
            >
              <span className="flex items-center justify-center gap-1.5">
                <FileText className="h-3.5 w-3.5" /> Documento
              </span>
            </button>
            <button
              type="button"
              onClick={() => setMode('photo')}
              className={`flex-1 rounded-lg py-2 transition-all ${
                mode === 'photo'
                  ? 'bg-amber-400 font-bold text-black'
                  : 'text-white/60 hover:text-white'
              }`}
            >
              <span className="flex items-center justify-center gap-1.5">
                <Camera className="h-3.5 w-3.5" /> Foto livre
              </span>
            </button>
          </div>
        )}

        {capturedImage && (
          <div className="flex items-start gap-2 rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-3.5 text-xs text-emerald-100">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
            <p>
              Captura pronta. O conteúdo e o hash SHA-256 serão validados antes do envio à IA.
            </p>
          </div>
        )}

        {cameraError && capturedImage && (
          <p role="alert" className="text-xs font-medium text-red-300">
            {cameraError}
          </p>
        )}

        <div className="flex items-center justify-end gap-3 pt-2">
          {capturedImage ? (
            <>
              <button
                type="button"
                onClick={handleRetake}
                disabled={isPreparingFile}
                className="flex items-center gap-1.5 rounded-xl border border-white/10 px-4 py-2.5 text-xs font-bold text-white transition hover:bg-white/10 disabled:opacity-40"
              >
                <RefreshCw className="h-4 w-4" /> Tirar outra
              </button>
              <button
                type="button"
                onClick={() => void handleConfirm()}
                disabled={isPreparingFile}
                className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-300 px-5 py-2.5 text-xs font-extrabold text-black shadow-lg shadow-amber-500/20 transition hover:brightness-110 disabled:cursor-wait disabled:opacity-60"
              >
                {isPreparingFile ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Check className="h-4 w-4" />
                )}
                {isPreparingFile ? 'Validando captura...' : 'Anexar captura'}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={handleTakeSnapshot}
              disabled={!isCameraActive}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-amber-500 to-yellow-300 py-3.5 text-xs font-extrabold text-black shadow-xl shadow-amber-500/20 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Camera className="h-4 w-4" /> Capturar agora
            </button>
          )}
        </div>
      </div>
    </div>
  );
};