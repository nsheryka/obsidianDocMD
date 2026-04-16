/**
 * Parse a Markdown string and return Google Docs API requests for creating the document.
 * Ported from the original DocMD Electron app.
 *
 * Returns:
 *   - textRequests:  insertText requests (applied first in one batchUpdate)
 *   - styleRequests: formatting requests (applied second)
 *   - tables:        table data with placeholder positions (applied third)
 *   - images:        local image references for later upload
 */

import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import type { GoogleDocsRequest, GoogleDocument, GoogleTable } from '../google/types';

export interface ImageRef {
  index: number;
  src: string;
  alt: string;
}

export interface TableInfo {
  startIndex: number;
  endIndex: number;
  rows: string[][];
}

export interface MarkdownToDocResult {
  textRequests: GoogleDocsRequest[];
  styleRequests: GoogleDocsRequest[];
  tables: TableInfo[];
  images: ImageRef[];
}

/**
 * Minimal structural type for the remark/mdast AST nodes this converter walks.
 * Only the fields actually consumed here are listed; everything else is left
 * implicit because individual node types are narrowed by their `type` tag.
 */
interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
  depth?: number;
  ordered?: boolean;
  url?: string;
  alt?: string;
  position?: { start: { line: number }; end: { line: number } };
}

interface Collector {
  textParts: { text: string }[];
  styles: GoogleDocsRequest[];
  tables: TableInfo[];
  images: ImageRef[];
  index: number;
}

interface StyleRange {
  startIndex: number;
  endIndex: number;
  bold?: boolean;
  italic?: boolean;
  strikethrough?: boolean;
  inlineCode?: boolean;
  link?: string;
}

export function markdownToDocRequests(markdownContent: string): MarkdownToDocResult {
  // Pre-process Obsidian wikilink images:
  //   ![[file.png]] -> ![file.png](<file.png>)
  //   ![[file.png|300]] -> ![file.png](<file.png>) (strip width)
  markdownContent = markdownContent.replace(
    /!\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g,
    (_match: string, filename: string) => `![${filename}](<${filename}>)`
  );

  const tree = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .parse(markdownContent);

  const col: Collector = {
    textParts: [],
    styles: [],
    tables: [],
    images: [],
    index: 1,
  };

  const children = (tree as { children: MdNode[] }).children;
  for (let i = 0; i < children.length; i++) {
    // Preserve blank lines between blocks by checking position gaps
    const prev = children[i - 1];
    const curr = children[i];
    if (i > 0 && curr.position && prev?.position) {
      const prevEnd = prev.position.end.line;
      const currStart = curr.position.start.line;
      // A gap of 2+ lines means there was at least one blank line
      const blankLines = currStart - prevEnd - 1;
      for (let b = 0; b < blankLines; b++) {
        emit(col, '\n');
      }
    }
    processNode(curr, col);
  }

  // Build text-insertion requests
  const textRequests: GoogleDocsRequest[] = [];
  let idx = 1;
  for (const part of col.textParts) {
    textRequests.push({
      insertText: { location: { index: idx }, text: part.text },
    });
    idx += part.text.length;
  }

  return { textRequests, styleRequests: col.styles, tables: col.tables, images: col.images };
}

// -- Node processors --

function processNode(node: MdNode, col: Collector): void {
  switch (node.type) {
    case 'heading':       processHeading(node, col); break;
    case 'paragraph':     processParagraph(node, col); break;
    case 'list':          processList(node, col, 0); break;
    case 'code':          processCodeBlock(node, col); break;
    case 'blockquote':    processBlockquote(node, col); break;
    case 'table':         processTable(node, col); break;
    case 'thematicBreak': processThematicBreak(col); break;
  }
}

function processHeading(node: MdNode, col: Collector): void {
  const startIndex = col.index;
  emit(col, extractInlineText(node.children ?? []) + '\n');
  col.styles.push({
    updateParagraphStyle: {
      range: { startIndex, endIndex: col.index - 1 },
      paragraphStyle: { namedStyleType: `HEADING_${node.depth ?? 1}` },
      fields: 'namedStyleType',
    },
  });
}

