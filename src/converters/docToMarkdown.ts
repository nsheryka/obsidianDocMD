/**
 * Convert a Google Docs document JSON (from the Docs API) to a Markdown string.
 * Ported from the original DocMD Electron app with Obsidian-specific changes:
 *   - Images use ![[image.png]] wikilink embed syntax
 *   - Frontmatter added with source URL, converted date, tags
 */

import type {
  GoogleDocument,
  GoogleList,
  GoogleInlineObject,
  GoogleParagraph,
  GoogleTable,
  GoogleTextRun,
} from '../google/types';

const HEADING_PREFIXES: Record<string, string> = {
  HEADING_1: '# ',
  HEADING_2: '## ',
  HEADING_3: '### ',
  HEADING_4: '#### ',
  HEADING_5: '##### ',
  HEADING_6: '###### ',
  TITLE: '# ',
  SUBTITLE: '## ',
  NORMAL_TEXT: '',
};

export interface ConvertOptions {
  sourceUrl?: string;
  frontmatter?: boolean;
  frontmatterTemplate?: string;
}

export function docToMarkdown(doc: GoogleDocument, options?: ConvertOptions): string {
  const { body, lists = {}, inlineObjects = {} } = doc;
  if (!body || !body.content) return '';

  const lines: string[] = [];
  let prevWasList = false;

  for (const element of body.content) {
    if (element.sectionBreak) continue;

    if (element.table) {
      if (prevWasList) lines.push('');
      lines.push(convertTable(element.table, lists, inlineObjects));
      prevWasList = false;
      continue;
    }

    if (element.paragraph) {
      const { text, isList } = convertParagraph(element.paragraph, lists, inlineObjects);
      if (isList) {
        lines.push(text);
        prevWasList = true;
      } else {
        if (prevWasList) lines.push('');
        lines.push(text);
        prevWasList = false;
      }
    }
  }

  let markdown = lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';

  if (options?.frontmatter && options.frontmatterTemplate) {
    const frontmatter = buildFrontmatter(options.frontmatterTemplate, options.sourceUrl);
    markdown = frontmatter + markdown;
  }

  return markdown;
}

function buildFrontmatter(template: string, sourceUrl?: string): string {
  const today = new Date().toISOString().split('T')[0];
  let content = template
    .replace(/\{date\}/g, today)
    .replace(/\{sourceUrl\}/g, sourceUrl || '');
  return `---\n${content}\n---\n`;
}

/**
 * Strip YAML frontmatter from the beginning of a markdown string.
 * Matches content between opening and closing --- markers at the start of the file.
 */
export function stripYamlFrontmatter(markdown: string): string {
  const match = markdown.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/);
  if (match) {
    return markdown.slice(match[0].length);
  }
  return markdown;
}

function convertParagraph(
  para: GoogleParagraph,
  lists: Record<string, GoogleList>,
  inlineObjects: Record<string, GoogleInlineObject>,
): { text: string; isList: boolean } {
  const style = para.paragraphStyle?.namedStyleType || 'NORMAL_TEXT';
  const bullet = para.bullet;

  let text = '';
  for (const elem of para.elements || []) {
    if (elem.textRun) {
      text += convertTextRun(elem.textRun);
    } else if (elem.inlineObjectElement) {
      text += convertInlineObject(elem.inlineObjectElement, inlineObjects);
    } else if (elem.horizontalRule) {
      text += '\n---\n';
    } else if (elem.pageBreak) {
      text += '\n';
    }
  }

  // Strip the trailing newline Google always adds
  text = text.replace(/\n$/, '');

  // Empty paragraph -> blank line
  if (text.trim() === '') {
    return { text: '', isList: false };
  }

  if (bullet) {
    const nestingLevel = bullet.nestingLevel ?? 0;
    const indent = '  '.repeat(nestingLevel);
    const listType = getListGlyphType(lists, bullet.listId ?? '', nestingLevel);
    const prefix = listType === 'ordered' ? '1.' : '-';
    return { text: `${indent}${prefix} ${text}`, isList: true };
  }

  const headingPrefix = HEADING_PREFIXES[style] ?? '';
  return { text: `${headingPrefix}${text}`, isList: false };
}

