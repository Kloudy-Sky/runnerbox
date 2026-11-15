// A stand-in of runnerbox's, not T3 Code's file: T3 Code's `model:` mentions in the
// composer's text. Runnerbox picks the model beside the composer, so the text never holds one.
export interface ComposerModelMentionOccurrence {
  readonly instanceId: string;
  readonly model: string;
  readonly source: string;
  readonly start: number;
  readonly end: number;
}

export const collectComposerModelMentions = (_text: string): ReadonlyArray<ComposerModelMentionOccurrence> => [];