function processParagraph(node: MdNode, col: Collector): void {
  if (!node.children || node.children.length === 0) {
    emit(col, '\n');
    return;
  }
  const startIndex = col.index;
  const { text, styleRanges } = extractInlineTextWithRanges(node.children, startIndex, col.images);
  if (!text) return;
  emit(col, text + '\n');
  for (const r of styleRanges) pushTextStyle(col.styles, r);
}

function processList(node: MdNode, col: Collector, nestingLevel: number): void {
  const ordered = !!node.ordered;
  for (const item of node.children ?? []) {
    if (item.type !== 'listItem') continue;
    for (const child of item.children ?? []) {
      if (child.type === 'paragraph') {
        const startIndex = col.index;
        const { text, styleRanges } = extractInlineTextWithRanges(child.children ?? [], startIndex);
        if (!text) continue;
        emit(col, text + '\n');
        for (const r of styleRanges) pushTextStyle(col.styles, r);
        col.styles.push({
          createParagraphBullets: {
            range: { startIndex, endIndex: col.index - 1 },
            bulletPreset: ordered ? 'NUMBERED_DECIMAL_ALPHA_ROMAN' : 'BULLET_DISC_CIRCLE_SQUARE',
          },
        });
        if (nestingLevel > 0) {
          col.styles.push({
            updateParagraphStyle: {
              range: { startIndex, endIndex: col.index - 1 },
              paragraphStyle: {
                indentFirstLine: { magnitude: nestingLevel * 18, unit: 'PT' },
                indentStart: { magnitude: nestingLevel * 18, unit: 'PT' },
              },
              fields: 'indentFirstLine,indentStart',
            },
          });
        }
      } else if (child.type === 'list') {
        processList(child, col, nestingLevel + 1);
      }
    }
  }
}

function processCodeBlock(node: MdNode, col: Collector): void {
  const startIndex = col.index;
  emit(col, (node.value || '') + '\n');
  col.styles.push({
    updateTextStyle: {
      range: { startIndex, endIndex: col.index - 1 },
      textStyle: {
        weightedFontFamily: { fontFamily: 'Courier New', weight: 400 },
        fontSize: { magnitude: 10, unit: 'PT' },
      },
      fields: 'weightedFontFamily,fontSize',
    },
  });
  col.styles.push({
    updateParagraphStyle: {
      range: { startIndex, endIndex: col.index - 1 },
      paragraphStyle: {
        shading: { backgroundColor: { color: { rgbColor: { red: 0.95, green: 0.95, blue: 0.95 } } } },
      },
      fields: 'shading',
    },
  });
}

function processBlockquote(node: MdNode, col: Collector): void {
  const startIndex = col.index;
  for (const child of node.children ?? []) processNode(child, col);
  col.styles.push({
    updateParagraphStyle: {
      range: { startIndex, endIndex: col.index - 1 },
      paragraphStyle: {
        indentFirstLine: { magnitude: 36, unit: 'PT' },
        indentStart: { magnitude: 36, unit: 'PT' },
      },
      fields: 'indentFirstLine,indentStart',
    },
  });
}

function processTable(node: MdNode, col: Collector): void {
  const rows = (node.children ?? []).filter((n) => n.type === 'tableRow');
  if (rows.length === 0) return;

  const tableData = rows.map((row) =>
    (row.children ?? [])
      .filter((c) => c.type === 'tableCell')
      .map((cell) => extractInlineMarkdown(cell.children ?? []).trim())
  );

  const PLACEHOLDER = '\u200B\n';
  const startIndex = col.index;
  emit(col, PLACEHOLDER);
  col.tables.push({ startIndex, endIndex: col.index, rows: tableData });
}

function processThematicBreak(col: Collector): void {
  const startIndex = col.index;
  emit(col, '\u2500'.repeat(30) + '\n');
  col.styles.push({
    updateTextStyle: {
      range: { startIndex, endIndex: col.index - 1 },
      textStyle: {
        foregroundColor: { color: { rgbColor: { red: 0.6, green: 0.6, blue: 0.6 } } },
      },
      fields: 'foregroundColor',
    },
  });
}

// -- Helpers --

function emit(col: Collector, text: string): void {
  col.textParts.push({ text });
  col.index += text.length;
}

function extractInlineText(nodes: MdNode[]): string {
  return nodes.map(inlineNodeToText).join('');
}

function extractInlineMarkdown(nodes: MdNode[]): string {
  return nodes.map(inlineNodeToMarkdown).join('');
}

