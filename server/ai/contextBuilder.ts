import { UserMemory, KnowledgeChunk, AIMode } from './types/ai.js';
import { PromptRegistry } from './promptRegistry.js';
import { MemoryService } from './memoryService.js';
import { RAGService } from './ragService.js';
import { CostService } from './costService.js';

export interface ContextBuilderParams {
  userId: string;
  mode: AIMode;
  prompt: string;
  conversationId?: string | null;
  projectId?: string | null;
  knowledgeBaseIds?: string[];
  systemInstructionOverride?: string;
  recentMessages?: Array<{ role: string; content: string }>;
  maxContextTokens?: number;
}

export interface AssembledContext {
  systemInstruction: string;
  userMessage: string;
  memoriesUsed: UserMemory[];
  ragChunksUsed: KnowledgeChunk[];
  tokenCountEstimate: number;
}

export class ContextBuilder {
  static async assemble(params: ContextBuilderParams): Promise<AssembledContext> {
    const {
      userId,
      mode,
      prompt,
      conversationId,
      projectId,
      knowledgeBaseIds,
      systemInstructionOverride,
      recentMessages = [],
      maxContextTokens = 16000,
    } = params;

    // 1. Base System Instruction
    let baseInstruction = systemInstructionOverride || (await PromptRegistry.getActivePrompt(mode));

    // 2. Retrieve User Memories
    const memories = await MemoryService.getActiveMemories(userId, projectId, conversationId);
    let memorySection = '';
    if (memories.length > 0) {
      memorySection = '\n\n[MEMÓRIAS E PREFERÊNCIAS DO USUÁRIO]:\n' +
        memories.map((m) => `- ${m.category.toUpperCase()}: ${m.content}`).join('\n');
    }

    // 3. Retrieve RAG Knowledge Chunks
    const ragResults = await RAGService.retrieveRelevantChunks(userId, prompt, knowledgeBaseIds, 3);
    const ragChunks = ragResults.map((r) => r.chunk);
    let ragSection = '';
    if (ragChunks.length > 0) {
      ragSection = '\n\n[BASE DE CONHECIMENTO & DOCUMENTOS INDEXADOS]:\n' +
        ragChunks.map((c, i) => `--- Trecho ${i + 1} ---\n${c.text}`).join('\n\n');
    }

    // Combine system instructions
    const fullSystemInstruction = `${baseInstruction}${memorySection}${ragSection}`;

    // 4. Formulate recent conversation history text if present
    let historyText = '';
    if (recentMessages.length > 0) {
      const formatted = recentMessages
        .slice(-6) // Keep last 6 turns for context
        .map((m) => `${m.role === 'user' ? 'Usuário' : 'Assistente'}: ${m.content}`)
        .join('\n');
      historyText = `[HISTÓRICO DA CONVERSA]:\n${formatted}\n\n[NOVA MENSAGEM DO USUÁRIO]:\n${prompt}`;
    } else {
      historyText = prompt;
    }

    // 5. Token Limit Check and Truncation if needed
    const tokenEstimate = CostService.estimateTokenCount(fullSystemInstruction + historyText);

    return {
      systemInstruction: fullSystemInstruction,
      userMessage: historyText,
      memoriesUsed: memories,
      ragChunksUsed: ragChunks,
      tokenCountEstimate: tokenEstimate,
    };
  }
}
