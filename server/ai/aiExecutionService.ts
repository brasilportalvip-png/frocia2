import { CreditWalletService } from '../services/creditWalletService.js';
import { SafetyService } from './safetyService.js';
import { AIRouter } from './aiRouter.js';
import { ContextBuilder } from './contextBuilder.js';
import { GeminiProvider } from './providers/geminiProvider.js';
import { ExecutionTraceService } from './executionTraceService.js';
import { ModelHealthService } from './modelHealthService.js';
import { CostService } from './costService.js';
import { CitationService } from './citationService.js';
import { ExecutionParams, MessageCitation } from './types/ai.js';
import { adminDb } from '../lib/firebaseAdmin.js';
import { FieldValue } from 'firebase-admin/firestore';
import { FeatureFlagService } from '../services/featureFlagService.js';

export class AIExecutionService {
  /**
   * Executes AI task synchronously with full credit reservation, fallback, and trace lifecycle
   */
  static async execute(
    params: ExecutionParams,
    correlationId: string
  ): Promise<{
    text: string;
    modelUsed: string;
    executionId: string;
    consumedCredits: number;
    citations: MessageCitation[];
    fallbackUsed: boolean;
  }> {
    await FeatureFlagService.assertEnabled('ai_chat');

    if (params.mode === 'image') {
      await FeatureFlagService.assertEnabled(
        'image_generation'
      );
    }

    if (params.mode === 'video') {
      await FeatureFlagService.assertEnabled(
        'video_generation'
      );
    }

    const {
      userId,
      conversationId,
      projectId,
      mode,
      prompt,
      attachments = [],
      systemInstruction,
      responseFormat = 'text',
      idempotencyKey: providedKey,
      knowledgeBaseIds = [],
      modelOverride,
    } = params;

    // 1. Safety Check
    const safety = SafetyService.inspectPrompt(prompt);
    if (!safety.safe) {
      throw new Error(safety.reason || 'Prompt rejeitado por questoes de seguranca.');
    }

    const sanitizedPrompt = SafetyService.sanitizeInput(prompt);

    // Validate conversation existence & ownership if conversationId is provided
    if (adminDb && conversationId) {
      const convSnap = await adminDb.collection('conversations').doc(conversationId).get();
      if (!convSnap.exists || convSnap.data()?.userId !== userId) {
        throw new Error('Conversa não encontrada ou não pertence ao usuário.');
      }
    }

    // 2. Route Model
    const route = AIRouter.route({
      mode,
      prompt: sanitizedPrompt,
      hasImages: attachments.length > 0,
      preferredModel: modelOverride,
    });

    const idempotencyKey = providedKey || `aiexec-${userId}-${Date.now()}`;

    // 3. Reserve Credits
    const reserveResult = await CreditWalletService.reserveCredits({
      userId,
      amount: route.estimatedCredits,
      operation: `Reserva para execução IA (${mode})`,
      idempotencyKey,
    });

    const reservationId = reserveResult.reservationId;

    // 4. Create Execution Trace
    const executionId = await ExecutionTraceService.createTrace({
      userId,
      conversationId: conversationId || null,
      projectId: projectId || null,
      mode,
      selectedModel: route.selectedModel,
      fallbackModels: route.fallbackModels,
      attemptedModels: [route.selectedModel],
      status: 'running',
      promptVersion: 'v1.0.0',
      inputTokens: null,
      outputTokens: null,
      cachedTokens: null,
      estimatedCredits: route.estimatedCredits,
      consumedCredits: null,
      reservationId,
      latencyMs: null,
      fallbackUsed: false,
      correlationId,
      errorCode: null,
      createdAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      completedAt: null,
    });

    // 5. Assemble Context
    const assembled = await ContextBuilder.assemble({
      userId,
      mode,
      prompt: sanitizedPrompt,
      conversationId,
      projectId,
      knowledgeBaseIds,
      systemInstructionOverride: systemInstruction,
    });

    const citations: MessageCitation[] = [];

    // Add RAG Citations
    for (const chunk of assembled.ragChunksUsed) {
      citations.push(CitationService.buildRAGCitationPill(chunk));
    }

    const startTime = Date.now();
    let modelToUse = route.selectedModel;
    let fallbackUsed = false;
    let aiResponseText = '';
    let inputTokens = 0;
    let outputTokens = 0;

    const enableSearchGrounding = mode === 'research' || route.reasonCode === 'mode_research_grounded';

    // 6. Execute with Primary Model and Fallback
    try {
      try {
        const res = await GeminiProvider.generate({
          model: modelToUse,
          systemInstruction: assembled.systemInstruction,
          userMessage: assembled.userMessage,
          attachments,
          responseFormat,
          enableSearchGrounding,
        });

        aiResponseText = res.text;
        inputTokens = res.inputTokens;
        outputTokens = res.outputTokens;

        if (res.groundingMetadata) {
          const webCitations = CitationService.extractSearchGroundingCitations(res.groundingMetadata);
          citations.push(...webCitations);
        }

        ModelHealthService.recordCall(modelToUse, Date.now() - startTime, true);
      } catch (primaryErr: any) {
        console.warn(`⚠️ Primary AI model ${modelToUse} failed: ${primaryErr.message}. Trying fallback...`);
        ModelHealthService.recordCall(modelToUse, Date.now() - startTime, false);

        if (route.fallbackModels.length > 0) {
          modelToUse = route.fallbackModels[0];
          fallbackUsed = true;

          const fbRes = await GeminiProvider.generate({
            model: modelToUse,
            systemInstruction: assembled.systemInstruction,
            userMessage: assembled.userMessage,
            attachments,
            responseFormat,
            enableSearchGrounding,
          });

          aiResponseText = fbRes.text;
          inputTokens = fbRes.inputTokens;
          outputTokens = fbRes.outputTokens;

          if (fbRes.groundingMetadata) {
            const webCitations = CitationService.extractSearchGroundingCitations(fbRes.groundingMetadata);
            citations.push(...webCitations);
          }

          ModelHealthService.recordCall(modelToUse, Date.now() - startTime, true, false, true);
        } else {
          throw primaryErr;
        }
      }
    } catch (execErr: any) {
      // Execution failed: Release Reservation!
      await CreditWalletService.releaseReservation({
        userId,
        reservationId,
        operation: `Estorno por falha na execucao de IA (${execErr.message || 'erro desconhecido'})`,
        idempotencyKey: `rel-${idempotencyKey}`,
      });

      await ExecutionTraceService.updateTrace(executionId, {
        status: 'failed',
        errorCode: execErr.message || 'ai_execution_failed',
        completedAt: new Date().toISOString(),
      });

      throw execErr;
    }

    // 7. Calculate Actual Consumed Credits
    const consumedCredits = CostService.calculateCreditCost(
      modelToUse,
      inputTokens,
      outputTokens
    );

    const latencyMs = Date.now() - startTime;

    // 8. Confirm Credit Consumption
    try {
      await CreditWalletService.confirmConsumption({
        userId,
        reservationId,
        amountConsumed: Math.min(consumedCredits, route.estimatedCredits),
        operation: `Consumo de IA (${mode} - ${modelToUse})`,
        idempotencyKey: `cnf-${idempotencyKey}`,
      });
    } catch (confErr: any) {
      console.error('CRITICAL: AI output delivered but wallet confirmation failed:', confErr);
      // Record in financial_reconciliation_cases
      if (adminDb) {
        await adminDb.collection('financial_reconciliation_cases').add({
          userId,
          reservationId,
          reason: 'wallet_confirmation_failed',
          amountBrl: 0,
          creditsOriginallyGranted: 0,
          consumedCredits,
          correlationId,
          status: 'open',
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
    }

    // 9. Persist messages in conversation if conversationId is set
    if (adminDb && conversationId) {
      try {
        const batch = adminDb.batch();

        const userMsgRef = adminDb.collection('messages').doc(`msg_usr_${executionId}`);
        batch.set(userMsgRef, {
          conversationId,
          userId,
          role: 'user',
          content: prompt,
          attachments: attachments || [],
          executionId,
          createdAt: FieldValue.serverTimestamp(),
        });

        const aiMsgRef = adminDb.collection('messages').doc(`msg_ast_${executionId}`);
        batch.set(aiMsgRef, {
          conversationId,
          userId,
          role: 'assistant',
          content: aiResponseText,
          citations: citations || [],
          executionId,
          model: modelToUse,
          createdAt: FieldValue.serverTimestamp(),
        });

        const convRef = adminDb.collection('conversations').doc(conversationId);
        batch.update(convRef, {
          updatedAt: FieldValue.serverTimestamp(),
        });

        await batch.commit();
      } catch (msgErr: any) {
        console.error('⚠️ Error saving conversation messages in AIExecutionService:', msgErr);
      }
    }

    // 10. Finalize Trace
    await ExecutionTraceService.updateTrace(executionId, {
      status: 'completed',
      inputTokens,
      outputTokens,
      consumedCredits,
      latencyMs,
      fallbackUsed,
      completedAt: new Date().toISOString(),
    });

    return {
      text: aiResponseText,
      modelUsed: modelToUse,
      executionId,
      consumedCredits,
      citations,
      fallbackUsed,
    };
  }
}