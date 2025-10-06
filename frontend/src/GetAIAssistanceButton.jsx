import React, { useState, useCallback } from 'react';
import PropTypes from 'prop-types';

// Import service modules
import {
  prepareContextData,
  callAIService,
  formatErrorMessage,
  getDefaultEndpoint,
  validateEndpoint,
} from './services';

// Import UI components
import {
  AIRequestComponent,
  AIResponseComponent,
} from './components';

/**
 * Main AI Assistant Plugin Component
 * Orchestrates the AI assistance flow using modular components
 */
const GetAIAssistanceButton = ({
  sequence,
  courseId,
  unitId,
  apiEndpoint,
  requestMessage,
  buttonText,
  showResponseActions,
  allowCopy,
  allowDownload,
  ...props
}) => {
  // Core state management
  const [isLoading, setIsLoading] = useState(false);
  const [response, setResponse] = useState('');
  const [error, setError] = useState('');
  const [hasAsked, setHasAsked] = useState(false);
  const [requestId, setRequestId] = useState(null);

  // Get API endpoint with fallback
  const endpoint = apiEndpoint || getDefaultEndpoint();

  /**
   * Handle AI assistant request
   * Now completely flexible - works with any available context
   */
  const handleAskAI = useCallback(async () => {
    // Validate endpoint
    if (!validateEndpoint(endpoint)) {
      setError('Invalid API endpoint configuration');
      return;
    }

    setIsLoading(true);
    setError('');
    setResponse('');
    // DON'T set hasAsked to true here - only set it on success

    try {
      // Prepare context data - captures everything available
      const contextData = prepareContextData({
        sequence,
        courseId,
        unitId,
        // Pass any additional props that might be useful
        ...props,
      });

      // eslint-disable-next-line no-console
      console.log('Prepared context data:', contextData);

      // Make API call with flexible parameters
      const data = await callAIService({
        contextData,
        apiEndpoint: endpoint,
        courseId,
        userQuery: requestMessage || 'Provide learning assistance for this content',
      });

      // Store request ID for tracking
      setRequestId(data.requestId);

      // Flexible response handling - API decides what to return
      if (data.response) {
        setResponse(data.response);
        setHasAsked(true); // Only set hasAsked on successful response
      } else if (data.message) {
        setResponse(data.message);
        setHasAsked(true);
      } else if (data.content) {
        setResponse(data.content);
        setHasAsked(true);
      } else if (data.result) {
        setResponse(data.result);
        setHasAsked(true);
      } else if (data.error) {
        throw new Error(data.error);
      } else {
        // If API returns something but in unexpected format, try to use it
        setResponse(JSON.stringify(data, null, 2));
        setHasAsked(true);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('AI Assistant Error:', err);
      const userFriendlyError = formatErrorMessage(err);
      setError(userFriendlyError);
      // DON'T set hasAsked to true on error - keep button available
    } finally {
      setIsLoading(false);
    }
  }, [sequence, courseId, unitId, endpoint, requestMessage, props]);

  /**
   * Reset component state for new request
   */
  const handleReset = useCallback(() => {
    setResponse('');
    setError('');
    setHasAsked(false);
    setRequestId(null);
  }, []);

  /**
   * Clear error state but keep button available
   */
  const handleClearError = useCallback((errorMessage = '') => {
    setError(errorMessage);
    // Don't change hasAsked state when clearing errors
  }, []);

  // Debug info for development
  const debugInfo = process.env.NODE_ENV === 'development' ? {
    courseId,
    unitId,
    sequenceId: sequence?.id,
    endpoint,
    requestId,
    hasAsked,
    hasError: !!error,
  } : null;

  return (
    <div className="ai-assistant-plugin" style={{ maxWidth: '100%' }}>

      {/* Request Interface - Show button unless we have a successful response */}
      <AIRequestComponent
        isLoading={isLoading}
        hasAsked={hasAsked && !error} // Only hide if successful AND no error
        onAskAI={handleAskAI}
        customMessage={requestMessage}
        buttonText={buttonText}
        disabled={false} // Never disable - let API decide what to do
      />

      {/* Response Interface */}
      <AIResponseComponent
        response={response}
        error={error}
        isLoading={isLoading}
        onAskAgain={handleAskAI}
        onClear={handleReset}
        onError={handleClearError}
        showActions={showResponseActions}
        allowCopy={allowCopy}
        allowDownload={allowDownload}
      />

      {/* Development debug info */}
      {debugInfo && (
        <details className="mt-2">
          <summary className="text-muted" style={{ fontSize: '0.8rem' }}>
            Debug Info (Development Only)
          </summary>
          <pre className="text-muted mt-1" style={{ fontSize: '0.7rem' }}>
            {JSON.stringify(debugInfo, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
};

GetAIAssistanceButton.propTypes = {
  sequence: PropTypes.shape({
    id: PropTypes.string,
    displayName: PropTypes.string,
    unitBlocks: PropTypes.arrayOf(PropTypes.shape({})),
  }),
  courseId: PropTypes.string,
  unitId: PropTypes.string,
  apiEndpoint: PropTypes.string,
  requestMessage: PropTypes.string,
  buttonText: PropTypes.string,
  showResponseActions: PropTypes.bool,
  allowCopy: PropTypes.bool,
  allowDownload: PropTypes.bool,
};

GetAIAssistanceButton.defaultProps = {
  sequence: null,
  courseId: null,
  unitId: null,
  apiEndpoint: null,
  requestMessage: 'Need help understanding this content?',
  buttonText: 'Get AI Assistance',
  showResponseActions: true,
  allowCopy: true,
  allowDownload: false,
};

export default GetAIAssistanceButton;
