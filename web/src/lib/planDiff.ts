/**
 * Line diff for EXPLAIN plans (QueryCompare's "EXPLAIN Diff" tab).
 *
 * Plan text is noisy: indentation, tree glyphs (│ ├ └ ──) and bracketed node
 * ids / hex addresses ([123], [0x7f…]) differ even between structurally
 * identical plans. Normalization strips that noise before the LCS diff, but
 * rows carry the ORIGINAL line text so the output renders what the server
 * actually said.
 */

export type DiffRowKind = "same" | "added" | "removed" | "changed";

export interface DiffRow {
  text: string;
  kind: DiffRowKind;
}

/**
 * Normalize one plan line for comparison: trim, strip leading tree glyphs,
 * and drop bracketed numeric/hex ids. Returns the comparison key.
 */
export function normalizePlanLine(line: string): string {
  let s = line.trim();
  // Leading tree glyphs + the spaces around them ("│ ", "├─", "└──", "──").
  s = s.replace(/^[│├└─\s]+/, "");
  // Bracketed node ids / hex addresses: [123], [0x7f3a…], [0x…].
  s = s.replace(/\[0x[0-9a-fA-F]+\]|\[\d+\]/g, "");
  return s.trim();
}

/** True when two normalized lines differ only in their numbers (metric values). */
function differsOnlyInNumbers(a: string, b: string): boolean {
  const strip = (s: string) => s.replace(/\d+(?:\.\d+)?/g, "#");
  return a !== b && strip(a) === strip(b);
}

/**
 * Diff plan A (left/removed) against plan B (right/added).
 *
 * Returns render rows in reading order: unchanged lines as "same", lines only
 * in B as "added", lines only in A as "removed". When a removed line pairs
 * with an added line at the same position of a replace block and the two
 * differ only in numbers (a metric value like "Parts: 5" → "Parts: 7"), the
 * pair collapses into a single "changed" row showing B's text.
 */
export function diffPlans(a: string, b: string): DiffRow[] {
  const linesA = a.split("\n").filter((l) => l.trim() !== "");
  const linesB = b.split("\n").filter((l) => l.trim() !== "");
  const normA = linesA.map(normalizePlanLine);
  const normB = linesB.map(normalizePlanLine);

  // Classic LCS DP table. Plan outputs are hundreds of lines at most, so the
  // O(n·m) table is fine.
  const n = normA.length;
  const m = normB.length;
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = normA[i] === normB[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  // Walk the LCS to produce same/removed/added runs.
  const rows: DiffRow[] = [];
  const removedRun: string[] = [];
  const addedRun: string[] = [];

  const flushReplaceBlock = () => {
    if (removedRun.length === 0 && addedRun.length === 0) return;
    // Pair up the two runs positionally:
    //   - identical normalized lines are a moved line → one "same" row;
    //   - a pair differing only in numbers is a changed metric value → one
    //     "changed" row showing B's text;
    //   - anything else is a genuine remove+add.
    const paired = Math.min(removedRun.length, addedRun.length);
    for (let k = 0; k < paired; k++) {
      const r = removedRun[k];
      const a = addedRun[k];
      const nr = normalizePlanLine(r);
      const na = normalizePlanLine(a);
      if (nr === na) {
        rows.push({ text: a, kind: "same" });
      } else if (differsOnlyInNumbers(nr, na)) {
        rows.push({ text: a, kind: "changed" });
      } else {
        rows.push({ text: r, kind: "removed" });
        rows.push({ text: a, kind: "added" });
      }
    }
    for (let k = paired; k < removedRun.length; k++) rows.push({ text: removedRun[k], kind: "removed" });
    for (let k = paired; k < addedRun.length; k++) rows.push({ text: addedRun[k], kind: "added" });
    removedRun.length = 0;
    addedRun.length = 0;
  };

  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (normA[i] === normB[j]) {
      flushReplaceBlock();
      rows.push({ text: linesB[j], kind: "same" });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      removedRun.push(linesA[i]);
      i++;
    } else {
      addedRun.push(linesB[j]);
      j++;
    }
  }
  while (i < n) removedRun.push(linesA[i++]);
  while (j < m) addedRun.push(linesB[j++]);
  flushReplaceBlock();

  return rows;
}
