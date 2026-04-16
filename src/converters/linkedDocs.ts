/**
 * Recursive conversion for linked documents (both directions).
 * Ported from the original DocMD Electron app.
 * Replaces fs/path with Obsidian vault API and normalizePath.
 */

import { App, TFile, normalizePath } from 'obsidian';
import { parseDocId } from '../google/drive';
import { getDocument, createDocument, batchUpdate } from '../google/docs';
import type { GoogleDocsRequest } from '../google/types';
import {
  parseFolderId,
  moveFileToFolder,
  getFileWebLink,
  getImageContentUri,
  deleteFile,
} from '../google/drive';
import { docToMarkdown, ConvertOptions, stripYamlFrontmatter } from './docToMarkdown';
import { markdownToDocRequests, insertTableIntoDoc, ImageRef } from './markdownToDoc';
import { downloadImagesInMarkdown, resolveImageInVault, guessMimeType } from './images';

type ProgressFn = (message: string) => void;
type ConflictFn = (filePath: string, newContent: string) => Promise<{ action: string; newFilename?: string }>;

// -- Doc -> MD with linked docs --

interface DocInfo {
  title: string;
  safeTitle: string;
  notePath: string;
  markdown: string;
}

export async function convertDocWithLinks(
  app: App,
  token: string,
  docUrls: string[],
  outputFolder: string,
  onProgress: ProgressFn,
  checkConflict?: ConflictFn,
  convertOptions?: Partial<ConvertOptions>
): Promise<{ files: { title: string; notePath: string }[]; errors: { url: string; error: string }[] }> {
  const visited = new Map<string, DocInfo | null>();
  const errors: { url: string; error: string }[] = [];
  const queue = [...docUrls];
  const usedFilenames = new Set<string>();

  while (queue.length > 0) {
    const url = queue.shift()!;
    let docId: string;
    try {
      docId = parseDocId(url);
    } catch {
      errors.push({ url, error: 'Invalid Google Doc URL' });
      continue;
    }

    if (visited.has(docId)) continue;
    visited.set(docId, null);

    onProgress(`Fetching: ${url}`);

    try {
      const doc = await getDocument(token, docId);
      let markdown = docToMarkdown(doc, { sourceUrl: url, ...convertOptions });

      const safeTitle = uniqueFilename(sanitizeFilename(doc.title || 'document'), usedFilenames);
      const notePath = normalizePath(
        outputFolder ? `${outputFolder}/${safeTitle}.md` : `${safeTitle}.md`
      );

      // Download images
      const prefix = `${docId.slice(0, 8)}-`;
      markdown = await downloadImagesInMarkdown(app, markdown, notePath, prefix);

      visited.set(docId, { title: doc.title ?? 'Untitled', safeTitle, notePath, markdown });

      // Find linked Google Docs
      const linkedUrls = findGoogleDocLinks(markdown);
      for (const linkedUrl of linkedUrls) {
        const linkedId = parseDocIdSafe(linkedUrl);
        if (linkedId && !visited.has(linkedId)) {
          queue.push(linkedUrl);
        }
      }
    } catch (err) {
      errors.push({ url, error: (err as Error).message });
    }
  }

  // Second pass: replace Google Doc URLs with wikilinks, then write files
  for (const [, info] of visited) {
    if (!info) continue;
    let markdown = info.markdown;

    for (const [otherDocId, otherInfo] of visited) {
      if (!otherInfo) continue;
      const linkPattern = new RegExp(
        `\\[([^\\]]*)\\]\\(https://docs\\.google\\.com/document/d/${otherDocId}[^)]*\\)`,
        'g'
      );
      markdown = markdown.replace(linkPattern, `[[${otherInfo.safeTitle}]]`);
    }

    let notePath = info.notePath;
    if (checkConflict) {
      const existing = app.vault.getAbstractFileByPath(notePath);
      if (existing) {
        const resolution = await checkConflict(notePath, markdown);
        if (resolution.action === 'cancel') {
          onProgress(`Skipped: ${notePath}`);
          continue;
        }
        if (resolution.action === 'rename' && resolution.newFilename) {
          const folder = notePath.substring(0, notePath.lastIndexOf('/'));
          notePath = normalizePath(
            folder ? `${folder}/${resolution.newFilename}.md` : `${resolution.newFilename}.md`
          );
          info.notePath = notePath;
        }
      }
    }

    const existing = app.vault.getAbstractFileByPath(notePath);
    if (existing instanceof TFile) {
      await app.vault.modify(existing, markdown);
    } else {
      await app.vault.create(notePath, markdown);
    }
    onProgress(`Saved: ${notePath}`);
  }

  const files = [...visited.values()]
    .filter((v): v is DocInfo => v !== null)
    .map((v) => ({ title: v.title, notePath: v.notePath }));

  return { files, errors };
}

