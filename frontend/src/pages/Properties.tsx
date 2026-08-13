import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { api } from "../lib/api";
import { fmtScore, gradeClass, monthly, ordinal } from "../lib/format";
import type { PropertyResult } from "@shared/types";

type Listing = PropertyResult & { lead_photo: string | null };

const SORTS = [
  { key: "overall", label: "Overall" },
  { key: "price", label: "Price" },
  { key: "newest", label: "Newest" },
  { key: "favorite", label: "Favorite" },
];

export default function Properties() {
  const [results, setResults] = useState<Listing[] | null>(null);
  const [sort, setSort] = useState("overall");
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(
    () =>
      api
        .properties(sort)
        .then(setResults)
        .catch((e) => setError(String(e.message))),
    [sort]
  );

  useEffect(() => {
    reload();
  }, [reload]);

  if (error) return <div className="err">{error}</div>;
  if (!results) return <div className="empty">Loading…</div>;

  const ranked = results.filter((r) => r.rank != null).length;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Properties</h1>
          <div className="sub">
            {results.length === 0
              ? "Nothing added yet"
              : `${results.length} ${results.length === 1 ? "property" : "properties"}` +
                (ranked !== results.length ? ` · ${results.length - ranked} excluded by deal breakers` : "")}
          </div>
        </div>
        <div className="spacer" />
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span className="tiny faint">Sort</span>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            style={{ width: "auto" }}
          >
            {SORTS.map((s) => (
              <option key={s.key} value={s.key}>{s.label}</option>
            ))}
          </select>
          <Link to="/add" className="btn primary">+ Add Property</Link>
        </div>
      </div>

      {results.length === 0 ? (
        <div className="empty card card-pad">
          <h2>No properties yet</h2>
          <p className="muted">
            Add the first house or apartment you're considering and the model will start
            ranking them.
          </p>
          <Link to="/add" className="btn primary" style={{ marginTop: 10 }}>
            + Add Property
          </Link>
        </div>
      ) : (
        <div className="grid">
          {results.map((r) => (
            <PropertyCard
              key={r.property.id}
              result={r}
              total={ranked}
              onDeleted={reload}
            />
          ))}
        </div>
      )}
    </>
  );
}

function PropertyCard({
  result,
  total,
  onDeleted,
}: {
  result: Listing;
  total: number;
  onDeleted: () => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const p = result.property;
  const failed = result.failed_deal_breakers.length > 0;
  const shown = result.categories.filter((c) => c.enabled && c.score != null).slice(0, 5);

  return (
    <div
      className={`card prop-card${failed ? " failed" : ""}${
        result.rank === 1 ? " leader" : ""
      }`}
    >
      {result.lead_photo && (
        <Link to={`/property/${p.id}`} className="lead-photo">
          <img src={result.lead_photo} alt="" loading="lazy" />
        </Link>
      )}

      <div className="prop-head">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div className="prop-name">{p.name}</div>
          {p.status === "Favorite" && <span className="badge ok">★ Favorite</span>}
        </div>
        <div className="prop-addr">
          {[p.address, p.city, p.state].filter(Boolean).join(", ") || "No address"}
        </div>
      </div>

      <div className="hero">
        <div className={`hero-grade ${gradeClass(result.grade)}`}>
          {result.grade ?? "—"}
        </div>
        <div className="hero-meta">
          <div className="hero-score">{fmtScore(result.overall)}</div>
          <div className="hero-sub">{monthly(p.monthly_cost)}</div>
        </div>
        <div className="rankchip">
          {failed ? (
            <span className="badge fail">Deal breaker</span>
          ) : result.rank ? (
            <>
              <strong>{ordinal(result.rank)}</strong>
              of {total}
            </>
          ) : (
            <span className="faint tiny">Unscored</span>
          )}
        </div>
      </div>

      {shown.length > 0 && (
        <div className="catlist">
          {shown.map((c) => (
            <div className="catrow" key={c.category_id}>
              <span className="nm">{c.name}</span>
              <span className="sc">{fmtScore(c.score, 0)}</span>
              <span className={`gd ${gradeClass(c.grade)}`}>{c.grade}</span>
            </div>
          ))}
        </div>
      )}

      {failed && (
        <div style={{ padding: "0 18px 12px" }}>
          <span className="tiny" style={{ color: "#ff9a94" }}>
            {result.failed_deal_breakers.join(" · ")}
          </span>
        </div>
      )}

      <div className="cardfoot">
        <Link to={`/property/${p.id}`} className="btn sm">View</Link>
        <Link to={`/property/${p.id}/edit`} className="btn sm ghost">Edit</Link>
        <Link to="/compare" className="btn sm ghost">Compare</Link>
        <button
          className="btn sm danger"
          style={{ marginLeft: "auto" }}
          disabled={deleting}
          onClick={async () => {
            if (!confirm(`Delete "${p.name}"? Its ratings and photos go with it.`)) return;
            setDeleting(true);
            try {
              await api.deleteProperty(p.id);
              onDeleted();
            } finally {
              setDeleting(false);
            }
          }}
        >
          {deleting ? "Deleting…" : "Delete"}
        </button>
      </div>
    </div>
  );
}
