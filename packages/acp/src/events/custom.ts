import type { ACPEventBase } from '../envelope';

export interface CustomEvent extends ACPEventBase {
  type: 'custom';
  namespace: string;
  eventName: string;
  data: Record<string, unknown>;
}
