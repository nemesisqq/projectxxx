export interface TranslationResult {
  originalText: string;
  translatedText: string | null;
  skipped: boolean;
  failed: boolean;
  failureReason?: string;
  provider: string;
}

export interface TranslationProvider {
  initialize(): Promise<void>;
  translate(text: string): Promise<TranslationResult>;
  close(): Promise<void>;
}
