import type { ChatMode } from '../types';
import { hasEngineeringOrder, explicitOwnTarget } from '../../shared/engineeringIntent';

export function requestMode(text: string, override?: ChatMode): ChatMode {
  if (override) return override;
  if (hasEngineeringOrder(text) && (explicitOwnTarget(text) || /https?:\/\/github\.com\//i.test(text))) return 'Programação';
  const value = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const creation = /^(?:(?:froc(?:\.?ia)?|por favor|pode|voce pode|quero que voce|preciso que voce)[\s,.:]+){0,3}(?:crie|cria|criar|gere|gera|gerar|faca|fazer|desenhe|produza|construa|construir|desenvolva|desenvolver|monte)\b/.test(value) ||
    /^(?:eu\s+)?(?:quero|preciso|gostaria)(?:\s+de)?\s+(?:(?:que voce|criar|fazer|gerar|desenvolver)\s+)?(?:um|uma|crie|gere|faca|produza|construa|desenvolva)\b/.test(value);
  const project = value.search(/\b(?:sites?|websites?|aplicativos?|aplicacao|apps?|webapps?|sistemas?|loja virtual|pagina web|landing page)\b/);
  const media = value.search(/\b(?:videos?|imagens?|imagem|fotos?|fotografia|ilustracao|arte|animacao)\b/);
  if (creation && project >= 0 && (media < 0 || project < media)) return 'Criador de projetos';
  if (creation && /\b(?:video|videos|vidio|vidios|animacao|animacoes|filme|filmes|clipe|clipes|reel|reels|short|shorts)\b/.test(value)) return 'Vídeo';
  if (creation && /\b(?:imagem|imagens|imagen|imagenes|image|images|foto|fotos|fotografia|ilustracao|arte|desenho|desenhos|figura|figuras)\b/.test(value)) return 'Imagem';
  if (/^(?:froc[\s,.:]*)?(?:pesquise|investigue|faca uma pesquisa)\b/.test(value)) return 'Pesquisa';
  return 'Inteligente';
}

export interface ProjectGithubTarget {
  installationId: number;
  owner: string;
  repository: string;
}

export interface CreationDelivery {
  githubTarget?: ProjectGithubTarget;
  autoPublish?: boolean;
}
