/** Display helpers. No model logic here — grades always come from the scoring engine. */

export function gradeClass(grade: string | null | undefined): string {
  if (!grade) return "faint";
  const letter = grade[0].toUpperCase();
  return `g-${letter.toLowerCase()}`;
}

export function fmtScore(score: number | null | undefined, digits = 1): string {
  return score == null || Number.isNaN(score) ? "—" : score.toFixed(digits);
}

export function fmtMoney(v: number | null | undefined): string {
  if (v == null) return "—";
  return `$${Math.round(v).toLocaleString()}`;
}

export function fmtNum(v: number | null | undefined): string {
  if (v == null) return "—";
  return Number.isInteger(v) ? String(v) : String(v);
}

/** "$2,480 / month" style line for the card. */
export function monthly(v: number | null | undefined): string {
  return v == null ? "Cost not set" : `${fmtMoney(v)} / month`;
}

export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}
