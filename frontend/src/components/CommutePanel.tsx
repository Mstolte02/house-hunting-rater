import { useEffect, useMemo, useState } from "react";

import { api, type Destination } from "../lib/api";

/**
 * Where we drive, and how distance turns into a score.
 *
 * Distance is straight-line × a road factor rather than a routed drive time — that
 * keeps the app offline. The factor and the miles→score curve are both editable here
 * because that approximation is exactly the kind of thing you'll want to argue with.
 */
export default function CommutePanel() {
  const [dests, setDests] = useState<Destination[]>([]);
  const [anchors, setAnchors] = useState<{ minutes: number; score: number }[]>([]);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  async function refresh() {
    const c = await api.commute();
    setDests(c.destinations);
    setAnchors(c.anchors);
    setSaved(JSON.stringify(c));
  }

  useEffect(() => {
    refresh().catch((e) => setError(String(e.message)));
  }, []);

  const dirty = useMemo(
    () => saved !== null && saved !== JSON.stringify({ destinations: dests, anchors }),
    [saved, dests, anchors]
  );

  async function save() {
    setError(null);
    try {
      await api.saveCommute({ destinations: dests, anchors });
      await refresh();
    } catch (e: any) {
      setError(String(e.message));
    }
  }

  function patch(i: number, p: Partial<Destination>) {
    setDests((d) => d.map((x, j) => (j === i ? { ...x, ...p } : x)));
  }

  return (
    <section className="card card-pad accent-teal">
      <div style={{ display: "flex", alignItems: "center" }}>
        <div className="section-title" style={{ marginBottom: 0 }}>
          Commute
        </div>
        <button className="btn sm primary" style={{ marginLeft: "auto" }} onClick={save} disabled={!dirty}>
          {dirty ? "Save" : "Saved"}
        </button>
      </div>

      {error && <div className="err" style={{ marginTop: 12 }}>{error}</div>}

      <div className="note" style={{ margin: "12px 0" }}>
        Drive times are real routes over the road network, looked up once when a property
        is added and cached after that. Changing a destination's address or coordinates
        makes every cached time stale — hit Recalculate on a property to refetch it.
      </div>

      {dests.map((d, i) => (
        <div
          key={d.key}
          style={{
            padding: "12px 0",
            borderBottom: "1px solid var(--line-soft)",
          }}
        >
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
            <input
              value={d.label}
              onChange={(e) => patch(i, { label: e.target.value })}
              style={{ fontWeight: 500 }}
            />
            <span className="badge purple mono">{`commute:${d.key}`}</span>
            <button
              className="btn sm danger"
              onClick={() => setDests((x) => x.filter((_, j) => j !== i))}
              title="Remove destination"
            >
              ✕
            </button>
          </div>
          <input
            value={d.address}
            placeholder="Address"
            onChange={(e) => patch(i, { address: e.target.value })}
            style={{ marginBottom: 8 }}
          />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <input
              value={d.lat}
              inputMode="decimal"
              onChange={(e) => patch(i, { lat: Number(e.target.value) })}
              title="Latitude"
            />
            <input
              value={d.lon}
              inputMode="decimal"
              onChange={(e) => patch(i, { lon: Number(e.target.value) })}
              title="Longitude"
            />
          </div>
        </div>
      ))}

      {adding ? (
        <AddDestination
          onCancel={() => setAdding(false)}
          onAdd={(d) => {
            setDests((x) => [...x, d]);
            setAdding(false);
          }}
        />
      ) : (
        <button className="btn sm" style={{ marginTop: 12 }} onClick={() => setAdding(true)}>
          + Add destination
        </button>
      )}

      <div className="section-title" style={{ marginTop: 18 }}>
        Minutes → score
      </div>
      {anchors.map((a, i) => (
        <div
          key={a.minutes}
          style={{ display: "grid", gridTemplateColumns: "58px 1fr 40px", gap: 10, alignItems: "center", marginBottom: 6 }}
        >
          <span className="tiny muted mono">{a.minutes} min</span>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={a.score}
            onChange={(e) => {
              const v = Number(e.target.value);
              setAnchors((prev) => prev.map((p, j) => (j === i ? { ...p, score: v } : p)));
            }}
          />
          <span className="mono tiny" style={{ textAlign: "right" }}>{a.score}</span>
        </div>
      ))}
    </section>
  );
}

function AddDestination({
  onAdd,
  onCancel,
}: {
  onAdd: (d: Destination) => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState("");
  const [address, setAddress] = useState("");
  const [lat, setLat] = useState("");
  const [lon, setLon] = useState("");

  const valid =
    label.trim() && Number.isFinite(Number(lat)) && Number.isFinite(Number(lon)) &&
    lat.trim() !== "" && lon.trim() !== "";

  return (
    <div style={{ marginTop: 12, background: "var(--elevated)", padding: 14, borderRadius: 9 }}>
      <div className="field">
        <label>Label</label>
        <input value={label} autoFocus placeholder="Rachel's parents" onChange={(e) => setLabel(e.target.value)} />
      </div>
      <div className="field">
        <label>Address</label>
        <input value={address} onChange={(e) => setAddress(e.target.value)} />
      </div>
      <div className="row" style={{ marginBottom: 12 }}>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Latitude</label>
          <input value={lat} inputMode="decimal" placeholder="39.9224" onChange={(e) => setLat(e.target.value)} />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Longitude</label>
          <input value={lon} inputMode="decimal" placeholder="-86.1066" onChange={(e) => setLon(e.target.value)} />
        </div>
      </div>
      <div className="tiny muted" style={{ marginBottom: 10 }}>
        Coordinates have to be entered by hand — the app deliberately does no geocoding
        so it never phones out. Right-click a spot in Google Maps to copy them.
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button
          className="btn sm primary"
          disabled={!valid}
          onClick={() =>
            onAdd({
              key: label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
              label: label.trim(),
              address,
              lat: Number(lat),
              lon: Number(lon),
            })
          }
        >
          Add
        </button>
        <button className="btn sm ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
