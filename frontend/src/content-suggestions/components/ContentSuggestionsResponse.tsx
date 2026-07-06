import {
  useState, useCallback, useEffect, useMemo,
} from 'react';
import { useIntl } from '@edx/frontend-platform/i18n';
import { logError } from '@edx/frontend-platform/logging';
import { Alert, Button } from '@openedx/paragon';
import { ChevronLeft, ChevronRight } from '@openedx/paragon/icons';
import SuggestionCard, { buildUnitUrl } from './SuggestionCard';
import { clearSession } from '../data/workflowActions';
import { ContentSuggestion } from '../types';
import { prepareContextData } from '../../services';
import messages from '../messages';

export interface ContentSuggestionsResponseProps {
  response: any;
  error?: string;
  isLoading?: boolean;
  contextData?: Record<string, any>;
  customMessage?: string;
  onClear?: () => void;
}

const parseList = (data: any, key: string): ContentSuggestion[] => {
  if (Array.isArray(data?.[key])) { return data[key]; }
  return [];
};

const ContentSuggestionsResponse = ({
  response,
  error,
  isLoading,
  customMessage,
  contextData = {},
  onClear,
}: ContentSuggestionsResponseProps) => {
  const intl = useIntl();
  const preparedContext = useMemo(() => prepareContextData(contextData), [contextData]);
  const locationId = preparedContext.locationId || '';

  const [suggestions, setSuggestions] = useState<ContentSuggestion[]>(() => parseList(response, 'suggestions'));
  // Falls back to the location-filtered list for sessions generated before
  // course_suggestions existed — self-heals once the course is regenerated.
  const [courseSuggestions, setCourseSuggestions] = useState<ContentSuggestion[]>(
    () => {
      const parsed = parseList(response, 'courseSuggestions');
      return parsed.length > 0 ? parsed : parseList(response, 'suggestions');
    },
  );
  const [index, setIndex] = useState(0);

  useMemo(() => {
    const filtered = parseList(response, 'suggestions');
    const course = parseList(response, 'courseSuggestions');
    setSuggestions(filtered);
    setCourseSuggestions(course.length > 0 ? course : filtered);
  }, [response]);

  // Start the carousel on this unit's own suggestion within the full course
  // order, so "next/previous" walks the whole course from the right spot.
  useEffect(() => {
    const startIndex = locationId
      ? courseSuggestions.findIndex((s) => s.unitId === locationId)
      : -1;
    setIndex(startIndex >= 0 ? startIndex : 0);
  }, [courseSuggestions, locationId]);

  const handleClear = useCallback(async () => {
    try {
      await clearSession({ context: preparedContext });
    } catch (err) {
      logError('ContentSuggestionsResponse: clear session error:', err);
    }
    if (onClear) { onClear(); }
  }, [preparedContext, onClear]);

  if (isLoading || (!response && !error)) { return null; }

  if (error) {
    return <Alert variant="danger">{error}</Alert>;
  }

  // When every suggestion in the (already location-filtered) list belongs to
  // the unit we're currently on, "Open unit" is redundant — page through the
  // whole course instead, redirecting whenever the target suggestion lives
  // on a different unit.
  const isUnitScope = Boolean(locationId) && suggestions.length > 0
    && suggestions.every((s) => s.unitId === locationId);

  const goTo = (nextIndex: number) => {
    const target = courseSuggestions[nextIndex];
    if (!target) { return; }
    if (target.unitId === locationId) {
      setIndex(nextIndex);
    } else {
      window.location.assign(buildUnitUrl(target.unitId));
    }
  };

  const renderBody = () => {
    if (suggestions.length === 0) {
      return (
        <p className="text-muted small">
          {intl.formatMessage(messages['ai.extensions.content.suggestions.response.empty'])}
        </p>
      );
    }
    if (!isUnitScope) {
      return suggestions.map((suggestion) => (
        <SuggestionCard key={suggestion.id} suggestion={suggestion} currentLocationId={locationId} />
      ));
    }
    return (
      <>
        <SuggestionCard suggestion={courseSuggestions[index]} currentLocationId={locationId} />
        {courseSuggestions.length > 1 && (
          <div className="d-flex align-items-center justify-content-center mb-3" style={{ gap: '1rem' }}>
            <Button
              variant="tertiary"
              size="sm"
              iconBefore={ChevronLeft}
              disabled={index === 0}
              onClick={() => goTo(index - 1)}
            >
              <span className="sr-only">
                {intl.formatMessage(messages['ai.extensions.content.suggestions.nav.previous'])}
              </span>
            </Button>
            <small className="text-muted">
              {intl.formatMessage(messages['ai.extensions.content.suggestions.nav.counter'], {
                current: index + 1,
                total: courseSuggestions.length,
              })}
            </small>
            <Button
              variant="tertiary"
              size="sm"
              iconAfter={ChevronRight}
              disabled={index === courseSuggestions.length - 1}
              onClick={() => goTo(index + 1)}
            >
              <span className="sr-only">
                {intl.formatMessage(messages['ai.extensions.content.suggestions.nav.next'])}
              </span>
            </Button>
          </div>
        )}
      </>
    );
  };

  return (
    <div className="content-suggestions-response mt-3">
      <div className="d-flex align-items-center justify-content-between mb-2 flex-wrap" style={{ gap: '0.5rem' }}>
        <h3 className="mb-0">
          {customMessage || intl.formatMessage(messages['ai.extensions.content.suggestions.response.title'])}
        </h3>
        <Button variant="outline-secondary" size="sm" onClick={handleClear}>
          {intl.formatMessage(messages['ai.extensions.content.suggestions.response.clear'])}
        </Button>
      </div>

      {renderBody()}
    </div>
  );
};

export default ContentSuggestionsResponse;
