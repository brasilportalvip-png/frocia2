import React, { useState } from 'react';
import { X, Upload, Camera, Trash2, Check, Loader2, Image as ImageIcon } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { UserProfile } from '../types';

interface AvatarUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: UserProfile;
}

export const AvatarUploadModal: React.FC<AvatarUploadModalProps> = ({
  isOpen,
  onClose,
  user,
}) => {
  const { updateUserProfile } = useAuth();
  const [avatarUrlInput, setAvatarUrlInput] = useState(user.avatarUrl || '');
  const [previewUrl, setPreviewUrl] = useState<string | null>(user.avatarUrl || null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setErrorMsg('Por favor, selecione um arquivo de imagem válido (PNG, JPG, WebP).');
      return;
    }

    if (file.size > 3 * 1024 * 1024) {
      setErrorMsg('A imagem deve ter no máximo 3MB.');
      return;
    }

    setErrorMsg(null);
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setPreviewUrl(dataUrl);
      setAvatarUrlInput(dataUrl);
    };
    reader.readAsDataURL(file);
  };

  const handleSave = async () => {
    setIsSubmitting(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      await updateUserProfile(user.name, avatarUrlInput);
      setSuccessMsg('Foto de perfil atualizada com sucesso!');
      setTimeout(() => {
        onClose();
      }, 1000);
    } catch (err: any) {
      setErrorMsg(err.message || 'Erro ao atualizar avatar.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRemove = async () => {
    setIsSubmitting(true);
    setErrorMsg(null);
    try {
      await updateUserProfile(user.name, '');
      setPreviewUrl(null);
      setAvatarUrlInput('');
      setSuccessMsg('Foto de perfil removida.');
      setTimeout(() => {
        onClose();
      }, 1000);
    } catch (err: any) {
      setErrorMsg(err.message || 'Erro ao remover foto.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xl p-4 animate-in fade-in duration-200">
      <div className="relative w-full max-w-md rounded-[32px] border border-white/20 bg-[#0a0a0d] p-6 shadow-2xl text-white space-y-6">
        <button
          onClick={onClose}
          className="absolute top-5 right-5 text-white/50 hover:text-white p-2 rounded-full glass-button transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="text-center space-y-1">
          <h3 className="text-xl font-black text-white">Alterar Foto de Perfil</h3>
          <p className="text-xs text-white/60">Escolha uma nova imagem ou cole um link direto</p>
        </div>

        {errorMsg && (
          <div className="p-3 rounded-2xl bg-rose-500/20 border border-rose-500/40 text-rose-200 text-xs">
            {errorMsg}
          </div>
        )}

        {successMsg && (
          <div className="p-3 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-200 text-xs flex items-center gap-2">
            <Check className="w-4 h-4 text-emerald-400" />
            <span>{successMsg}</span>
          </div>
        )}

        {/* Preview Container */}
        <div className="flex flex-col items-center justify-center space-y-4">
          <div className="relative group">
            {previewUrl ? (
              <img
                src={previewUrl}
                alt="Avatar Preview"
                referrerPolicy="no-referrer"
                className="w-28 h-28 rounded-full object-cover border-4 border-amber-300/60 shadow-2xl"
              />
            ) : (
              <div className="w-28 h-28 rounded-full bg-gradient-to-br from-amber-200 via-amber-400 to-amber-700 border-4 border-amber-300/60 flex items-center justify-center text-4xl font-black text-black shadow-2xl">
                {user.name.trim().charAt(0).toUpperCase() || 'U'}
              </div>
            )}
          </div>

          <label className="cursor-pointer glass-button px-4 py-2.5 rounded-2xl text-xs font-bold flex items-center gap-2 hover:bg-white/15 transition-all">
            <Upload className="w-4 h-4 text-amber-300" />
            <span>Carregar Foto do Dispositivo</span>
            <input
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              className="hidden"
            />
          </label>
        </div>

        {/* URL Input */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-white/70">Ou cole a URL da imagem (https://...):</label>
          <input
            type="url"
            value={avatarUrlInput}
            onChange={(e) => {
              setAvatarUrlInput(e.target.value);
              setPreviewUrl(e.target.value || null);
            }}
            placeholder="https://exemplo.com/sua-foto.jpg"
            className="w-full glass-input rounded-2xl px-4 py-2.5 text-xs text-white placeholder-white/40 focus:outline-none"
          />
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3 pt-2">
          {previewUrl && (
            <button
              type="button"
              onClick={handleRemove}
              disabled={isSubmitting}
              className="p-3 rounded-2xl glass-button text-rose-300 hover:bg-rose-500/20 transition-all cursor-pointer"
              title="Remover foto atual"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}

          <button
            type="button"
            onClick={handleSave}
            disabled={isSubmitting}
            className="flex-1 py-3 rounded-2xl froc-gold-button font-black text-xs shadow-xl flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
          >
            {isSubmitting ? (
              <Loader2 className="w-4 h-4 animate-spin text-black" />
            ) : (
              <>
                <Check className="w-4 h-4 text-black" />
                <span>Salvar Foto</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
