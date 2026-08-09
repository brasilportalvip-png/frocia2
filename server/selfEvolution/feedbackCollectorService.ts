import crypto from 'crypto';
import { FeedbackEvent } from './selfEvolutionTypes.js';
import { RedactionService } from './redactionService.js';
import { PromptInjectionDefense } from './promptInjectionDefense.js';

export class FeedbackCollectorService {
  private static feedbackList: FeedbackEvent[] = [];

  static recordFeedback(params: {
    userId: string;
    projectId?: string;
    type: 'explicit' | 'implicit';
    category: 'positive' | 'negative' | 'wrong_answer' | 'security_issue' | 'rephrased' | 'execution_failed' | 'cancelled';
    details: string;
    correlationId?: string;
  }): FeedbackEvent {
    const rawSanitized = RedactionService.redactSensitiveData(params.details);
    const sanitizedContent = PromptInjectionDefense.sanitizeUntrustedText(rawSanitized);

    const event: FeedbackEvent = {
      id: `fb-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
      userId: params.userId,
      projectId: params.projectId,
      type: params.type,
      category: params.category,
      details: params.details,
      sanitizedContent,
      correlationId: params.correlationId,
      createdAt: new Date().toISOString(),
    };

    this.feedbackList.unshift(event);
    return event;
  }

  static getFeedbackList(limit: number = 50): FeedbackEvent[] {
    return this.feedbackList.slice(0, limit);
  }
}