function convertTextRun(textRun: GoogleTextRun): string {
  let content = textRun.content || '';
  const style = textRun.textStyle || {};

  // Strip vertical tab (soft line break / Shift+Enter in Google Docs)
  content = content.split('\u000B').join('');

  // Strip the trailing newline that Google appends to each paragraph element
  const trailingNewline = content.endsWith('\n') ? '\n' : '';
  content = content.replace(/\n$/, '');

  if (!content) return trailingNewline;

  // Links take precedence over other formatting
  if (style.link?.url) {
    return `[${content}](${style.link.url})${trailingNewline}`;
  }

  // Monospace / inline code
  const fontFamily = style.weightedFontFamily?.fontFamily || '';
  const isMonospace = /courier|mono|code|consolas|menlo/i.test(fontFamily);

  if (isMonospace) {
    return `\`${content}\`${trailingNewline}`;
  }

  const bold = style.bold;
  const italic = style.italic;
  const strike = style.strikethrough;

  if (bold && italic) {
    content = `***${content}***`;
  } else if (bold) {
    content = `**${content}**`;
  } else if (italic) {
    content = `*${content}*`;
  }

  if (strike) {
    content = `~~${content}~~`;
  }

  return content + trailingNewline;
}

function convertInlineObject(
  inlineObjectElement: { inlineObjectId?: string },
  inlineObjects: Record<string, GoogleInlineObject>,
): string {
  const id = inlineObjectElement.inlineObjectId;
  if (!id || !inlineObjects[id]) return '';

  const embeddedObject = inlineObjects[id]?.inlineObjectProperties?.embeddedObject;
  if (!embeddedObject) return '';

  const uri = embeddedObject.imageProperties?.contentUri || embeddedObject.imageProperties?.sourceUri || '';
  const altText = embeddedObject.title || embeddedObject.description || 'image';
  if (!uri) return '';

  // Use Obsidian wikilink embed syntax. The image URL will be replaced with a
  // local filename after download in the images converter step.
  return `![${altText}](${uri})`;
}

function convertTable(
  table: GoogleTable,
  lists: Record<string, GoogleList>,
  inlineObjects: Record<string, GoogleInlineObject>,
): string {
  const rows = table.tableRows || [];
  if (rows.length === 0) return '';

  const mdRows = rows.map((row) => {
    const cells = (row.tableCells || []).map((cell) => {
      const cellText = (cell.content || [])
        .map((elem) => {
          if (elem.paragraph) {
            const { text } = convertParagraph(elem.paragraph, lists, inlineObjects);
            return text.trim();
          }
          return '';
        })
        .filter(Boolean)
        .join('<br>');
      return cellText.replace(/\|/g, '\\|');
    });
    return `| ${cells.join(' | ')} |`;
  });

  if (mdRows.length === 0) return '';

  // Insert separator after header row
  const colCount = (rows[0].tableCells || []).length;
  const separator = `| ${Array(colCount).fill('---').join(' | ')} |`;

  return [mdRows[0], separator, ...mdRows.slice(1)].join('\n') + '\n';
}

function getListGlyphType(
  lists: Record<string, GoogleList>,
  listId: string,
  nestingLevel: number,
): string {
  try {
    const nestingLevels = lists[listId]?.listProperties?.nestingLevels || [];
    const level = nestingLevels[nestingLevel] || {};
    const glyphType = level.glyphType || level.glyphSymbol;
    if (glyphType && ['DECIMAL', 'ZERO_DECIMAL', 'UPPER_ALPHA', 'ALPHA', 'UPPER_ROMAN', 'ROMAN'].includes(glyphType)) {
      return 'ordered';
    }
    return 'unordered';
  } catch {
    return 'unordered';
  }
}
