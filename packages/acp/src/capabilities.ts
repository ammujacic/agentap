export type IntegrationMethod = 'sdk' | 'http' | 'pty' | 'file-watch' | 'mcp';

export interface ACPCapabilities {
  /** Protocol version this adapter implements */
  protocolVersion: string;

  /** Agent identifier */
  agent: {
    name: string;
    displayName: string;
    icon: string;
    version: string | null;
    integrationMethod: IntegrationMethod;
  };

  /** What features this adapter supports */
  features: {
    streaming: {
      messages: boolean;
      toolArgs: boolean;
      thinking: boolean;
    };
    approval: {
      toolCalls: boolean;
      preview: boolean;
    };
    sessionControl: {
      pause: boolean;
      resume: boolean;
      cancel: boolean;
    };
    subAgents: boolean;
    planning: {
      todos: boolean;
      planMode: boolean;
    };
    resources: {
      tokenUsage: boolean;
      costTracking: boolean;
      contextWindow: boolean;
    };
    fileOperations: {
      diffs: boolean;
      batchedChanges: boolean;
    };
    git: boolean;
    webSearch: boolean;
    multimodal: boolean;
    userInteraction: {
      questions: boolean;
      notifications: boolean;
    };
    thinking: boolean;
    /** Supported custom event namespaces */
    customEvents: string[];
  };
}
