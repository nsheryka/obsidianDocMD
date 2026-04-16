/**
 * Line-level and word-level diff using the LCS algorithm.
 */

export interface DiffEntry {
  type: 'equal' | 'removed' | 'added' | 'modified';
  oldLine?: string;
  newLine?: string;
}

export interface WordSegment {
  text: string;
  changed: boolean;
}

export function computeLineDiff(oldLines: string[], newLines: string[]): DiffEntry[] {
  const m = oldLines.length;
  const n = newLines.length;

  // Build LCS table
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to build raw diff
  const raw: DiffEntry[] = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      raw.push({ type: 'equal', oldLine: oldLines[i - 1], newLine: newLines[j - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      raw.push({ type: 'added', newLine: newLines[j - 1] });
      j--;
    } else {
      raw.push({ type: 'removed', oldLine: oldLines[i - 1] });
      i--;
    }
  }

  raw.reverse();

  // Post-process: pair adjacent removed+added blocks as 'modified'
  const result: DiffEntry[] = [];
  let idx = 0;
  while (idx < raw.length) {
    if (raw[idx].type === 'removed') {
      // Collect consecutive removed lines
      const removed: DiffEntry[] = [];
      while (idx < raw.length && raw[idx].type === 'removed') {
        removed.push(raw[idx]);
        idx++;
      }
      // Collect consecutive added lines that follow
      const added: DiffEntry[] = [];
      while (idx < raw.length && raw[idx].type === 'added') {
        added.push(raw[idx]);
        idx++;
      }
      // Pair them up as modified where possible
      const pairs = Math.min(removed.length, added.length);
      for (let p = 0; p < pairs; p++) {
        result.push({ type: 'modified', oldLine: removed[p].oldLine, newLine: added[p].newLine });
      }
      // Remaining unpaired lines
      for (let p = pairs; p < removed.length; p++) {
        result.push(removed[p]);
      }
      for (let p = pairs; p < added.length; p++) {
        result.push(added[p]);
      }
    } else {
      result.push(raw[idx]);
      idx++;
    }
  }

  return result;
}

/**
 * Compute word-level diff between two strings.
 * Returns segments for each side with a flag indicating whether the segment changed.
 */
export function computeWordDiff(oldStr: string, newStr: string): { oldSegments: WordSegment[]; newSegments: WordSegment[] } {
  const oldWords = tokenize(oldStr);
  const newWords = tokenize(newStr);

  const m = oldWords.length;
  const n = newWords.length;

  // LCS on words
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldWords[i - 1] === newWords[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack
  let i2 = m;
  let j2 = n;

  const oldResult: { text: string; changed: boolean }[] = [];
  const newResult: { text: string; changed: boolean }[] = [];

  while (i2 > 0 || j2 > 0) {
    if (i2 > 0 && j2 > 0 && oldWords[i2 - 1] === newWords[j2 - 1]) {
      oldResult.push({ text: oldWords[i2 - 1], changed: false });
      newResult.push({ text: newWords[j2 - 1], changed: false });
      i2--;
      j2--;
    } else if (j2 > 0 && (i2 === 0 || dp[i2][j2 - 1] >= dp[i2 - 1][j2])) {
      newResult.push({ text: newWords[j2 - 1], changed: true });
      j2--;
    } else {
      oldResult.push({ text: oldWords[i2 - 1], changed: true });
      i2--;
    }
  }

  oldResult.reverse();
  newResult.reverse();

  // Merge adjacent segments with same changed status
  return {
    oldSegments: mergeSegments(oldResult),
    newSegments: mergeSegments(newResult),
  };
}

/**
 * Tokenize a string into words and whitespace, preserving all characters.
 */
function tokenize(str: string): string[] {
  const tokens: string[] = [];
  const regex = /(\S+|\s+)/g;
  let match;
  while ((match = regex.exec(str)) !== null) {
    tokens.push(match[0]);
  }
  return tokens;
}

function mergeSegments(segments: WordSegment[]): WordSegment[] {
  if (segments.length === 0) return segments;
  const merged: WordSegment[] = [segments[0]];
  for (let i = 1; i < segments.length; i++) {
    const last = merged[merged.length - 1];
    if (last.changed === segments[i].changed) {
      last.text += segments[i].text;
    } else {
      merged.push({ ...segments[i] });
    }
  }
  return merged;
}
