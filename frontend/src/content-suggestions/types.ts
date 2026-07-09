export type ContentSuggestionsStep = 'idle' | 'generating' | 'loading' | 'error';

export interface ProposedChange {
  field: 'display_name' | 'content_html' | 'summary';
  current: string;
  suggested: string;
}

export interface ContentSuggestion {
  id: string;
  unitId: string;
  unitDisplayName: string;
  type: 'wording' | 'structure' | 'pedagogy' | 'accessibility';
  priority: 'high' | 'medium' | 'low';
  title: string;
  suggestion: string;
  proposedChange: ProposedChange | null;
  sectionId: string | null;
  sectionDisplayName: string | null;
  subsectionId: string | null;
  subsectionDisplayName: string | null;
}

export interface ContentSuggestionsResult {
  suggestions: ContentSuggestion[];
  courseSuggestions: ContentSuggestion[];
  extraInstructions: string;
}
