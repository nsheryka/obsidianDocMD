import { requestUrl } from 'obsidian';

const DRIVE_API = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3/files';

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

export function parseDocId(url: string): string {
  const match = url.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
  if (!match) throw new Error('Could not extract document ID from URL. Make sure it is a valid Google Docs link.');
  return match[1];
}

export function parseFolderId(url: string): string {
  const match = url.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (!match) throw new Error('Could not extract folder ID from URL. Make sure it is a valid Google Drive folder link.');
  return match[1];
}

export async function moveFileToFolder(token: string, fileId: string, folderId: string): Promise<void> {
  // Get current parents
  const fileResp = await requestUrl({
    url: `${DRIVE_API}/${fileId}?fields=parents`,
    headers: authHeaders(token),
  });
  const previousParents = (fileResp.json.parents || []).join(',');

  // Move to new folder
  await requestUrl({
    url: `${DRIVE_API}/${fileId}?addParents=${folderId}&removeParents=${previousParents}&fields=id,parents`,
    method: 'PATCH',
    headers: {
      ...authHeaders(token),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  });
}

export async function getFileWebLink(token: string, fileId: string): Promise<string> {
  const response = await requestUrl({
    url: `${DRIVE_API}/${fileId}?fields=webViewLink`,
    headers: authHeaders(token),
  });
  return response.json.webViewLink;
}

export async function deleteFile(token: string, fileId: string): Promise<void> {
  await requestUrl({
    url: `${DRIVE_API}/${fileId}`,
    method: 'DELETE',
    headers: authHeaders(token),
  });
}

/**
 * Upload image data into a temporary Google Doc (via HTML conversion),
 * then read back the Google-internal contentUri. This gives us a URL that
 * Google Docs API can use for insertInlineImage.
 * Returns { contentUri, tempDocId }.
 */
export async function getImageContentUri(
  token: string,
  imageData: ArrayBuffer,
  mimeType: string
): Promise<{ contentUri: string | null; tempDocId: string }> {
  // Convert ArrayBuffer to base64
  const bytes = new Uint8Array(imageData);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = btoa(binary);

  const html = `<html><body><img src="data:${mimeType};base64,${base64}" /></body></html>`;

  // Build multipart request body
  const boundary = '----DocMDBoundary' + Date.now();
  const metadata = JSON.stringify({
    name: 'temp-image-' + Date.now(),
    mimeType: 'application/vnd.google-apps.document',
  });

  const bodyParts = [
    `--${boundary}\r\n`,
    'Content-Type: application/json; charset=UTF-8\r\n\r\n',
    metadata + '\r\n',
    `--${boundary}\r\n`,
    'Content-Type: text/html\r\n\r\n',
    html + '\r\n',
    `--${boundary}--`,
  ];
  const bodyStr = bodyParts.join('');

  // Upload HTML as a Google Doc
  const uploadResp = await requestUrl({
    url: `${UPLOAD_API}?uploadType=multipart&fields=id`,
    method: 'POST',
    headers: {
      ...authHeaders(token),
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body: bodyStr,
  });

  const tempDocId = uploadResp.json.id;

  // Read the temp doc to extract the image's internal contentUri
  const docResp = await requestUrl({
    url: `https://docs.googleapis.com/v1/documents/${tempDocId}`,
    headers: authHeaders(token),
  });

  let contentUri: string | null = null;
  const inlineObjects = docResp.json.inlineObjects;
  if (inlineObjects) {
    for (const obj of Object.values(inlineObjects) as any[]) {
      const uri = obj?.inlineObjectProperties?.embeddedObject?.imageProperties?.contentUri;
      if (uri) {
        contentUri = uri;
        break;
      }
    }
  }

  return { contentUri, tempDocId };
}
