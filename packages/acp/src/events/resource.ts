import type { ACPEventBase } from '../envelope';

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export interface CostBreakdown {
  total: number;
  input: number;
  output: number;
  currency: string;
}

export interface TokenUsageEvent extends ACPEventBase {
  type: 'resource:token_usage';
  messageId?: string;
  delta: TokenUsage;
  cumulative: TokenUsage;
}

export interface CostUpdateEvent extends ACPEventBase {
  type: 'resource:cost';
  delta: CostBreakdown;
  cumulative: CostBreakdown;
}

export interface ContextWindowEvent extends ACPEventBase {
  type: 'resource:context_window';
  used: number;
  limit: number;
  percentage: number;
}

export interface RateLimitEvent extends ACPEventBase {
  type: 'resource:rate_limit';
  retryAfter: number;
  limit: string;
  message?: string;
}
