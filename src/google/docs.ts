import { requestUrl } from 'obsidian';

const BASE_URL = 'https://docs.googleapis.com/v1/documents';

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

export async function getDocument(token: string, docId: string): Promise<any> {
  const response = await requestUrl({
    url: `${BASE_URL}/${docId}`,
    headers: authHeaders(token),
  });
  return response.json;
}

export async function createDocument(token: string, title: string): Promise<any> {
  const response = await requestUrl({
    url: BASE_URL,
    method: 'POST',
    headers: {
      ...authHeaders(token),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ title }),
  });
  return response.json;
}

export async function batchUpdate(token: string, docId: string, requests: any[]): Promise<any> {
  if (!requests || requests.length === 0) return;
  const response = await requestUrl({
    url: `${BASE_URL}/${docId}:batchUpdate`,
    method: 'POST',
    headers: {
      ...authHeaders(token),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ requests }),
  });
  return response.json;
}
