import {
  useState, useCallback, useEffect, useMemo,
} from 'react';
import { useIntl } from '@edx/frontend-platform/i18n';
import {
  Alert, Form, Icon, StatefulButton,
} from '@openedx/paragon';
import { AutoAwesome, SpinnerSimple } from '@openedx/paragon/icons';
import { POLLING_ERROR_KEYS, useAsyncTaskPolling } from '../hooks/useAsyncTaskPolling';
import { generateSuggestions, getSessionResponse } from '../data/workflowActions';
import { prepareContextData } from '../../services';
import messages from '../messages';
import { ContentSuggestionsStep } from '../types';

const ERROR_MESSAGES: Record<string, keyof typeof messages> = {
  [POLLING_ERROR_KEYS.TIMEOUT]: 'ai.extensions.content.suggestions.error.timeout',
  [POLLING_ERROR_KEYS.GENERATE]: 'ai.extensions.content.suggestions.error.generate',
  [POLLING_ERROR_KEYS.NETWORK]: 'ai.extensions.content.suggestions.error.network',
};

export interface ContentSuggestionsRequestProps {
  hasAsked: boolean;
  setResponse: (response: any) => void;
  setHasAsked: (hasAsked: boolean) => void;
  courseId?: string;
  locationId?: string;
  uiSlotSelectorId?: string;
  buttonText?: string;
  customMessage?: string;
  preloadPreviousSession?: boolean;
}

const ContentSuggestionsRequest = ({
  hasAsked,
  setResponse,
  setHasAsked,
  courseId = '',
  locationId = '',
  uiSlotSelectorId = '',
  buttonText,
  customMessage,
  preloadPreviousSession = false,
}: ContentSuggestionsRequestProps) => {
  const intl = useIntl();
  const [step, setStep] = useState<ContentSuggestionsStep>(preloadPreviousSession ? 'loading' : 'idle');
  const [showForm, setShowForm] = useState(false);
  const [guidelines, setGuidelines] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [progressMessage, setProgressMessage] = useState('');

  const contextData = useMemo(
    () => prepareContextData({ courseId, locationId, uiSlotSelectorId }),
    [courseId, locationId, uiSlotSelectorId],
  );

  const onComplete = useCallback((responseData: any) => {
    setStep('idle');
    setProgressMessage('');
    setResponse(responseData);
    setHasAsked(true);
  }, [setResponse, setHasAsked]);

  const onError = useCallback((errorKey: string) => {
    setStep('error');
    setProgressMessage('');
    const messageKey = ERROR_MESSAGES[errorKey] || 'ai.extensions.content.suggestions.error.generate';
    setErrorMessage(intl.formatMessage(messages[messageKey]));
  }, [intl]);

  const onProgress = useCallback((message: string) => {
    setProgressMessage(message);
  }, []);

  const { startPolling, stopPolling } = useAsyncTaskPolling({
    contextData,
    courseId,
    onComplete,
    onError,
    onProgress,
  });

  // Check for an existing course-wide session on mount
  useEffect(() => {
    if (!preloadPreviousSession) { return undefined; }

    let cancelled = false;
    const checkSession = async () => {
      try {
        const data = await getSessionResponse({ context: contextData });
        if (cancelled) { return; }
        const sessionResponse = data?.response as any;
        setGuidelines(sessionResponse?.extraInstructions || '');
        if (data?.status === 'completed') {
          setResponse(sessionResponse);
          setHasAsked(true);
        } else {
          setStep('idle');
        }
      } catch {
        if (!cancelled) { setStep('idle'); }
      }
    };
    checkSession();
    return () => { cancelled = true; };
  }, [contextData, setResponse, setHasAsked, preloadPreviousSession]);

  const handleGenerate = async () => {
    setShowForm(false);
    setStep('generating');
    setProgressMessage('');
    try {
      const data = await generateSuggestions({ context: contextData, extraInstructions: guidelines });
      if (data.taskId) {
        startPolling(data.taskId);
        if (data.message) { setProgressMessage(data.message); }
      } else {
        setResponse(data);
        setHasAsked(true);
        setStep('idle');
      }
    } catch {
      setStep('error');
      setErrorMessage(intl.formatMessage(messages['ai.extensions.content.suggestions.error.generate']));
    }
  };

  const handleStartOver = () => {
    stopPolling();
    setStep('idle');
    setErrorMessage('');
    setProgressMessage('');
  };

  if (hasAsked) { return null; }

  return (
    <div className="content-suggestions-request d-flex align-items-center justify-content-end px-3 small flex-wrap">

      {(!errorMessage && showForm) ? (
        <Form className="w-100 my-2">
          <Form.Group className="mb-2">
            <Form.Label>{intl.formatMessage(messages['ai.extensions.content.suggestions.guidelines.label'])}</Form.Label>
            <Form.Control
              as="textarea"
              rows={3}
              value={guidelines}
              placeholder={intl.formatMessage(messages['ai.extensions.content.suggestions.guidelines.placeholder'])}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setGuidelines(e.target.value)}
            />
            <Form.Text>{intl.formatMessage(messages['ai.extensions.content.suggestions.guidelines.help'])}</Form.Text>
          </Form.Group>
          <div className="d-flex justify-content-end" style={{ gap: '0.5rem' }}>
            <StatefulButton
              variant="tertiary"
              size="sm"
              state="idle"
              labels={{ idle: intl.formatMessage(messages['ai.extensions.content.suggestions.guidelines.cancel']) }}
              onClick={() => setShowForm(false)}
            />
            <StatefulButton
              variant="primary"
              size="sm"
              state="idle"
              labels={{ idle: intl.formatMessage(messages['ai.extensions.content.suggestions.guidelines.submit']) }}
              icons={{ idle: <Icon src={AutoAwesome} /> }}
              onClick={handleGenerate}
            />
          </div>
        </Form>
      ) : (
        <>
          <small className="d-block my-2 pr-md-5 container-mw-xs">
            {customMessage || intl.formatMessage(messages['ai.extensions.content.suggestions.request.description'])}
          </small>
          <StatefulButton
            variant="primary"
            size="sm"
            state={step}
            onClick={() => setShowForm(!showForm)}
            labels={{
              idle: buttonText || intl.formatMessage(messages['ai.extensions.content.suggestions.request.button']),
              generating: progressMessage || intl.formatMessage(messages['ai.extensions.content.suggestions.request.generating']),
              loading: intl.formatMessage(messages['ai.extensions.content.suggestions.request.loading']),
              error: buttonText || intl.formatMessage(messages['ai.extensions.content.suggestions.request.button']),
            }}
            icons={{
              idle: <Icon src={AutoAwesome} />,
              generating: <Icon src={SpinnerSimple} className="icon-spin" />,
              loading: <Icon src={SpinnerSimple} className="icon-spin" />,
            }}
            disabledStates={['loading', 'generating']}
          />
        </>
      )}
      {
        step === 'error' && (
          <Alert
            variant="danger"
            dismissible
            onClose={handleStartOver}
            className="w-100"
          >{errorMessage}
          </Alert>
        )
      }
    </div>
  );
};

export default ContentSuggestionsRequest;
