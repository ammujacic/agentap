/**
 * Base adapter class with common functionality.
 * Provides default capability values that can be overridden.
 */

import { EventEmitter } from 'events';
import type {
  ACPAdapter,
  ACPSession,
  ACPCapabilities,
  AgentDataPaths,
  DiscoveredSession,
  SessionDiscoveryEvent,
  StartSessionOptions,
  IntegrationMethod,
} from '@agentap-dev/acp';
import { ACP_VERSION, assessRisk, describeToolCall, categorizeTool } from '@agentap-dev/acp';

export abstract class BaseAdapter implements ACPAdapter {
  abstract readonly name: string;
  abstract readonly displayName: string;
  abstract readonly icon: string;
  abstract readonly integrationMethod: IntegrationMethod;

  protected emitter = new EventEmitter();

  // Abstract methods that must be implemented
  abstract isInstalled(): Promise<boolean>;
  abstract getVersion(): Promise<string | null>;
  abstract discoverSessions(): Promise<DiscoveredSession[]>;
  abstract watchSessions(callback: (event: SessionDiscoveryEvent) => void): () => void;
  abstract attachToSession(sessionId: string): Promise<ACPSession>;
  abstract startSession(options: StartSessionOptions): Promise<ACPSession>;

  getDataPaths(): AgentDataPaths {
    return {};
  }

  /**
   * Default capabilities — override in subclass to advertise real features.
   */
  getCapabilities(): ACPCapabilities {
    return {
      protocolVersion: ACP_VERSION,
      agent: {
        name: this.name,
        displayName: this.displayName,
        icon: this.icon,
        version: null,
        integrationMethod: this.integrationMethod,
      },
      features: {
        streaming: {
          messages: true,
          toolArgs: false,
          thinking: false,
        },
        approval: { toolCalls: false, preview: false },
        sessionControl: {
          pause: false,
          resume: false,
          cancel: false,
        },
        subAgents: false,
        planning: { todos: false, planMode: false },
        resources: {
          tokenUsage: false,
          costTracking: false,
          contextWindow: false,
        },
        fileOperations: { diffs: false, batchedChanges: false },
        git: false,
        webSearch: false,
        multimodal: false,
        userInteraction: { questions: false, notifications: false },
        thinking: false,
        customEvents: [],
      },
    };
  }

  // Expose ACP helpers to subclasses
  protected assessRisk = assessRisk;
  protected describeToolCall = describeToolCall;
  protected categorizeTool = categorizeTool;

  protected generateId(): string {
    return crypto.randomUUID();
  }
}
