export type ACPCommand =
  | SendMessageCommand
  | ApproveToolCallCommand
  | DenyToolCallCommand
  | AnswerQuestionCommand
  | CancelCommand
  | PauseCommand
  | ResumeCommand
  | TerminateCommand
  | SetPermissionPolicyCommand;

export interface SendMessageCommand {
  command: 'send_message';
  message: string;
  attachments?: Array<{ type: 'image'; url: string }>;
}

export interface ApproveToolCallCommand {
  command: 'approve_tool_call';
  requestId: string;
  toolCallId: string;
}

export interface DenyToolCallCommand {
  command: 'deny_tool_call';
  requestId: string;
  toolCallId: string;
  reason?: string;
}

export interface AnswerQuestionCommand {
  command: 'answer_question';
  questionId: string;
  answer: string;
}

export interface CancelCommand {
  command: 'cancel';
}

export interface PauseCommand {
  command: 'pause';
}

export interface ResumeCommand {
  command: 'resume';
  prompt?: string;
}

export interface TerminateCommand {
  command: 'terminate';
}

export interface SetPermissionPolicyCommand {
  command: 'set_permission_policy';
  policy: PermissionPolicy;
}

export interface PermissionPolicy {
  autoApprove: {
    reads: boolean;
    writes: boolean | string[];
    commands: boolean | string[];
    searches: boolean;
  };
}
