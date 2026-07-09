import { callWorkflowService } from '../../services';
import { WORKFLOW_ACTIONS } from '../../constants';

interface ContextParam {
  context: Record<string, any>;
}

// ── Generate content suggestions (async) ────────────────────────────────────

interface GenerateParams extends ContextParam {
  extraInstructions: string;
}

export const generateSuggestions = async ({
  context, extraInstructions,
}: GenerateParams) => callWorkflowService({
  context,
  payload: {
    action: WORKFLOW_ACTIONS.RUN_ASYNC,
    requestId: `ai-request-${Date.now()}`,
    userInput: { extraInstructions },
  },
});

// ── Poll task status ────────────────────────────────────────────────────────

interface PollParams extends ContextParam {
  taskId: string;
  courseId: string;
}

export const pollTaskStatus = async ({
  context, taskId, courseId,
}: PollParams) => callWorkflowService({
  context,
  payload: {
    action: WORKFLOW_ACTIONS.GET_RUN_STATUS,
    requestId: `ai-poll-${Date.now()}`,
    taskId,
    courseId,
  },
});

// ── Get current session response ────────────────────────────────────────────

export const getSessionResponse = async ({ context }: ContextParam) => callWorkflowService({
  context,
  payload: {
    action: WORKFLOW_ACTIONS.GET_CURRENT_SESSION_RESPONSE,
    requestId: `ai-request-${Date.now()}`,
  },
});

// ── Clear session ───────────────────────────────────────────────────────────

export const clearSession = async ({ context }: ContextParam) => callWorkflowService({
  context,
  payload: {
    action: WORKFLOW_ACTIONS.CLEAR_SESSION,
    requestId: `ai-request-${Date.now()}`,
  },
});
