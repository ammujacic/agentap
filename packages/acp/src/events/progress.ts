import type { ACPEventBase } from '../envelope';

export interface TodoUpdateEvent extends ACPEventBase {
  type: 'progress:todo_update';
  todos: Array<{
    content: string;
    status: 'pending' | 'in_progress' | 'completed';
  }>;
}

export interface PlanModeEvent extends ACPEventBase {
  type: 'progress:plan_mode';
  active: boolean;
  plan?: string;
}

export interface ProgressEvent extends ACPEventBase {
  type: 'progress:update';
  label: string;
  current?: number;
  total?: number;
  percentage?: number;
}
