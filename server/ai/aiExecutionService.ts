import { CreditWalletService } from '../services/creditWalletService.js';
import { SafetyService } from './safetyService.js';
import { AIRequestOrchestrator } from './requestOrchestrator.js';
import { ContextBuilder } from './contextBuilder.js';
import { GeminiProvider } from './providers/geminiProvider.js';
import { ExecutionTraceService } from './executionTraceService.js';
import { ModelHealthService } from './modelHealthService.js';
import { CostService } from './costService.js';
import { CitationService } from './citationService.js';
import {
  ExecutionParams,
  KnowledgeChunk,
  MessageCitation,
} from './types/ai.js';
import { adminDb } from '../lib/firebaseAdmin.js';
import { FieldValue } from 'firebase-admin/firestore';
import { FeatureFlagService } from '../services/featureFlagService.js';
import { ModelRegistry } from './modelRegistry.js';
import { ExecutionAbortRegistry } from './executionAbortRegistry.js';
import { ResearchEvidenceService } from './researchEvidenceService.js';
import { ConversationContextService } from './conversationContextService.js';
import { MemoryService } from './memoryService.js';
import { recordOperationalEventBestEffort } from '../observability/operationalTelemetryRuntime.js';

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
    evidence: {
      researchStatus: string;
      ragStatus: string;
      sourceCount: number;
      sourceDomains: string[];
    };
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
      tenantId = `user:${userId}`,
      userDisplayName,
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

    if (projectId) {
      await MemoryService.assertScopeAccess(userId, tenantId, 'project', projectId);
    }
    if (conversationId) {
      await MemoryService.assertScopeAccess(
        userId,
        tenantId,
        'conversation',
        conversationId
      );
    }

    // Validate conversation existence & ownership if conversationId is provided
    if (adminDb && conversationId) {
      const convSnap = await adminDb.collection('conversations').doc(conversationId).get();
      if (!convSnap.exists || convSnap.data()?.userId !== userId) {
        throw new Error('Conversa não encontrada ou não pertence ao usuário.');
      }
    }

    // 2. Classify, authorize tools and route the request
    const plan = AIRequestOrchestrator.plan({
      mode,
      prompt: sanitizedPrompt,
      hasImages: attachments.some(
        (attachment) => attachment.type === 'image'
      ),
      hasFiles: attachments.length > 0,
      requestedTools: params.tools,
      knowledgeBaseIds,
      preferredModel: modelOverride
    });
    const route = plan.route;

    const idempotencyKey = providedKey || `aiexec-${userId}-${Date.now()}`;

    // 3. Reserve Credits
    const reserveResult = await CreditWalletService.reserveCredits({
      userId,
      amount: route.estimatedCredits,
      operation: `Reserva para execução IA (${mode})`,
      idempotencyKey,
    });

    const reservationId = reserveResult.reservationId;
    let executionId: string | null = null;
    let modelToUse = route.selectedModel;
    let fallbackUsed = false;
    let aiResponseText = '';
    let inputTokens = 0;
    let outputTokens = 0;
    let startTime = Date.now();
    const citations: MessageCitation[] = [];
    let ragChunksUsed: KnowledgeChunk[] = [];
    let contextTruncated = false;
    let omittedHistoryCount = 0;
    const enableSearchGrounding =
      plan.classification.requiresSearch ||
      route.reasonCode === 'mode_research_grounded';

    try {
      // 4. Create Execution Trace
      executionId = await ExecutionTraceService.createTrace({
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
        requestDomain:
          plan.classification.domain,
        requestComplexity:
          plan.classification.complexity,
        requestSensitivity:
          plan.classification.sensitivity,
        requiresSearch:
          plan.classification.requiresSearch,
        toolsRequested: plan.tools.map(
          (tool) => tool.name
        ),
      });








const abortSignal =
  ExecutionAbortRegistry.register(executionId);

const abortFromRequest = () => {
  ExecutionAbortRegistry.cancel(
    executionId!,
    'Conexão encerrada pelo cliente.'
  );
};

if (params.abortSignal?.aborted) {
  abortFromRequest();
} else {
  params.abortSignal?.addEventListener(
    'abort',
    abortFromRequest,
    { once: true }
  );
}










      // 5. Assemble Context
      const conversationContext = await ConversationContextService.load({
        userId,
        tenantId,
        conversationId,
      });
      const assembled = await ContextBuilder.assemble({
        userId,
        tenantId,
        userDisplayName,
        mode,
        prompt: sanitizedPrompt,
        conversationId,
        projectId,
        knowledgeBaseIds,
        systemInstructionOverride: systemInstruction,
        requestPolicy: plan.systemPolicy,
        recentMessages: conversationContext.recentMessages,
        conversationSummary: conversationContext,
      });

      ragChunksUsed = assembled.ragChunksUsed;
      contextTruncated = assembled.contextTruncated;
      omittedHistoryCount = assembled.omittedHistoryCount;

      // Add RAG Citations
      for (const chunk of assembled.ragChunksUsed) {
        citations.push(CitationService.buildRAGCitationPill(chunk));
      }

      startTime = Date.now();
      // 6. Execute with Primary Model and Fallback
try {
  const primaryModelConfig =
    ModelRegistry.getModel(modelToUse);

  const res = await GeminiProvider.generate({
          model: modelToUse,
          systemInstruction: assembled.systemInstruction,
          userMessage: assembled.userMessage,
          attachments,
          responseFormat,
          enableSearchGrounding,
abortSignal,
timeoutMs: primaryModelConfig.timeoutMs,
maxRetries: primaryModelConfig.maxRetries,
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


const fallbackModelConfig =
  ModelRegistry.getModel(modelToUse);




          const fbRes = await GeminiProvider.generate({
            model: modelToUse,
            systemInstruction: assembled.systemInstruction,
            userMessage: assembled.userMessage,
            attachments,
            responseFormat,
            enableSearchGrounding,
abortSignal,
timeoutMs: fallbackModelConfig.timeoutMs,
maxRetries: fallbackModelConfig.maxRetries,
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
  if (executionId) {
    ExecutionAbortRegistry.clear(executionId);
  }

  // Execution failed: Release Reservation!
      try {
  await CreditWalletService.releaseReservation({
    userId,
    reservationId,
    operation: `Estorno por falha na execucao de IA (${execErr.message || 'erro desconhecido'})`,
    idempotencyKey: `rel-${idempotencyKey}`,
  });
} catch (releaseError) {
  console.warn(
    'A reserva já estava liberada ou o estorno falhou:',
    releaseError
  );
}

      if (executionId) {
        await ExecutionTraceService.updateTrace(executionId, {
          status: 'failed',
          errorCode: execErr.message || 'ai_execution_failed',
          completedAt: new Date().toISOString(),
        });
      }

      await recordOperationalEventBestEffort({
        category: 'ai',
        operation: `ai.${mode}`,
        resource: 'ai-execution',
        status: 'error',
        correlationId,
        traceId: executionId,
        tenantId,
        userId,
        projectId: projectId || null,
        durationMs: Math.max(0, Date.now() - startTime),
        errorCode: execErr?.code || execErr?.name || 'ai_execution_failed',
        model: modelToUse,
      });

      throw execErr;
   }

const mergedCitations = CitationService.mergeCitations(
  citations.filter(
    (citation) => citation.sourceType === 'web'
  ),
  citations.filter(
    (citation) =>
      citation.sourceType === 'knowledge_base'
  )
);

citations.splice(
  0,
  citations.length,
  ...mergedCitations
);

const evidence = ResearchEvidenceService.finalize({
  text: aiResponseText,
  citations,
  requiresSearch: enableSearchGrounding,
  sensitivity: plan.classification.sensitivity,
  knowledgeBaseRequested:
    knowledgeBaseIds.length > 0,
  ragChunksUsed,
});

aiResponseText = evidence.text;

if (executionId) {
  ExecutionAbortRegistry.clear(executionId);
}

// 7. Calculate Actual Consumed Credits
const consumedCredits = CostService.calculateCreditCost(
  modelToUse,
  inputTokens,
  outputTokens,
  plan.tools.length > 0,
  plan.classification.requiresSearch,
  mode
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
          tenantId,
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
          tenantId,
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
      researchEvidenceStatus:
        evidence.researchStatus,
      ragEvidenceStatus: evidence.ragStatus,
      sourceCount: evidence.sourceCount,
      sourceDomains: evidence.sourceDomains,
      contextTruncated,
      omittedHistoryCount,
      completedAt: new Date().toISOString(),
    });

    await recordOperationalEventBestEffort({
      category: 'ai',
      operation: `ai.${mode}`,
      resource: 'ai-execution',
      status: 'success',
      correlationId,
      traceId: executionId,
      tenantId,
      userId,
      projectId: projectId || null,
      durationMs: latencyMs,
      inputTokens,
      outputTokens,
      cachedTokens: null,
      costCredits: consumedCredits,
      attempts: fallbackUsed ? 2 : 1,
      model: modelToUse,
    });

    return {
      text: aiResponseText,
      modelUsed: modelToUse,
      executionId,
      consumedCredits,
      citations,
      fallbackUsed,
      evidence: {
        researchStatus: evidence.researchStatus,
        ragStatus: evidence.ragStatus,
        sourceCount: evidence.sourceCount,
        sourceDomains: evidence.sourceDomains,
      },
    };
  }
}
