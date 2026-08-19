export interface AiPrompt {
  /** Human-readable topic the prompt asks about, e.g. "tip calculator". */
  topic: string;
  /** The exact prompt sent to the provider. */
  prompt: string;
}

export interface AiProvider {
  readonly name: string;
  /** Model identifier the provider is configured with, e.g. "gemini-2.5-flash". */
  readonly model: string;
  readonly requiresCredentials: boolean;
  /**
   * Ask the model a single question and return the raw answer text.
   * May return an empty string when the provider responds with no content;
   * must throw AiUnavailableError for configuration, timeout, rate-limit or
   * API errors so the caller can report an honest state.
   */
  generate(prompt: string): Promise<string>;
}