function inlineNodeToMarkdown(node: MdNode): string {
  if (node.type === 'text') return node.value ?? '';
  if (node.type === 'strong') return `**${(node.children ?? []).map(inlineNodeToMarkdown).join('')}**`;
  if (node.type === 'emphasis') return `*${(node.children ?? []).map(inlineNodeToMarkdown).join('')}*`;
  if (node.type === 'delete') return `~~${(node.children ?? []).map(inlineNodeToMarkdown).join('')}~~`;
  if (node.type === 'inlineCode') return `\`${node.value ?? ''}\``;
  if (node.type === 'link') return `[${(node.children ?? []).map(inlineNodeToMarkdown).join('')}](${node.url ?? ''})`;
  if (node.type === 'image') return `![${node.alt || ''}](${node.url ?? ''})`;
  if (node.type === 'break') return '\n';
  if (node.type === 'html' && node.value && /^<br\s*\/?>$/i.test(node.value)) return '\n';
  if (node.children) return node.children.map(inlineNodeToMarkdown).join('');
  return '';
}

function extractInlineTextWithRanges(
  nodes: MdNode[],
  baseIndex: number,
  images?: ImageRef[]
): { text: string; styleRanges: StyleRange[] } {
  const styleRanges: StyleRange[] = [];
  let text = '';
  let offset = 0;

  function walk(node: MdNode): void {
    switch (node.type) {
      case 'text': {
        const v = node.value ?? '';
        text += v; offset += v.length; break;
      }
      case 'strong': {
        const s = offset; (node.children ?? []).forEach(walk);
        styleRanges.push({ startIndex: baseIndex + s, endIndex: baseIndex + offset, bold: true }); break;
      }
      case 'emphasis': {
        const s = offset; (node.children ?? []).forEach(walk);
        styleRanges.push({ startIndex: baseIndex + s, endIndex: baseIndex + offset, italic: true }); break;
      }
      case 'delete': {
        const s = offset; (node.children ?? []).forEach(walk);
        styleRanges.push({ startIndex: baseIndex + s, endIndex: baseIndex + offset, strikethrough: true }); break;
      }
      case 'inlineCode': {
        const v = node.value ?? '';
        const s = offset; text += v; offset += v.length;
        styleRanges.push({ startIndex: baseIndex + s, endIndex: baseIndex + offset, inlineCode: true }); break;
      }
      case 'link': {
        const s = offset; (node.children ?? []).forEach(walk);
        styleRanges.push({ startIndex: baseIndex + s, endIndex: baseIndex + offset, link: node.url }); break;
      }
      case 'image': {
        if (images && node.url && !node.url.startsWith('http')) {
          const placeholder = '\uFFFC';
          images.push({ index: baseIndex + offset, src: node.url, alt: node.alt || '' });
          text += placeholder; offset += 1;
        } else {
          const alt = node.alt || '[image]'; text += alt; offset += alt.length;
        }
        break;
      }
      case 'break':
        text += '\n'; offset += 1; break;
      case 'html':
        if (node.value && /^<br\s*\/?>$/i.test(node.value)) { text += '\n'; offset += 1; }
        break;
      default:
        if (node.children) node.children.forEach(walk);
        else if (node.value) { text += node.value; offset += node.value.length; }
    }
  }

  nodes.forEach(walk);
  return { text, styleRanges };
}

function inlineNodeToText(node: MdNode): string {
  if (node.type === 'text') return node.value ?? '';
  if (node.type === 'inlineCode') return node.value ?? '';
  if (node.type === 'image') return node.alt || '[image]';
  if (node.type === 'break') return '\n';
  if (node.type === 'html' && node.value && /^<br\s*\/?>$/i.test(node.value)) return '\n';
  if (node.children) return node.children.map(inlineNodeToText).join('');
  return '';
}

