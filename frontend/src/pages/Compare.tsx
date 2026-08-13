import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { api } from "../lib/api";
import { fmtMoney, fmtScore, gradeClass, ordinal } from "../lib/format";
import type { PropertyResult } from "@shared/types";

const MAX = 4;

export default function Compare() {
  const [all, setAll] = useState<PropertyResult[] | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.properties().then((r) => {
      setAll(r);
      setSelected(r.slice(0, Math.min(3, r.length)).map((x) => x.property.id));
    }).catch((e) => setError(String(e.message)));
  }, []);

  const chosen = useMemo(
    () =>
      selected
        .map((id) => all?.find((r) => r.property.id === id))
        .filter(Boolean) as PropertyResult[],
    [selected, all]
  );

  /** Category rows come from the union of every chosen property's categories. */
  const rows = useMemo(() => {
    const names: string[] = [];
    for (const r of chosen) {
      for (const c of r.categories) {
        if (c.enabled && !names.includes(c.name)) names.push(c.name);
      }
    }
    return names;
  }, [chosen]);

  if (error) return <div className="err">{error}</div>;
  if (!all) return <div className="empty">Loading…</div>;

  if (all.length < 2) {
    return (
      <>
        <div className="page-head"><h1>Compare</h1></div>
        <div className="empty card card-pad">
          <h2>Need at least two properties</h2>
          <p className="muted">Add another and you can put them side by side.</p>
          <Link to="/add" className="btn primary" style={{ marginTop: 10 }}>+ Add Property</Link>
        </div>
      </>
    );
  }

  function toggle(id: number) {
    setSelected((s) =>
      s.includes(id) ? s.filter((x) => x !== id) : s.length >= MAX ? s : [...s, id]
    );
  }

  const bestIn = (name: string) => {
    const vals = chosen
      .map((r) => r.categories.find((c) => c.name === name)?.score)
      .filter((v): v is number => v != null);
    return vals.length > 1 ? Math.max(...vals) : null;
  };
  const bestOverall = (() => {
    const vals = chosen.map((r) => r.overall).filter((v): v is number => v != null);
    return vals.length > 1 ? Math.max(...vals) : null;
  })();
  const cheapest = (() => {
    const vals = chosen
      .map((r) => r.property.monthly_cost)
      .filter((v): v is number => v != null);
    return vals.length > 1 ? Math.min(...vals) : null;
  })();

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Compare</h1>
          <div className="sub">Pick up to {MAX}. Best in each row is highlighted.</div>
        </div>
      </div>

      <div className="pill-row" style={{ marginBottom: 20 }}>
        {all.map((r) => {
          const on = selected.includes(r.property.id);
          const full = !on && selected.length >= MAX;
          return (
            <button
              key={r.property.id}
              className={`btn sm ${on ? "primary" : "ghost"}`}
              disabled={full}
              onClick={() => toggle(r.property.id)}
            >
              {r.property.name}
            </button>
          );
        })}
      </div>

      {chosen.length < 2 ? (
        <div className="empty card card-pad muted">Select at least two properties.</div>
      ) : (
        <div className="card" style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th style={{ minWidth: 150 }}>Category</th>
                {chosen.map((r) => (
                  <th key={r.property.id} className="num">
                    <Link to={`/property/${r.property.id}`}>{r.property.name}</Link>
                    <div className="tiny faint" style={{ fontWeight: 400 }}>
                      {r.property.city ?? "—"}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="headline">
                <td><strong>Overall</strong></td>
                {chosen.map((r) => (
                  <td key={r.property.id} className={`num ${r.overall === bestOverall ? "best" : ""}`}>
                    <span className="mono">{fmtScore(r.overall)}</span>{" "}
                    <span className={gradeClass(r.grade)} style={{ fontWeight: 640 }}>{r.grade ?? ""}</span>
                  </td>
                ))}
              </tr>
              <tr>
                <td className="muted">Rank</td>
                {chosen.map((r) => (
                  <td key={r.property.id} className="num muted">
                    {r.rank ? ordinal(r.rank) : <span className="badge fail">Deal breaker</span>}
                  </td>
                ))}
              </tr>
              <tr>
                <td className="muted">Monthly cost</td>
                {chosen.map((r) => (
                  <td
                    key={r.property.id}
                    className={`num ${r.property.monthly_cost === cheapest ? "best" : ""}`}
                  >
                    {fmtMoney(r.property.monthly_cost)}
                  </td>
                ))}
              </tr>
              <tr>
                <td className="muted">Beds / baths / sq ft</td>
                {chosen.map((r) => (
                  <td key={r.property.id} className="num muted tiny">
                    {r.property.bedrooms ?? "—"} / {r.property.bathrooms ?? "—"} /{" "}
                    {r.property.square_feet?.toLocaleString() ?? "—"}
                  </td>
                ))}
              </tr>

              {rows.map((name) => {
                const best = bestIn(name);
                return (
                  <tr key={name}>
                    <td>{name}</td>
                    {chosen.map((r) => {
                      const c = r.categories.find((x) => x.name === name);
                      return (
                        <td
                          key={r.property.id}
                          className={`num ${c?.score != null && c.score === best ? "best" : ""}`}
                        >
                          <span className="mono">{fmtScore(c?.score ?? null, 0)}</span>{" "}
                          <span className={gradeClass(c?.grade ?? null)} style={{ fontWeight: 640 }}>
                            {c?.grade ?? ""}
                          </span>
                          {c?.disagreement_flag && (
                            <span className="badge warn" style={{ marginLeft: 6 }}>⚠</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
