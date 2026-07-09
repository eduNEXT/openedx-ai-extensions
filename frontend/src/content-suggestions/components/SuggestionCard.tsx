import { useIntl } from '@edx/frontend-platform/i18n';
import { getConfig } from '@edx/frontend-platform';
import {
  Badge, Card, Hyperlink,
} from '@openedx/paragon';
import { ContentSuggestion } from '../types';
import messages from '../messages';

const PRIORITY_VARIANTS: Record<ContentSuggestion['priority'], string> = {
  high: 'danger',
  medium: 'warning',
  low: 'info',
};

const PRIORITY_MESSAGE_KEYS: Record<ContentSuggestion['priority'], keyof typeof messages> = {
  high: 'ai.extensions.content.suggestions.priority.high',
  medium: 'ai.extensions.content.suggestions.priority.medium',
  low: 'ai.extensions.content.suggestions.priority.low',
};

// ponytail: Studio's container URL only needs the unit's usage key, no course path.
export const buildUnitUrl = (unitId: string): string => `${getConfig().STUDIO_BASE_URL}/container/${unitId}`;

export interface SuggestionCardProps {
  suggestion: ContentSuggestion;
  currentLocationId?: string;
}

const SuggestionCard = ({ suggestion, currentLocationId = '' }: SuggestionCardProps) => {
  const intl = useIntl();
  const {
    unitId, unitDisplayName, sectionDisplayName, subsectionDisplayName,
    type, priority, title, suggestion: suggestionText, proposedChange,
  } = suggestion;

  const breadcrumb = [sectionDisplayName, subsectionDisplayName, unitDisplayName]
    .filter(Boolean)
    .join(' › ');

  return (
    <Card className="content-suggestion-card mb-3">
      <Card.Section>
        {breadcrumb && <div className="x-small text-muted mb-1">{breadcrumb}</div>}
        <div className="d-flex align-items-center mb-2" style={{ gap: '0.5rem' }}>
          <Badge variant={PRIORITY_VARIANTS[priority]}>
            {intl.formatMessage(messages[PRIORITY_MESSAGE_KEYS[priority]])}
          </Badge>
          <Badge variant="light">{type}</Badge>
        </div>
        <h4 className="mb-1">{title}</h4>
        <p className="small mb-2">{suggestionText}</p>

        {proposedChange && (
          <div className="proposed-change small border rounded p-2 mb-2">
            <div className="text-muted mb-1">
              <s>{intl.formatMessage(messages['ai.extensions.content.suggestions.card.current.label'])}</s>
              {' '}
              {proposedChange.current}
            </div>
            <div>
              <strong>{intl.formatMessage(messages['ai.extensions.content.suggestions.card.suggested.label'])}</strong>
              {' '}
              {proposedChange.suggested}
            </div>
          </div>
        )}

        {unitId !== currentLocationId && (
          <Hyperlink destination={buildUnitUrl(unitId)} target="_blank" className="small">
            {intl.formatMessage(messages['ai.extensions.content.suggestions.card.open.unit'])}
          </Hyperlink>
        )}
      </Card.Section>
    </Card>
  );
};

export default SuggestionCard;
