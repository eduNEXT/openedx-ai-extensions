import { camelCaseObject, snakeCaseObject } from '@edx/frontend-platform';
import { getAuthenticatedHttpClient } from '@edx/frontend-platform/auth';
import { logError } from '@edx/frontend-platform/logging';
import { DEFAULT_CHUNK_RATE_LIMIT_MS, WORKFLOW_ACTIONS, WorkflowActionType } from '../constants';
import { PluginContext, PluginConfiguration } from '../types';
import { getDefaultEndpoint } from '../services/utils';

/**
 * Configuration API
 * Fetches runtime configuration for AI assistance components
 */
export const getConfiguration = async (context: PluginContext): Promise<PluginConfiguration | null> => {
  const apiUrl = getDefaultEndpoint('profile');

  const url = new URL(apiUrl);
  if (context) {
    url.searchParams.append('context', JSON.stringify(context));
  }
  const client = getAuthenticatedHttpClient();
  const { data } = await client.get(url.toString());
  const config = camelCaseObject(data);
  return config?.uiComponents || null;
};

/**
 * Workflow API (streaming support)
 */
export interface WorkflowOptions {
  timeout?: number;
  chunkRateMs?: number;
  [key: string]: any;
}

export interface WorkflowResult {
  response?: string;
  requestId?: string;
  status?: string;
  taskId?: string;
  message?: string;
  [key: string]: any;
}

export type WorkflowPayload = {
  action: WorkflowActionType;
  timestamp?: string;
  requestId?: string;
  userInput?: string | Record<string, any>;
  [key: string]: any;
}

export const callWorkflow = async (
  payload: WorkflowPayload,
  context: PluginContext,
  onStreamChunk?: (chunk: string) => void,
  options: WorkflowOptions = {}
): Promise<WorkflowResult> => {
  const {
    chunkRateMs = DEFAULT_CHUNK_RATE_LIMIT_MS,
    timeout,
  } = options;

  const apiEndpoint = getDefaultEndpoint('workflows');
  const url = new URL(apiEndpoint);

  url.searchParams.append('context', JSON.stringify(context));

  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  if (timeout && timeout > 0) {
    timeoutId = setTimeout(() => {
      controller.abort(new Error('Workflow request timed out'));
    }, timeout);
  }

  const shouldStream = typeof onStreamChunk === 'function';
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

  try {
    const response = await getAuthenticatedHttpClient().post(url.toString(), snakeCaseObject(payload),
      {
        responseType: 'stream',
        adapter: 'fetch',
        signal: controller.signal,
      } as RequestInit
    );

    if (response.status >= 400) {
      throw new Error(`Request failed with status ${response.status}`);
    }

    const contentType =
      response.headers?.['content-type'] ??
      response.headers?.['Content-Type'] ??
      '';

    const isJson = contentType.toLowerCase().includes('application/json');

    if (isJson && shouldStream) {
      throw new Error('Streaming callbacks are not supported for JSON responses');
    }

    reader = response.data.getReader();
    const decoder = new TextDecoder();

    const chunks: string[] = [];

    // Streaming throttle queue
    const chunkQueue: string[] = [];
    let streamingComplete = false;

    const processQueue = async () => {
      while (!streamingComplete || chunkQueue.length > 0) {
        if (chunkQueue.length && onStreamChunk) {
          onStreamChunk(chunkQueue.shift()!);
        }
        await new Promise(resolve => setTimeout(resolve, chunkRateMs));
      }
    };

    const queueProcessor = shouldStream ? processQueue() : Promise.resolve();

    // --- STREAM CONSUMPTION LOOP ---
    while (true) {
      if (reader === undefined) {
        throw new Error('Stream reader is not available');
      };
      const { done, value } = await reader.read();

      if (done) break;

      const text = decoder.decode(value, { stream: true });
      if (!text) continue;

      chunks.push(text);

      if (shouldStream) {
        chunkQueue.push(text);
      }
    }

    streamingComplete = true;
    await queueProcessor;

    // Flush decoder for multibyte chars
    const finalText = decoder.decode();
    if (finalText) chunks.push(finalText);

    const fullText = chunks.join('');

    if (isJson) {
      let parsed;
      try {
        parsed = JSON.parse(fullText);
      } catch (err) {
        logError('Failed to parse JSON workflow response', err);
        throw new Error('Invalid JSON response from workflow service');
      }

      return camelCaseObject(parsed) as WorkflowResult;
    }

    return {
      response: fullText,
      requestId: payload.requestId,
      status: 'success',
      timestamp: new Date().toISOString(),
    };

  } catch (error: any) {
    if (error?.name === 'AbortError') {
      throw new Error('Workflow request was aborted');
    }

    logError('Workflow Service Error', {
      requestId: payload.requestId,
      error,
    });

    throw error;

  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    await reader?.cancel?.();
  }
};

/**
 * Task status API
 */
export const getTaskStatus = async (taskId: string, context: PluginContext): Promise<WorkflowResult> => {
  return callWorkflow({
    action: WORKFLOW_ACTIONS.GET_RUN_STATUS,
    userInput: { taskId },
    timestamp: new Date().toISOString(),
  }, context);
};