/**
 * Image download and resolution for the Obsidian vault.
 * Ported from the original DocMD Electron app.
 * Replaces Node http/https/fs with Obsidian's requestUrl and vault API.
 */

import { App, TFile, requestUrl, normalizePath } from 'obsidian';

/**
 * Download all remote images in a markdown string, save them to the vault's
 * attachment folder, and replace URLs with ![[filename]] wikilink embeds.
 */
export async function downloadImagesInMarkdown(
  app: App,
  markdown: string,
  notePath: string,
  prefix = ''
): Promise<string> {
  const imageRegex = /!\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g;
  let match;
  let imageIndex = 0;
  const replacements: { fullMatch: string; replacement: string }[] = [];

  while ((match = imageRegex.exec(markdown)) !== null) {
    const [fullMatch, , imageUrl] = match;
    const ext = guessExtension(imageUrl);
    const filename = `${prefix}image-${++imageIndex}${ext}`;

    try {
      const data = await fetchImageBuffer(imageUrl);
      const attachmentPath = getAttachmentPath(app, notePath, filename);

      // Ensure parent folder exists
      const parentPath = attachmentPath.substring(0, attachmentPath.lastIndexOf('/'));
      if (parentPath && !app.vault.getAbstractFileByPath(parentPath)) {
        await app.vault.createFolder(parentPath);
      }

      // Overwrite if file already exists (re-import case)
      const existing = app.vault.getAbstractFileByPath(attachmentPath);
      if (existing && existing instanceof TFile) {
        await app.vault.modifyBinary(existing, data);
      } else {
        await app.vault.createBinary(attachmentPath, data);
      }
      replacements.push({ fullMatch, replacement: `![[${filename}]]` });
    } catch (err) {
      // Keep original URL if download fails
      console.error(`DocMD: Failed to download image: ${(err as Error).message}`);
    }
  }

  let result = markdown;
  for (const { fullMatch, replacement } of replacements) {
    result = result.replace(fullMatch, replacement);
  }
  return result;
}

/**
 * Fetch an image as an ArrayBuffer using Obsidian's requestUrl (bypasses CORS).
 */
async function fetchImageBuffer(url: string): Promise<ArrayBuffer> {
  const response = await requestUrl({ url });
  return response.arrayBuffer;
}

/**
 * Get the path where an attachment should be saved, respecting the vault's
 * attachment folder configuration.
 */
function getAttachmentPath(app: App, notePath: string, filename: string): string {
  const attachmentFolder =
    (app.vault as unknown as { getConfig: (key: string) => string | undefined })
      .getConfig('attachmentFolderPath') || '';
  let folder: string;

  if (!attachmentFolder || attachmentFolder === '/') {
    // Root of vault
    folder = '';
  } else if (attachmentFolder === './') {
    // Same folder as the note
    const noteDir = notePath.substring(0, notePath.lastIndexOf('/'));
    folder = noteDir;
  } else if (attachmentFolder.startsWith('./')) {
    // Subfolder relative to note
    const noteDir = notePath.substring(0, notePath.lastIndexOf('/'));
    folder = noteDir ? `${noteDir}/${attachmentFolder.slice(2)}` : attachmentFolder.slice(2);
  } else {
    // Absolute path within vault
    folder = attachmentFolder;
  }

  return normalizePath(folder ? `${folder}/${filename}` : filename);
}

/**
 * Resolve an image source to a TFile in the vault.
 * Tries metadataCache first, then falls back to checking common attachment locations.
 */
export function resolveImageInVault(app: App, src: string, sourcePath: string): TFile | null {
  // Strip angle brackets if present (from markdown conversion: <file.png>)
  src = src.replace(/^<|>$/g, '');

  // Try Obsidian's built-in wikilink resolution first
  const resolved = app.metadataCache.getFirstLinkpathDest(src, sourcePath);
  if (resolved && resolved instanceof TFile) return resolved;

  // Try just the basename
  const basename = src.split('/').pop() || src;
  if (basename !== src) {
    const byName = app.metadataCache.getFirstLinkpathDest(basename, sourcePath);
    if (byName && byName instanceof TFile) return byName;
  }

  // Fall back to checking common attachment folders
  const noteDir = sourcePath.substring(0, sourcePath.lastIndexOf('/'));
  const candidates = [
    normalizePath(`${noteDir}/${src}`),
    normalizePath(`${noteDir}/attachments/${basename}`),
    normalizePath(`${noteDir}/Attachments/${basename}`),
    normalizePath(`${noteDir}/assets/${basename}`),
    normalizePath(`${noteDir}/images/${basename}`),
  ];

  for (const candidate of candidates) {
    const file = app.vault.getAbstractFileByPath(candidate);
    if (file && file instanceof TFile) return file;
  }

  return null;
}

/**
 * Determine file extension from URL.
 */
export function guessExtension(url: string): string {
  const extMatch = url.match(/\.(png|jpg|jpeg|gif|svg|webp|bmp)(\?|$)/i);
  if (extMatch) return '.' + extMatch[1].toLowerCase();
  return '.png';
}

/**
 * Guess MIME type from a file path or filename.
 */
export function guessMimeType(filePath: string): string {
  const ext = (filePath.match(/\.[^.]+$/) || ['.png'])[0].toLowerCase();
  const map: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.bmp': 'image/bmp',
  };
  return map[ext] || 'image/png';
}
