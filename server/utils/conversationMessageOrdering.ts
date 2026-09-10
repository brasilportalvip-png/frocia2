type ConversationMessageRecord = {
  id: string;
  role?: unknown;
  executionId?: unknown;
  messageOrder?: unknown;
  createdAt?: unknown;
};

function timestampMillis(value: unknown): number {
  if (!value) return 0;
  if (typeof (value as { toMillis?: () => number }).toMillis === 'function') {
    return (value as { toMillis: () => number }).toMillis();
  }
  if (typeof (value as { toDate?: () => Date }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate().getTime();
  }
  const parsed = new Date(value as string | number | Date).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function roleOrder(message: ConversationMessageRecord): number {
  if (typeof message.messageOrder === 'number') return message.messageOrder;
  return message.role === 'assistant' ? 1 : 0;
}

export function orderConversationMessages<T extends ConversationMessageRecord>(
  messages: T[]
): T[] {
  return messages.slice().sort((left, right) => {
    const timeDifference = timestampMillis(left.createdAt) - timestampMillis(right.createdAt);
    if (timeDifference !== 0) return timeDifference;

    const sameExecution =
      typeof left.executionId === 'string' &&
      left.executionId.length > 0 &&
      left.executionId === right.executionId;
    if (sameExecution) {
      const sequenceDifference = roleOrder(left) - roleOrder(right);
      if (sequenceDifference !== 0) return sequenceDifference;
    }

    return left.id.localeCompare(right.id);
  });
}
