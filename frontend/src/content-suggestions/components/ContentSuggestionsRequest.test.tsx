import { screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWrapper as render } from '../../setupTest';
import ContentSuggestionsRequest from './ContentSuggestionsRequest';
import { generateSuggestions, getSessionResponse } from '../data/workflowActions';
import { useAsyncTaskPolling } from '../hooks/useAsyncTaskPolling';

jest.mock('../data/workflowActions', () => ({
  generateSuggestions: jest.fn(),
  getSessionResponse: jest.fn(),
}));

jest.mock('../hooks/useAsyncTaskPolling', () => ({
  POLLING_ERROR_KEYS: { TIMEOUT: 'timeout', GENERATE: 'generate', NETWORK: 'network' },
  useAsyncTaskPolling: jest.fn(),
}));

const mockStartPolling = jest.fn();
const mockStopPolling = jest.fn();

const defaultProps = {
  hasAsked: false,
  setResponse: jest.fn(),
  setHasAsked: jest.fn(),
  courseId: 'course-v1:Test+101+2024',
  locationId: 'block-v1:Test+101+2024+type@vertical+block@abc',
  uiSlotSelectorId: 'openedx.studio.course-outline.slot.v1',
};

beforeEach(() => {
  jest.clearAllMocks();
  (useAsyncTaskPolling as jest.Mock).mockReturnValue({
    startPolling: mockStartPolling,
    stopPolling: mockStopPolling,
  });
});

describe('ContentSuggestionsRequest', () => {
  describe('when preloadPreviousSession is enabled', () => {
    it('hands off to the response component when a session with suggestions exists', async () => {
      const innerResponse = { suggestions: [{ id: '1', title: 'Fix typo' }], extraInstructions: 'be terse' };
      (getSessionResponse as jest.Mock).mockResolvedValue({ response: innerResponse, status: 'completed' });
      render(<ContentSuggestionsRequest {...defaultProps} preloadPreviousSession />);

      await waitFor(() => {
        expect(defaultProps.setResponse).toHaveBeenCalledWith(innerResponse);
        expect(defaultProps.setHasAsked).toHaveBeenCalledWith(true);
      });
    });

    it('shows the ask button when no session exists', async () => {
      (getSessionResponse as jest.Mock).mockResolvedValue({ response: { suggestions: [] }, status: 'no_suggestions' });
      render(<ContentSuggestionsRequest {...defaultProps} preloadPreviousSession />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /suggest improvements/i })).toBeInTheDocument();
      });
    });

    it('does not call getSessionResponse when preloadPreviousSession is false', () => {
      render(<ContentSuggestionsRequest {...defaultProps} />);

      expect(getSessionResponse).not.toHaveBeenCalled();
    });

    it('hands off to the response component even when this location has zero suggestions, as long as the course has generated at least once', async () => {
      const innerResponse = { suggestions: [], extraInstructions: 'be terse' };
      (getSessionResponse as jest.Mock).mockResolvedValue({ response: innerResponse, status: 'completed' });
      render(<ContentSuggestionsRequest {...defaultProps} preloadPreviousSession />);

      await waitFor(() => {
        expect(defaultProps.setResponse).toHaveBeenCalledWith(innerResponse);
        expect(defaultProps.setHasAsked).toHaveBeenCalledWith(true);
      });
    });

    it('prefills the guidelines textarea with the course-stored extraInstructions', async () => {
      const user = userEvent.setup();
      (getSessionResponse as jest.Mock).mockResolvedValue({
        response: { suggestions: [], extraInstructions: 'Always write in third person' },
        status: 'no_suggestions',
      });
      render(<ContentSuggestionsRequest {...defaultProps} preloadPreviousSession />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /suggest improvements/i })).toBeInTheDocument();
      });
      await user.click(screen.getByRole('button', { name: /suggest improvements/i }));

      expect(screen.getByLabelText(/guidelines for the ai/i)).toHaveValue('Always write in third person');
    });
  });

  it('hides the component once a response has been asked for', () => {
    const { container } = render(<ContentSuggestionsRequest {...defaultProps} hasAsked />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the guidelines form when the button is clicked', async () => {
    const user = userEvent.setup();
    render(<ContentSuggestionsRequest {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: /suggest improvements/i }));

    expect(screen.getByLabelText(/guidelines for the ai/i)).toBeInTheDocument();
  });

  it('sends the typed guidelines as extraInstructions when generating', async () => {
    const user = userEvent.setup();
    (generateSuggestions as jest.Mock).mockResolvedValue({ taskId: 'task-1' });
    render(<ContentSuggestionsRequest {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: /suggest improvements/i }));
    await user.type(screen.getByLabelText(/guidelines for the ai/i), 'Always write in third person');
    await user.click(screen.getByRole('button', { name: /generate suggestions/i }));

    await waitFor(() => {
      expect(generateSuggestions).toHaveBeenCalledWith(
        expect.objectContaining({ extraInstructions: 'Always write in third person' }),
      );
    });
  });

  it('starts polling when the backend returns a task ID', async () => {
    const user = userEvent.setup();
    (generateSuggestions as jest.Mock).mockResolvedValue({ taskId: 'task-123' });
    render(<ContentSuggestionsRequest {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: /suggest improvements/i }));
    await user.click(screen.getByRole('button', { name: /generate suggestions/i }));

    await waitFor(() => {
      expect(mockStartPolling).toHaveBeenCalledWith('task-123');
    });
  });

  it('sets the response directly when the backend returns data without a task ID', async () => {
    const user = userEvent.setup();
    const responseData = { suggestions: [{ id: '1' }] };
    (generateSuggestions as jest.Mock).mockResolvedValue(responseData);
    render(<ContentSuggestionsRequest {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: /suggest improvements/i }));
    await user.click(screen.getByRole('button', { name: /generate suggestions/i }));

    await waitFor(() => {
      expect(defaultProps.setResponse).toHaveBeenCalledWith(responseData);
      expect(defaultProps.setHasAsked).toHaveBeenCalledWith(true);
    });
  });

  it('shows an error message when the API call fails', async () => {
    const user = userEvent.setup();
    (generateSuggestions as jest.Mock).mockRejectedValue(new Error('Server error'));
    render(<ContentSuggestionsRequest {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: /suggest improvements/i }));
    await user.click(screen.getByRole('button', { name: /generate suggestions/i }));

    await waitFor(() => {
      expect(screen.getByText(/failed to generate content suggestions/i)).toBeInTheDocument();
    });
  });

  it('shows a timeout message reported by the polling hook', () => {
    render(<ContentSuggestionsRequest {...defaultProps} />);

    const { onError } = (useAsyncTaskPolling as jest.Mock).mock.calls[0][0];
    act(() => { onError('timeout'); });

    expect(screen.getByText(/generation timed out/i)).toBeInTheDocument();
  });
});
