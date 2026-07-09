import { defineMessages } from '@edx/frontend-platform/i18n';

const messages = defineMessages({
  'ai.extensions.content.suggestions.request.description': {
    id: 'ai.extensions.content.suggestions.request.description',
    defaultMessage: 'Get AI suggestions to improve this course content',
    description: 'Default description shown next to the suggest-improvements button',
  },
  'ai.extensions.content.suggestions.request.button': {
    id: 'ai.extensions.content.suggestions.request.button',
    defaultMessage: 'Suggest improvements',
    description: 'Button label to request content improvement suggestions',
  },
  'ai.extensions.content.suggestions.request.loading': {
    id: 'ai.extensions.content.suggestions.request.loading',
    defaultMessage: 'Loading...',
    description: 'Button label while the previous session is being loaded',
  },
  'ai.extensions.content.suggestions.request.generating': {
    id: 'ai.extensions.content.suggestions.request.generating',
    defaultMessage: 'Analyzing course content...',
    description: 'Button label while suggestions are being generated',
  },
  'ai.extensions.content.suggestions.guidelines.label': {
    id: 'ai.extensions.content.suggestions.guidelines.label',
    defaultMessage: 'Guidelines for the AI (optional)',
    description: 'Label for the free-text guidelines textarea',
  },
  'ai.extensions.content.suggestions.guidelines.placeholder': {
    id: 'ai.extensions.content.suggestions.guidelines.placeholder',
    defaultMessage: 'e.g. Always write in third person, keep a formal tone...',
    description: 'Placeholder example text for the guidelines textarea',
  },
  'ai.extensions.content.suggestions.guidelines.help': {
    id: 'ai.extensions.content.suggestions.guidelines.help',
    defaultMessage: 'These guidelines are shared with every author on this course until someone changes them.',
    description: 'Help text explaining guidelines are stored per-course',
  },
  'ai.extensions.content.suggestions.guidelines.submit': {
    id: 'ai.extensions.content.suggestions.guidelines.submit',
    defaultMessage: 'Generate suggestions',
    description: 'Submit button label on the guidelines form',
  },
  'ai.extensions.content.suggestions.guidelines.cancel': {
    id: 'ai.extensions.content.suggestions.guidelines.cancel',
    defaultMessage: 'Cancel',
    description: 'Cancel button label on the guidelines form',
  },
  'ai.extensions.content.suggestions.error.generate': {
    id: 'ai.extensions.content.suggestions.error.generate',
    defaultMessage: 'Failed to generate content suggestions. Please try again.',
    description: 'Generic generation error',
  },
  'ai.extensions.content.suggestions.error.timeout': {
    id: 'ai.extensions.content.suggestions.error.timeout',
    defaultMessage: 'Generation timed out. Please try again.',
    description: 'Error shown when generation polling exceeds the maximum duration',
  },
  'ai.extensions.content.suggestions.error.network': {
    id: 'ai.extensions.content.suggestions.error.network',
    defaultMessage: 'A network error occurred while checking suggestion status.',
    description: 'Error shown when a poll request fails outright',
  },
  'ai.extensions.content.suggestions.response.title': {
    id: 'ai.extensions.content.suggestions.response.title',
    defaultMessage: 'Content suggestions',
    description: 'Title for the suggestions response panel',
  },
  'ai.extensions.content.suggestions.response.empty': {
    id: 'ai.extensions.content.suggestions.response.empty',
    defaultMessage: 'No suggestions for this content right now.',
    description: 'Shown when the suggestion list is empty for the current scope',
  },
  'ai.extensions.content.suggestions.nav.previous': {
    id: 'ai.extensions.content.suggestions.nav.previous',
    defaultMessage: 'Previous suggestion',
    description: 'Accessible label for the previous-suggestion carousel button',
  },
  'ai.extensions.content.suggestions.nav.next': {
    id: 'ai.extensions.content.suggestions.nav.next',
    defaultMessage: 'Next suggestion',
    description: 'Accessible label for the next-suggestion carousel button',
  },
  'ai.extensions.content.suggestions.nav.counter': {
    id: 'ai.extensions.content.suggestions.nav.counter',
    defaultMessage: '{current} of {total}',
    description: 'Position indicator when paging through a unit\'s suggestions, e.g. "2 of 3"',
  },
  'ai.extensions.content.suggestions.response.clear': {
    id: 'ai.extensions.content.suggestions.response.clear',
    defaultMessage: 'Clear',
    description: 'Button to clear the stored suggestions session',
  },
  'ai.extensions.content.suggestions.card.open.unit': {
    id: 'ai.extensions.content.suggestions.card.open.unit',
    defaultMessage: 'Open unit',
    description: 'Link to open the affected unit in Studio',
  },
  'ai.extensions.content.suggestions.card.current.label': {
    id: 'ai.extensions.content.suggestions.card.current.label',
    defaultMessage: 'Current',
    description: 'Label for the current value in a proposed change diff',
  },
  'ai.extensions.content.suggestions.card.suggested.label': {
    id: 'ai.extensions.content.suggestions.card.suggested.label',
    defaultMessage: 'Suggested',
    description: 'Label for the suggested replacement value in a proposed change diff',
  },
  'ai.extensions.content.suggestions.priority.high': {
    id: 'ai.extensions.content.suggestions.priority.high',
    defaultMessage: 'High',
    description: 'High priority badge label',
  },
  'ai.extensions.content.suggestions.priority.medium': {
    id: 'ai.extensions.content.suggestions.priority.medium',
    defaultMessage: 'Medium',
    description: 'Medium priority badge label',
  },
  'ai.extensions.content.suggestions.priority.low': {
    id: 'ai.extensions.content.suggestions.priority.low',
    defaultMessage: 'Low',
    description: 'Low priority badge label',
  },
});

export default messages;