function pushTextStyle(arr: GoogleDocsRequest[], range: StyleRange): void {
  const textStyle: Record<string, unknown> = {};
  const fields: string[] = [];
  if (range.bold) { textStyle.bold = true; fields.push('bold'); }
  if (range.italic) { textStyle.italic = true; fields.push('italic'); }
  if (range.strikethrough) { textStyle.strikethrough = true; fields.push('strikethrough'); }
  if (range.inlineCode) {
    textStyle.weightedFontFamily = { fontFamily: 'Courier New', weight: 400 };
    textStyle.fontSize = { magnitude: 10, unit: 'PT' };
    fields.push('weightedFontFamily', 'fontSize');
  }
  if (range.link) {
    textStyle.link = { url: range.link };
    textStyle.foregroundColor = { color: { rgbColor: { red: 0.07, green: 0.36, blue: 0.87 } } };
    textStyle.underline = true;
    fields.push('link', 'foregroundColor', 'underline');
  }
  if (fields.length === 0) return;
  arr.push({
    updateTextStyle: {
      range: { startIndex: range.startIndex, endIndex: range.endIndex },
      textStyle,
      fields: fields.join(','),
    },
  });
}

// -- Table insertion (called from orchestration after text + styles) --

interface DocsApi {
  getDocument(): Promise<GoogleDocument>;
  batchUpdate(requests: GoogleDocsRequest[]): Promise<unknown>;
}

export async function insertTableIntoDoc(docsApi: DocsApi, tableInfo: TableInfo): Promise<ImageRef[]> {
  const { rows } = tableInfo;
  const rowCount = rows.length;
  const colCount = Math.max(...rows.map((r) => r.length));

  const doc = await docsApi.getDocument();
  const placeholderIndex = findPlaceholder(doc);
  if (placeholderIndex === -1) return [];

  await docsApi.batchUpdate([
    {
      deleteContentRange: {
        range: { startIndex: placeholderIndex, endIndex: placeholderIndex + 1 },
      },
    },
    {
      insertTable: {
        rows: rowCount,
        columns: colCount,
        location: { index: placeholderIndex },
      },
    },
  ]);

  const afterInsert = await docsApi.getDocument();
  const textReqs = buildCellTextInsertions(afterInsert, placeholderIndex, rows);
  if (textReqs.length > 0) {
    await docsApi.batchUpdate(textReqs);
  }

  const afterText = await docsApi.getDocument();
  const styleReqs = buildCellStyleRequests(afterText, placeholderIndex, rows);
  if (styleReqs.length > 0) {
    await docsApi.batchUpdate(styleReqs);
  }

  const cellImages = collectTableCellImages(afterText, placeholderIndex, rows);
  return cellImages;
}

function findPlaceholder(doc: GoogleDocument): number {
  for (const el of doc.body?.content ?? []) {
    if (!el.paragraph) continue;
    for (const pe of el.paragraph.elements ?? []) {
      if (pe.textRun?.content?.includes('\u200B')) {
        return pe.startIndex ?? -1;
      }
    }
  }
  return -1;
}

function parseCellContent(raw: string): { plainText: string; lines: { text: string; isBullet: boolean; isBold: boolean }[]; images: { src: string; alt: string }[] } {
  const images: { src: string; alt: string }[] = [];

  const withPlaceholders = raw.replace(
    /!\[([^\]]*)\]\(([^)]+)\)/g,
    (_match: string, alt: string, src: string) => {
      images.push({ src, alt });
      return '\uFFFC';
    }
  );

  const lineTexts = withPlaceholders.split('\n').filter((l) => l.length > 0);
  const parsed = lineTexts.map((line) => {
    let text = line;
    let isBullet = false;
    let isBold = false;

    if (/^-\s/.test(text)) {
      isBullet = true;
      text = text.replace(/^-\s+/, '');
    }

    const boldMatch = text.match(/^\*\*(.+)\*\*$/);
    if (boldMatch) {
      isBold = true;
      text = boldMatch[1];
    }

    return { text, isBullet, isBold };
  });

  const plainText = parsed.map((p) => p.text).join('\n');
  return { plainText, lines: parsed, images };
}

interface InsertTextRequest extends Record<string, unknown> {
  insertText: { location: { index: number }; text: string };
}

