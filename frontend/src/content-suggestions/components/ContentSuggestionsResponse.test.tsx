import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWrapper as render } from '../../setupTest';
import ContentSuggestionsResponse from './ContentSuggestionsResponse';
import { clearSession } from '../data/workflowActions';
import { ContentSuggestion } from '../types';

jest.mock('../data/workflowActions', () => ({
  clearSession: jest.fn().mockResolvedValue({}),
}));

const makeSuggestion = (overrides: Partial<ContentSuggestion> = {}): ContentSuggestion => ({
  id: '1',
  unitId: 'block-v1:Test+101+2024+type@vertical+block@abc',
  unitDisplayName: 'Introduction',
  type: 'wording',
  priority: 'high',
  title: 'Rename this unit',
  suggestion: 'The title is unclear, consider something more specific.',
  proposedChange: null,
  sectionId: 'block-v1:Test+101+2024+type@chapter+block@sec1',
  sectionDisplayName: 'Week 1',
  subsectionId: 'block-v1:Test+101+2024+type@sequential+block@sub1',
  subsectionDisplayName: 'Getting Started',
  ...overrides,
});

// Matches makeSuggestion()'s default unitId — puts the response in "unit scope".
const unitLocationProps = {
  onClear: jest.fn(),
  contextData: {
    courseId: 'course-v1:Test+101+2024',
    locationId: 'block-v1:Test+101+2024+type@vertical+block@abc',
    uiSlotSelectorId: 'educator-1',
  },
};

// A course-outline-style scope: locationId doesn't match any suggestion's unitId.
const outlineLocationProps = {
  onClear: jest.fn(),
  contextData: {
    courseId: 'course-v1:Test+101+2024',
    locationId: 'course-v1:Test+101+2024',
    uiSlotSelectorId: 'ai-assist-button-course-outline-sidebar1',
  },
};

const assignMock = jest.fn();

beforeAll(() => {
  Object.defineProperty(window, 'location', {
    value: { ...window.location, assign: assignMock },
    writable: true,
  });
});

beforeEach(() => {
  jest.clearAllMocks();
  (clearSession as jest.Mock).mockResolvedValue({});
});

describe('ContentSuggestionsResponse', () => {
  describe('when there is no response yet', () => {
    it('renders nothing', () => {
      const { container } = render(<ContentSuggestionsResponse response={null} {...outlineLocationProps} />);
      expect(container).toBeEmptyDOMElement();
    });

    it('renders nothing while loading', () => {
      const { container } = render(
        <ContentSuggestionsResponse response={null} isLoading {...outlineLocationProps} />,
      );
      expect(container).toBeEmptyDOMElement();
    });
  });

  describe('when there is an error', () => {
    it('shows the error message', () => {
      render(<ContentSuggestionsResponse response={null} error="Something went wrong" {...outlineLocationProps} />);
      expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    });
  });

  describe('when suggestions are empty', () => {
    it('shows the empty-state message instead of any cards or a request button', () => {
      render(<ContentSuggestionsResponse response={{ suggestions: [] }} {...unitLocationProps} />);
      expect(screen.getByText(/no suggestions for this content/i)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /suggest improvements/i })).not.toBeInTheDocument();
    });
  });

  describe('in course-outline scope (locationId matches no suggestion)', () => {
    it('renders one card per suggestion with its breadcrumb, title, and an Open unit link', () => {
      const response = { suggestions: [makeSuggestion()], extraInstructions: '' };
      render(<ContentSuggestionsResponse response={response} {...outlineLocationProps} />);

      expect(screen.getByText('Rename this unit')).toBeInTheDocument();
      expect(screen.getByText(/week 1.*getting started.*introduction/i)).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /open unit/i })).toBeInTheDocument();
    });

    it('renders a proposed change diff when one is present', () => {
      const suggestion = makeSuggestion({
        proposedChange: { field: 'display_name', current: 'Unit 1', suggested: 'Getting Started with Python' },
      });
      render(<ContentSuggestionsResponse response={{ suggestions: [suggestion] }} {...outlineLocationProps} />);

      expect(screen.getByText('Unit 1')).toBeInTheDocument();
      expect(screen.getByText('Getting Started with Python')).toBeInTheDocument();
    });

    it('does not render a diff block when proposedChange is null', () => {
      render(<ContentSuggestionsResponse response={{ suggestions: [makeSuggestion()] }} {...outlineLocationProps} />);
      expect(screen.queryByText(/current/i)).not.toBeInTheDocument();
    });
  });

  describe('in unit scope (locationId matches every suggestion)', () => {
    it('hides the Open unit link since we are already on that unit', () => {
      render(<ContentSuggestionsResponse response={{ suggestions: [makeSuggestion()] }} {...unitLocationProps} />);
      expect(screen.queryByRole('link', { name: /open unit/i })).not.toBeInTheDocument();
    });

    it('shows a single card with no navigation controls when there is only one suggestion', () => {
      render(<ContentSuggestionsResponse response={{ suggestions: [makeSuggestion()] }} {...unitLocationProps} />);
      expect(screen.getByText('Rename this unit')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /next suggestion/i })).not.toBeInTheDocument();
    });

    it('pages between suggestions with previous/next controls', async () => {
      const user = userEvent.setup();
      const response = {
        suggestions: [
          makeSuggestion({ id: '1', title: 'First suggestion' }),
          makeSuggestion({ id: '2', title: 'Second suggestion' }),
        ],
      };
      render(<ContentSuggestionsResponse response={response} {...unitLocationProps} />);

      expect(screen.getByText('First suggestion')).toBeInTheDocument();
      expect(screen.getByText('1 of 2')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /previous suggestion/i })).toBeDisabled();

      await user.click(screen.getByRole('button', { name: /next suggestion/i }));

      expect(screen.getByText('Second suggestion')).toBeInTheDocument();
      expect(screen.queryByText('First suggestion')).not.toBeInTheDocument();
      expect(screen.getByText('2 of 2')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /next suggestion/i })).toBeDisabled();
    });

    it('redirects to the next unit in the course when it differs from the current one', async () => {
      const user = userEvent.setup();
      const otherUnitId = 'block-v1:Test+101+2024+type@vertical+block@xyz';
      const response = {
        suggestions: [makeSuggestion({ id: '1', title: 'Here' })],
        courseSuggestions: [
          makeSuggestion({ id: '1', title: 'Here' }),
          makeSuggestion({ id: '2', title: 'Elsewhere', unitId: otherUnitId }),
        ],
      };
      render(<ContentSuggestionsResponse response={response} {...unitLocationProps} />);

      await user.click(screen.getByRole('button', { name: /next suggestion/i }));

      expect(assignMock).toHaveBeenCalledWith(expect.stringContaining(otherUnitId));
      expect(screen.getByText('Here')).toBeInTheDocument();
    });
  });

  describe('clear', () => {
    it('clears the session and notifies the parent', async () => {
      const user = userEvent.setup();
      render(<ContentSuggestionsResponse response={{ suggestions: [makeSuggestion()] }} {...unitLocationProps} />);

      await user.click(screen.getByRole('button', { name: /^clear$/i }));

      await waitFor(() => {
        expect(clearSession).toHaveBeenCalled();
        expect(unitLocationProps.onClear).toHaveBeenCalled();
      });
    });

    it('does not render a regenerate button', () => {
      render(<ContentSuggestionsResponse response={{ suggestions: [makeSuggestion()] }} {...unitLocationProps} />);
      expect(screen.queryByRole('button', { name: /regenerate/i })).not.toBeInTheDocument();
    });
  });
});
