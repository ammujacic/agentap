import type { ACPEventBase } from '../envelope';

export interface UserQuestionEvent extends ACPEventBase {
  type: 'interaction:question';
  questionId: string;
  question: string;
  options?: string[];
  defaultValue?: string;
  expiresAt?: string;
}

export interface NotificationEvent extends ACPEventBase {
  type: 'interaction:notification';
  level: 'info' | 'warning' | 'error' | 'success';
  title: string;
  message: string;
  actionUrl?: string;
}