function buildCellTextInsertions(
  doc: GoogleDocument,
  afterIndex: number,
  rows: string[][],
): GoogleDocsRequest[] {
  const requests: InsertTextRequest[] = [];
  const tableEl = findTableAfter(doc, afterIndex);
  if (!tableEl) return requests;

  const tableRows = tableEl.tableRows ?? [];
  for (let r = 0; r < tableRows.length && r < rows.length; r++) {
    const tableRow = tableRows[r];
    const tableCells = tableRow.tableCells ?? [];
    for (let c = 0; c < tableCells.length && c < rows[r].length; c++) {
      const cell = tableCells[c];
      const rawContent = rows[r][c];
      if (!rawContent) continue;

      const firstPara = cell.content?.[0];
      if (!firstPara || !firstPara.paragraph || firstPara.startIndex === undefined) continue;

      const { plainText } = parseCellContent(rawContent);
      requests.push({
        insertText: {
          location: { index: firstPara.startIndex },
          text: plainText,
        },
      });
    }
  }

  requests.sort((a, b) => b.insertText.location.index - a.insertText.location.index);
  return requests;
}

function buildCellStyleRequests(
  doc: GoogleDocument,
  afterIndex: number,
  rows: string[][],
): GoogleDocsRequest[] {
  const requests: GoogleDocsRequest[] = [];
  const tableEl = findTableAfter(doc, afterIndex);
  if (!tableEl) return requests;

  const tableRows = tableEl.tableRows ?? [];
  for (let r = 0; r < tableRows.length && r < rows.length; r++) {
    const tableRow = tableRows[r];
    const tableCells = tableRow.tableCells ?? [];
    for (let c = 0; c < tableCells.length && c < rows[r].length; c++) {
      const cell = tableCells[c];
      const rawContent = rows[r][c];
      if (!rawContent) continue;

      const { lines } = parseCellContent(rawContent);
      const cellParas = (cell.content ?? []).filter((el) => el.paragraph);

      for (let p = 0; p < cellParas.length && p < lines.length; p++) {
        const para = cellParas[p];
        const line = lines[p];
        if (para.startIndex === undefined || para.endIndex === undefined) continue;
        const paraStart = para.startIndex;
        const paraEnd = para.endIndex - 1;

        if (paraStart >= paraEnd) continue;

        if (line.isBold) {
          requests.push({
            updateTextStyle: {
              range: { startIndex: paraStart, endIndex: paraEnd },
              textStyle: { bold: true },
              fields: 'bold',
            },
          });
        }

        if (line.isBullet) {
          requests.push({
            createParagraphBullets: {
              range: { startIndex: paraStart, endIndex: paraEnd },
              bulletPreset: 'BULLET_DISC_CIRCLE_SQUARE',
            },
          });
        }
      }
    }
  }

  return requests;
}

function findTableAfter(doc: GoogleDocument, afterIndex: number): GoogleTable | null {
  for (const el of doc.body?.content ?? []) {
    if (el.table && (el.startIndex ?? -1) >= afterIndex) return el.table;
  }
  return null;
}

function collectTableCellImages(doc: GoogleDocument, afterIndex: number, rows: string[][]): ImageRef[] {
  const images: ImageRef[] = [];
  const tableEl = findTableAfter(doc, afterIndex);
  if (!tableEl) return images;

  const allCellImages: { row: number; col: number; src: string; alt: string }[] = [];
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < (rows[r] || []).length; c++) {
      const rawContent = rows[r][c];
      if (!rawContent) continue;
      const { images: cellImgs } = parseCellContent(rawContent);
      for (const img of cellImgs) {
        allCellImages.push({ row: r, col: c, ...img });
      }
    }
  }
  if (allCellImages.length === 0) return images;

  let imgIdx = 0;
  const tableRows = tableEl.tableRows ?? [];
  for (let r = 0; r < tableRows.length && r < rows.length; r++) {
    const tableRow = tableRows[r];
    const tableCells = tableRow.tableCells ?? [];
    for (let c = 0; c < tableCells.length && c < (rows[r] || []).length; c++) {
      const cell = tableCells[c];
      for (const el of cell.content ?? []) {
        if (!el.paragraph) continue;
        for (const pe of el.paragraph.elements ?? []) {
          if (!pe.textRun || !pe.textRun.content || pe.startIndex === undefined) continue;
          for (let i = 0; i < pe.textRun.content.length; i++) {
            if (pe.textRun.content[i] === '\uFFFC' && imgIdx < allCellImages.length) {
              images.push({
                index: pe.startIndex + i,
                src: allCellImages[imgIdx].src,
                alt: allCellImages[imgIdx].alt,
              });
              imgIdx++;
            }
          }
        }
      }
    }
  }

  return images;
}
