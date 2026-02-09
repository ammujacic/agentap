import type { ACPEventBase } from '../envelope';

export interface EnvironmentContext {
  agent: {
    name: string;
    version: string;
    displayName: string;
  };
  model: {
    id: string;
    displayName?: string;
    provider?: string;
  };
  project: {
    path: string;
    name: string;
    language?: string;
    framework?: string;
  };
  runtime: {
    os: string;
    arch: string;
    nodeVersion?: string;
  };
}

export interface EnvironmentInfoEvent extends ACPEventBase {
  type: 'environment:info';
  context: EnvironmentContext;
}
