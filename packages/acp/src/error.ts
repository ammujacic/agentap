export interface ACPError {
  code: string;
  message: string;
  recoverable: boolean;
  details?: unknown;
  /** Agent-specific error code */
  agentCode?: string;
}
