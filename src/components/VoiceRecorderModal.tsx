import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  Loader2,
  Mic,
  Pause,
  Play,
  RefreshCw,
  ShieldCheck,
  Square,
  X
} from 'lucide-react';
import { createDataUrlAttachment } from '../services/attachmentService';
import { UploadedFile } from '../types';

interface VoiceRecorderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCaptureAudio: (file: UploadedFile) => void;
}

const MAX_RECORDING_SECONDS = 60;

function selectAudioMimeType(): string | undefined {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus'
  ];

  return candidates.find((type) => MediaRecorder.isTypeSupported(type));
}

function extensionForMimeType(mimeType: string): string {
  if (mimeType.includes('mp4')) return 'm4a';
  if (mimeType.includes('ogg')) return 'ogg';
  return 'webm';
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Não foi possível ler a gravação.'));
      }
    };
    reader.onerror = () => reject(new Error('Não foi possível ler a gravação.'));
    const normalizedMimeType =
      blob.type.split(';')[0].trim() || 'audio/webm';
    const normalizedBlob = new Blob([blob], {
      type: normalizedMimeType
    });
    reader.readAsDataURL(normalizedBlob);
  });
}

export const VoiceRecorderModal: React.FC<VoiceRecorderModalProps> = ({
  isOpen,
  onClose,
  onCaptureAudio
}) => {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [isPlayingPreview, setIsPlayingPreview] = useState(false);
  const [isPreparingFile, setIsPreparingFile] = useState(false);
  const [recorderError, setRecorderError] = useState<string | null>(null);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);

  const stopTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const stopMediaStream = () => {
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
  };

  const revokeAudioUrl = () => {
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
  };

  const stopPreview = () => {
    if (audioPlayerRef.current) {
      audioPlayerRef.current.pause();
      audioPlayerRef.current.currentTime = 0;
      audioPlayerRef.current = null;
    }
    setIsPlayingPreview(false);
  };

  const resetRecording = () => {
    stopTimer();
    stopPreview();

    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      recorder.stop();
    }

    mediaRecorderRef.current = null;
    stopMediaStream();
    revokeAudioUrl();
    audioChunksRef.current = [];
    setIsRecording(false);
    setRecordingSeconds(0);
    setAudioUrl(null);
    setAudioBlob(null);
    setRecorderError(null);
    setIsPreparingFile(false);
  };

  useEffect(() => {
    if (!isOpen) {
      resetRecording();
    }

    return () => {
      stopTimer();
      stopPreview();
      stopMediaStream();
      revokeAudioUrl();
    };
  }, [isOpen]);

  const handleStartRecording = async () => {
    setRecorderError(null);

    if (!navigator.mediaDevices?.getUserMedia || !globalThis.MediaRecorder) {
      setRecorderError('Este navegador não oferece gravação de áudio.');
      return;
    }

    try {
      stopPreview();
      revokeAudioUrl();
      setAudioUrl(null);
      setAudioBlob(null);
      setRecordingSeconds(0);
      audioChunksRef.current = [];

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1
        }
      });
      mediaStreamRef.current = stream;

      const mimeType = selectAudioMimeType();
      const recorder = new MediaRecorder(stream, {
        ...(mimeType ? { mimeType } : {}),
        audioBitsPerSecond: 64_000
      });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onerror = () => {
        stopTimer();
        stopMediaStream();
        setIsRecording(false);
        setRecorderError('O navegador interrompeu a gravação de áudio.');
      };

      recorder.onstop = () => {
        stopTimer();
        stopMediaStream();
        setIsRecording(false);

        const recordedType = recorder.mimeType || mimeType || 'audio/webm';
        const blob = new Blob(audioChunksRef.current, { type: recordedType });

        if (blob.size === 0) {
          setRecorderError('A gravação ficou vazia. Tente novamente.');
          return;
        }

        revokeAudioUrl();
        const previewUrl = URL.createObjectURL(blob);
        audioUrlRef.current = previewUrl;
        setAudioBlob(blob);
        setAudioUrl(previewUrl);
      };

      recorder.start(1000);
      setIsRecording(true);

      timerRef.current = setInterval(() => {
        setRecordingSeconds((current) => {
          const next = current + 1;

          if (next >= MAX_RECORDING_SECONDS) {
            stopTimer();
            if (mediaRecorderRef.current?.state === 'recording') {
              mediaRecorderRef.current.stop();
            }
          }

          return Math.min(next, MAX_RECORDING_SECONDS);
        });
      }, 1000);
    } catch (error) {
      stopTimer();
      stopMediaStream();
      setIsRecording(false);
      console.warn('Erro ao acessar o microfone:', error);
      setRecorderError(
        'Não foi possível acessar o microfone. Autorize o acesso no navegador e tente novamente.'
      );
    }
  };

  const handleStopRecording = () => {
    stopTimer();
    const recorder = mediaRecorderRef.current;

    if (recorder?.state === 'recording') {
      recorder.stop();
    }
  };

  const togglePlayPreview = async () => {
    if (!audioUrl) return;

    if (!audioPlayerRef.current) {
      const player = new Audio(audioUrl);
      player.onended = () => setIsPlayingPreview(false);
      player.onerror = () => {
        setIsPlayingPreview(false);
        setRecorderError('Não foi possível reproduzir a prévia do áudio.');
      };
      audioPlayerRef.current = player;
    }

    if (isPlayingPreview) {
      audioPlayerRef.current.pause();
      setIsPlayingPreview(false);
      return;
    }

    try {
      await audioPlayerRef.current.play();
      setIsPlayingPreview(true);
    } catch {
      setRecorderError('O navegador bloqueou a reprodução da prévia.');
    }
  };

  const handleConfirm = async () => {
    if (!audioBlob || isPreparingFile) return;

    setIsPreparingFile(true);
    setRecorderError(null);

    try {
      const dataUrl = await blobToDataUrl(audioBlob);
      const extension = extensionForMimeType(audioBlob.type);
      const file = await createDataUrlAttachment({
        name: `gravacao-voz-${Date.now()}.${extension}`,
        dataUrl,
        source: 'microphone',
        type: 'audio'
      });

      onCaptureAudio(file);
      resetRecording();
      onClose();
    } catch (error) {
      setRecorderError(
        error instanceof Error
          ? error.message
          : 'Não foi possível preparar o áudio para envio.'
      );
    } finally {
      setIsPreparingFile(false);
    }
  };

  const handleClose = () => {
    resetRecording();
    onClose();
  };

  const formatTimer = (totalSeconds: number) => {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds
      .toString()
      .padStart(2, '0')}`;
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-xl">
      <div className="relative w-full max-w-md space-y-6 rounded-[32px] border border-amber-400/20 bg-zinc-950 p-6 text-white shadow-2xl shadow-amber-500/10">
        <div className="flex items-center justify-between border-b border-white/10 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-tr from-amber-500 to-yellow-200 text-black shadow-lg shadow-amber-500/20">
              <Mic className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-bold">Gravar áudio de voz</h3>
              <p className="text-xs text-white/60">
                Até {MAX_RECORDING_SECONDS} segundos para análise da Froc.IA
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            disabled={isPreparingFile}
            aria-label="Fechar gravador"
            className="rounded-full p-2 text-white/70 transition hover:bg-white/10 hover:text-white disabled:opacity-40"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="relative flex flex-col items-center justify-center space-y-4 overflow-hidden rounded-2xl border border-white/10 bg-black/50 p-6">
          <div className="my-2 flex h-16 items-center gap-1.5">
            {[40, 70, 30, 90, 60, 100, 50, 80, 45, 85, 35, 65, 95, 50].map(
              (height, index) => (
                <div
                  key={index}
                  className={`w-1.5 rounded-full transition-all duration-300 ${
                    isRecording
                      ? 'animate-pulse bg-gradient-to-t from-amber-600 to-yellow-200'
                      : audioUrl
                        ? 'bg-amber-300/80'
                        : 'bg-white/10'
                  }`}
                  style={{
                    height: isRecording
                      ? `${Math.max(
                          15,
                          (height * (Math.sin(recordingSeconds + index) + 1.2)) / 2
                        )}%`
                      : `${height}%`
                  }}
                />
              )
            )}
          </div>

          <div className="font-mono text-2xl font-bold tracking-widest text-amber-300">
            {formatTimer(recordingSeconds)}
          </div>

          {isRecording && (
            <span className="inline-flex animate-pulse items-center gap-1.5 rounded-full border border-rose-500/30 bg-rose-500/20 px-3 py-1 text-xs font-semibold text-rose-300">
              <span className="h-2 w-2 rounded-full bg-rose-500" />
              Gravando pelo microfone...
            </span>
          )}
        </div>

        {audioBlob && (
          <div className="flex items-start gap-2 rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-3.5 text-xs text-emerald-100">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
            <p>
              Áudio real capturado. O tamanho e o hash SHA-256 serão validados antes do envio.
            </p>
          </div>
        )}

        {recorderError && (
          <p role="alert" className="text-xs font-medium text-red-300">
            {recorderError}
          </p>
        )}

        <div className="flex items-center justify-between gap-3 pt-2">
          {!isRecording && !audioUrl && (
            <button
              type="button"
              onClick={() => void handleStartRecording()}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-amber-500 to-yellow-300 py-3.5 text-xs font-extrabold text-black shadow-xl shadow-amber-500/20 transition hover:brightness-110"
            >
              <Mic className="h-4 w-4" /> Iniciar gravação
            </button>
          )}

          {isRecording && (
            <button
              type="button"
              onClick={handleStopRecording}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-rose-600 py-3.5 text-xs font-extrabold text-white shadow-xl shadow-rose-600/30 transition hover:bg-rose-500"
            >
              <Square className="h-4 w-4 fill-current" /> Parar gravação
            </button>
          )}

          {audioUrl && !isRecording && (
            <>
              <button
                type="button"
                onClick={resetRecording}
                disabled={isPreparingFile}
                className="flex items-center gap-1.5 rounded-xl border border-white/10 px-3 py-2.5 text-xs font-bold transition hover:bg-white/10 disabled:opacity-40"
              >
                <RefreshCw className="h-4 w-4" /> Regravar
              </button>
              <button
                type="button"
                onClick={() => void togglePlayPreview()}
                disabled={isPreparingFile}
                className="flex items-center gap-1.5 rounded-xl border border-white/20 bg-white/10 px-3 py-2.5 text-xs font-bold transition hover:bg-white/20 disabled:opacity-40"
              >
                {isPlayingPreview ? (
                  <Pause className="h-4 w-4" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
                {isPlayingPreview ? 'Pausar' : 'Ouvir'}
              </button>
              <button
                type="button"
                onClick={() => void handleConfirm()}
                disabled={isPreparingFile}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-300 py-2.5 text-xs font-extrabold text-black shadow-lg shadow-amber-500/20 transition hover:brightness-110 disabled:cursor-wait disabled:opacity-60"
              >
                {isPreparingFile ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Check className="h-4 w-4" />
                )}
                {isPreparingFile ? 'Validando...' : 'Anexar áudio'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};