import { gradeClass, fmtScore } from "../lib/format";

export function Grade({ grade, size }: { grade: string | null; size?: number }) {
  return (
    <span className={gradeClass(grade)} style={size ? { fontSize: size } : undefined}>
      {grade ?? "—"}
    </span>
  );
}

/** "91.4 A-" pairing used in tables and compare rows. */
export function ScoreGrade({
  score,
  grade,
}: {
  score: number | null;
  grade: string | null;
}) {
  return (
    <>
      <span className="mono">{fmtScore(score)}</span>{" "}
      <span className={gradeClass(grade)} style={{ fontWeight: 640 }}>
        {grade ?? ""}
      </span>
    </>
  );
}
