export type ContentDocType =
  | "unit"
  | "synergy"
  | "item"
  | "relic"
  | "talent"
  | "patch";

export interface ContentDoc {
  id: string;
  docType: ContentDocType;
  title: string;
  content: string;
  urlPath: string | null;
  contentHash: string;
}

export interface MatchedContentDoc {
  id: string;
  docType: ContentDocType;
  title: string;
  content: string;
  urlPath: string | null;
  similarity: number;
}

export interface ChatSource {
  id: string;
  title: string;
  urlPath: string | null;
  similarity: number;
}
