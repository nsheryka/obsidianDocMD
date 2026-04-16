/**
 * Minimal type declarations for the subset of the Google Docs / Drive JSON
 * structures this plugin reads and emits. These intentionally model only the
 * fields we touch; everything else is left as `unknown` or omitted.
 */

export interface GoogleDocument {
  documentId?: string;
  title?: string;
  body?: { content?: GoogleStructuralElement[] };
  lists?: Record<string, GoogleList>;
  inlineObjects?: Record<string, GoogleInlineObject>;
}

export interface GoogleStructuralElement {
  startIndex?: number;
  endIndex?: number;
  sectionBreak?: unknown;
  table?: GoogleTable;
  paragraph?: GoogleParagraph;
}

export interface GoogleParagraph {
  paragraphStyle?: { namedStyleType?: string };
  bullet?: { listId?: string; nestingLevel?: number };
  elements?: GoogleParagraphElement[];
}

export interface GoogleParagraphElement {
  startIndex?: number;
  endIndex?: number;
  textRun?: GoogleTextRun;
  inlineObjectElement?: { inlineObjectId?: string };
  horizontalRule?: unknown;
  pageBreak?: unknown;
}

export interface GoogleTextRun {
  content?: string;
  textStyle?: GoogleTextStyle;
}

export interface GoogleTextStyle {
  bold?: boolean;
  italic?: boolean;
  strikethrough?: boolean;
  link?: { url?: string };
  weightedFontFamily?: { fontFamily?: string };
}

export interface GoogleTable {
  tableRows?: GoogleTableRow[];
}

export interface GoogleTableRow {
  tableCells?: GoogleTableCell[];
}

export interface GoogleTableCell {
  content?: GoogleStructuralElement[];
}

export interface GoogleList {
  listProperties?: {
    nestingLevels?: { glyphType?: string; glyphSymbol?: string }[];
  };
}

export interface GoogleInlineObject {
  inlineObjectProperties?: {
    embeddedObject?: {
      title?: string;
      description?: string;
      imageProperties?: { contentUri?: string; sourceUri?: string };
    };
  };
}

/**
 * Generic Docs batchUpdate request. The Docs API accepts many request shapes;
 * we just need an object that JSON.stringify can serialize.
 */
export type GoogleDocsRequest = Record<string, unknown>;