// -- MD -> Doc with linked docs --

interface MdInfo {
  title: string;
  markdown: string;
  file: TFile;
}

export async function convertMdWithLinks(
  app: App,
  token: string,
  files: TFile[],
  driveFolderUrl: string,
  onProgress: ProgressFn,
  shouldStripFrontmatter = false
): Promise<{ files: { title: string; docUrl: string }[]; errors: { path: string; error: string }[] }> {
  const folderId = parseFolderId(driveFolderUrl);
  const visited = new Map<string, MdInfo | null>();
  const errors: { path: string; error: string }[] = [];
  const queue = [...files];

  // First pass: read all linked .md files
  while (queue.length > 0) {
    const file = queue.shift()!;
    if (visited.has(file.path)) continue;
    visited.set(file.path, null);

    onProgress(`Reading: ${file.basename}`);

    try {
      const markdown = await app.vault.read(file);
      visited.set(file.path, { title: file.basename, markdown, file });

      // Find linked local .md files via wikilinks
      const linkedFiles = findWikiLinkedFiles(app, markdown, file.path);
      for (const linkedFile of linkedFiles) {
        if (!visited.has(linkedFile.path)) {
          queue.push(linkedFile);
        }
      }
    } catch (err) {
      errors.push({ path: file.path, error: (err as Error).message });
    }
  }

  // Second pass: create all Google Docs (empty) to get their URLs
  const docMap = new Map<string, { docId: string; docUrl: string; title: string }>();

  for (const [filePath, info] of visited) {
    if (!info) continue;
    onProgress(`Creating Google Doc: "${info.title}"`);

    try {
      const newDoc = await createDocument(token, info.title);
      const docId = newDoc.documentId;
      if (!docId) throw new Error('Google Docs API did not return a document ID');
      await moveFileToFolder(token, docId, folderId);
      const docUrl = await getFileWebLink(token, docId);
      docMap.set(filePath, { docId, docUrl, title: info.title });
    } catch (err) {
      errors.push({ path: filePath, error: (err as Error).message });
    }
  }

  // Third pass: replace wikilinks with Doc URLs, then populate each doc
  for (const [filePath, info] of visited) {
    if (!info || !docMap.has(filePath)) continue;
    const { docId } = docMap.get(filePath)!;

    let markdown = info.markdown;

    // Replace wikilinks [[title]] with Google Doc links
    markdown = markdown.replace(
      /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g,
      (match, linkTarget) => {
        for (const [linkedPath, linkedDoc] of docMap) {
          const linkedInfo = visited.get(linkedPath);
          if (linkedInfo && linkedInfo.title === linkTarget) {
            return `[${linkTarget}](${linkedDoc.docUrl})`;
          }
        }
        return match;
      }
    );

    // Strip YAML frontmatter before uploading if requested
    if (shouldStripFrontmatter) {
      markdown = stripYamlFrontmatter(markdown);
    }

    onProgress(`Populating: "${info.title}"`);

    try {
      await populateDoc(app, token, docId, markdown, info.file);
    } catch (err) {
      errors.push({ path: filePath, error: `Failed to populate: ${(err as Error).message}` });
    }
  }

  const result = [...docMap.values()];
  return { files: result, errors };
}

// -- Shared: populate a Google Doc from markdown --

