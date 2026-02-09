import type { ACPEventBase } from '../envelope';

export type WebOperation =
  | {
      kind: 'search';
      query: string;
      results?: Array<{ title: string; url: string; snippet: string }>;
    }
  | {
      kind: 'fetch';
      url: string;
      title?: string;
      statusCode?: number;
    };

export interface WebOperationEvent extends ACPEventBase {
  type: 'web:operation';
  operation: WebOperation;
  toolCallId?: string;
}
