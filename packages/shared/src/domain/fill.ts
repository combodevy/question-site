export const FILL_BLANK_SEP = ';;';

export function normalizeFillToken(s: string): string {
  const fullToHalf = String(s || '').replace(/[\uFF01-\uFF5E]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0xfee0),
  );
  return fullToHalf.trim().toLowerCase().replace(/\s+/g, '');
}

/**
 * Splits a serialized fill-in-the-blank answer string into blanks and per-blank synonyms.
 * Multi-blank format: "alt1|alt2;;blank2Alt1|blank2Alt2"
 * Single-blank backward-compatible format: "alt1|alt2"
 */
export function parseFillBlanks(answerStr: string): string[][] {
  return String(answerStr || '')
    .split(/;;|；；/)
    .map((segment) =>
      segment
        .split('|')
        .map((alt) => alt.trim())
        .filter(Boolean),
    )
    .filter((alts) => alts.length > 0);
}

/**
 * Serializes an array of per-blank answer strings (each may contain `|` alternatives)
 * into canonical `;;`-delimited format.
 */
export function serializeFillBlanks(blanks: string[]): string {
  return blanks
    .map((b) =>
      String(b || '')
        .split('|')
        .map((alt) => alt.trim())
        .filter(Boolean)
        .join('|'),
    )
    .filter(Boolean)
    .join(FILL_BLANK_SEP);
}

/**
 * Counts apparent blank placeholders in a question stem (`__`, `()`, `（）`, `【】`).
 */
export function countStemBlanks(stem: string): number {
  const matches = String(stem || '').match(/_{2,}|（\s*）|\(\s*\)|【\s*】/g);
  return matches ? matches.length : 0;
}

export function gradeFillBlanks(
  userInputs: string[],
  answerStr: string,
): { allOk: boolean; results: boolean[]; expectedBlanks: string[][] } {
  const expectedBlanks = parseFillBlanks(answerStr);
  if (expectedBlanks.length === 0) {
    return { allOk: false, results: [], expectedBlanks };
  }
  const results = expectedBlanks.map((alts, idx) => {
    const normInput = normalizeFillToken(userInputs[idx] || '');
    if (!normInput) return false;
    return alts.some((alt) => normalizeFillToken(alt) === normInput);
  });
  return {
    allOk: results.every(Boolean),
    results,
    expectedBlanks,
  };
}

export function formatFillAnswerDisplay(answerStr: string): string {
  const blanks = parseFillBlanks(answerStr);
  if (blanks.length === 0) return String(answerStr || '').trim();
  if (blanks.length === 1) return blanks[0].join(' / ');
  return blanks.map((alts, i) => `(${i + 1}) ${alts.join(' / ')}`).join('   ');
}