async function populateDoc(app: App, token: string, docId: string, markdown: string, sourceFile: TFile): Promise<void> {
  const { textRequests, styleRequests, tables, images } = markdownToDocRequests(markdown);

  // Pass 1: text
  if (textRequests.length > 0) {
    await batchUpdate(token, docId, textRequests);
  }

  // Pass 1.5: images (reverse order)
  if (images.length > 0) {
    await insertImages(app, token, docId, images, sourceFile.path);
  }

  // Pass 2: styles
  if (styleRequests.length > 0) {
    await batchUpdate(token, docId, styleRequests);
  }

  // Pass 3: tables
  const allTableCellImages: ImageRef[] = [];
  if (tables.length > 0) {
    const docsApi = {
      getDocument: () => getDocument(token, docId),
      batchUpdate: (reqs: GoogleDocsRequest[]) => batchUpdate(token, docId, reqs),
    };
    for (const tableInfo of tables) {
      const cellImages = await insertTableIntoDoc(docsApi, tableInfo);
      if (cellImages && cellImages.length > 0) {
        allTableCellImages.push(...cellImages);
      }
    }
  }

  // Pass 4: table cell images
  if (allTableCellImages.length > 0) {
    await insertImages(app, token, docId, allTableCellImages, sourceFile.path);
  }
}

async function insertImages(app: App, token: string, docId: string, images: ImageRef[], sourcePath: string): Promise<void> {
  for (const img of [...images].sort((a, b) => b.index - a.index)) {
    const imageFile = resolveImageInVault(app, img.src, sourcePath);
    if (!imageFile) {
      console.error(`DocMD: Image not found: ${img.src}`);
      continue;
    }
    try {
      const mimeType = guessMimeType(imageFile.path);
      const imageData = await app.vault.readBinary(imageFile);

      const { contentUri, tempDocId } = await getImageContentUri(token, imageData, mimeType);
      if (!contentUri) {
        console.error(`DocMD: Failed to get content URI for ${img.src}`);
        if (tempDocId) {
          try {
            await deleteFile(token, tempDocId);
          } catch {
            // Best-effort cleanup; ignore errors
          }
        }
        continue;
      }

      await batchUpdate(token, docId, [
        { deleteContentRange: { range: { startIndex: img.index, endIndex: img.index + 1 } } },
      ]);
      await batchUpdate(token, docId, [
        { insertInlineImage: { location: { index: img.index }, uri: contentUri } },
      ]);

      try {
        await deleteFile(token, tempDocId);
      } catch {
        // Best-effort cleanup; ignore errors
      }
    } catch (err) {
      console.error(`DocMD: Failed to insert image ${img.src}: ${(err as Error).message}`);
    }
  }
}

// -- Helpers --

const GOOGLE_DOC_URL_REGEX = /https:\/\/docs\.google\.com\/document\/d\/[a-zA-Z0-9_-]+[^\s)"']*/g;

function findGoogleDocLinks(markdown: string): string[] {
  const matches = markdown.match(GOOGLE_DOC_URL_REGEX) || [];
  return [...new Set(matches)];
}

function findWikiLinkedFiles(app: App, markdown: string, sourcePath: string): TFile[] {
  const files: TFile[] = [];
  const seen = new Set<string>();
  const regex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
  let match;
  while ((match = regex.exec(markdown)) !== null) {
    const linkTarget = match[1];
    if (seen.has(linkTarget)) continue;
    seen.add(linkTarget);
    const resolved = app.metadataCache.getFirstLinkpathDest(linkTarget, sourcePath);
    if (resolved && resolved instanceof TFile && resolved.extension === 'md') {
      files.push(resolved);
    }
  }
  return files;
}

function parseDocIdSafe(url: string): string | null {
  try {
    return parseDocId(url);
  } catch {
    return null;
  }
}

function sanitizeFilename(title: string): string {
  return title
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function uniqueFilename(base: string, usedSet: Set<string>): string {
  let name = base;
  let counter = 2;
  while (usedSet.has(name)) {
    name = `${base}-${counter++}`;
  }
  usedSet.add(name);
  return name;
}
