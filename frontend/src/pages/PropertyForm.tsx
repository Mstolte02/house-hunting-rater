import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { api } from "../lib/api";
import PhotosCard from "../components/PhotosCard";

const TYPES = ["House", "Apartment", "Condo", "Townhome", "Other"];
const STATUSES = [
  "Considering", "Favorite", "Scheduled", "Visited", "Rejected", "Leased/Purchased",
];

type Form = Record<string, string>;

// Renting only: HOA, property taxes and homeowner's insurance are owner costs and
// aren't collected. Their columns stay in the database so nothing is lost, they're
// just never written from here.
const EMPTY: Form = {
  name: "", address: "", city: "", state: "IN", zip: "", url: "",
  property_type: "House", status: "Considering",
  monthly_cost: "", utilities: "", deposit: "", move_in_costs: "",
  bedrooms: "", bathrooms: "", square_feet: "", lot_size: "", year_built: "",
  garage_spaces: "", parking: "", similarity_town: "",
  notes: "", pros: "", cons: "", visit_notes: "",
};

export default function PropertyForm() {
  const { id } = useParams();
  const editing = Boolean(id);
  const navigate = useNavigate();

  const [form, setForm] = useState<Form>(EMPTY);
  const [towns, setTowns] = useState<{ name: string; county: string | null }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  /** Photos chosen before the property exists; saved right after it's created. */
  const [pendingPhotos, setPendingPhotos] = useState<File[]>([]);
  const [pendingPhotoUrls, setPendingPhotoUrls] = useState<string[]>([]);

  useEffect(() => {
    api.towns().then(setTowns).catch(() => setTowns([]));
  }, []);

  useEffect(() => {
    if (!id) return;
    api.property(id).then((r) => {
      const p = r.property as unknown as Record<string, unknown>;
      const next = { ...EMPTY };
      for (const k of Object.keys(EMPTY)) next[k] = p[k] == null ? "" : String(p[k]);
      setForm(next);
    }).catch((e) => setError(String(e.message)));
  }, [id]);

  const set = (k: string) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return setError("Give the property a name.");
    if (!form.address.trim()) return setError("Enter the exact street address so commute scoring is accurate.");
    setSaving(true);
    setError(null);
    try {
      const saved = editing
        ? await api.updateProperty(id!, form)
        : await api.createProperty(form);

      // Best-effort: a failed photo save shouldn't lose the property you just created.
      if (pendingPhotos.length) {
        try {
          await api.uploadPhotos(saved.property.id, pendingPhotos);
        } catch {
          /* the detail page's Photos section can retry */
        }
      }
      if (pendingPhotoUrls.length) {
        try {
          await api.addPhotosFromUrl(saved.property.id, pendingPhotoUrls);
        } catch {
          /* same */
        }
      }

      navigate(`/property/${saved.property.id}`);
    } catch (err: any) {
      setError(String(err.message));
      setSaving(false);
    }
  }

  // If the city matches a dataset town, similarity resolves automatically.
  const cityMatches = towns.some(
    (t) => t.name.toLowerCase() === form.city.trim().toLowerCase()
  );

  return (
    <form onSubmit={submit}>
      <div className="page-head">
        <div>
          <h1>{editing ? "Edit Property" : "Add Property"}</h1>
          <div className="sub">
            Facts first — you'll rate it on the next screen.
          </div>
        </div>
        <div className="spacer" />
        <button type="button" className="btn ghost" onClick={() => navigate(-1)}>
          Cancel
        </button>
        <button type="submit" className="btn primary" disabled={saving}>
          {saving ? "Saving…" : editing ? "Save Changes" : "Add Property"}
        </button>
      </div>

      {error && <div className="err" style={{ marginBottom: 16 }}>{error}</div>}

      <div className="stack">
        <section className="card card-pad">
          <div className="section-title">Basics</div>
          <div className="row">
            <div className="field">
              <label>Name</label>
              <input value={form.name} onChange={set("name")} placeholder="123 Main Street" autoFocus />
            </div>
            <div className="field">
              <label>Type</label>
              <select value={form.property_type} onChange={set("property_type")}>
                {TYPES.map((t) => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Status</label>
              <select value={form.status} onChange={set("status")}>
                {STATUSES.map((s) => <option key={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <div className="field">
            <label>Listing URL</label>
            <input value={form.url} onChange={set("url")} placeholder="https://…" />
          </div>
        </section>

        <section className="card card-pad">
          <div className="section-title">Location</div>
          <div className="field">
            <label>Address</label>
            <input
              value={form.address}
              onChange={set("address")}
              placeholder="123 Main St"
              required
            />
            <div className="tiny muted" style={{ marginTop: 7 }}>
              Required for exact-address commute routing; city-center estimates are never used.
            </div>
          </div>
          <div className="row">
            <div className="field">
              <label>City</label>
              <input value={form.city} onChange={set("city")} list="town-list" />
              <datalist id="town-list">
                {towns.map((t) => <option key={t.name} value={t.name} />)}
              </datalist>
            </div>
            <div className="field">
              <label>State</label>
              <input value={form.state} onChange={set("state")} />
            </div>
            <div className="field">
              <label>ZIP</label>
              <input value={form.zip} onChange={set("zip")} />
            </div>
          </div>
          <div className="field">
            <label>
              Similarity town {cityMatches && !form.similarity_town ? "(auto-matched from city)" : ""}
            </label>
            <select value={form.similarity_town} onChange={set("similarity_town")}>
              <option value="">
                {cityMatches ? `Use city — ${form.city}` : "Use city (no match yet)"}
              </option>
              {towns.map((t) => (
                <option key={t.name} value={t.name}>
                  {t.name}{t.county ? ` — ${t.county} County` : ""}
                </option>
              ))}
            </select>
            <div className="tiny faint" style={{ marginTop: 5 }}>
              Which Indiana town this property is scored against for the Location grade.
              Pick one manually if it sits outside city limits.
            </div>
          </div>
        </section>

        <section className="card card-pad">
          <div className="section-title">Cost</div>
          <div className="row">
            <div className="field"><label>Monthly rent</label><input value={form.monthly_cost} onChange={set("monthly_cost")} inputMode="decimal" /></div>
            <div className="field"><label>Utilities</label><input value={form.utilities} onChange={set("utilities")} inputMode="decimal" /></div>
            <div className="field"><label>Deposit</label><input value={form.deposit} onChange={set("deposit")} inputMode="decimal" /></div>
            <div className="field"><label>Move-in costs</label><input value={form.move_in_costs} onChange={set("move_in_costs")} inputMode="decimal" /></div>
          </div>
        </section>

        <section className="card card-pad">
          <div className="section-title">The building</div>
          <div className="row">
            <div className="field"><label>Bedrooms</label><input value={form.bedrooms} onChange={set("bedrooms")} inputMode="decimal" /></div>
            <div className="field"><label>Bathrooms</label><input value={form.bathrooms} onChange={set("bathrooms")} inputMode="decimal" /></div>
            <div className="field"><label>Square feet</label><input value={form.square_feet} onChange={set("square_feet")} inputMode="decimal" /></div>
            <div className="field"><label>Lot size</label><input value={form.lot_size} onChange={set("lot_size")} inputMode="decimal" /></div>
            <div className="field"><label>Year built</label><input value={form.year_built} onChange={set("year_built")} inputMode="numeric" /></div>
            <div className="field"><label>Garage spaces</label><input value={form.garage_spaces} onChange={set("garage_spaces")} inputMode="decimal" /></div>
          </div>
          <div className="field"><label>Parking</label><input value={form.parking} onChange={set("parking")} /></div>
        </section>

        <section className="card card-pad">
          <div className="section-title">Photos</div>
          <PhotosCard
            propertyId={editing ? Number(id) : undefined}
            onPending={setPendingPhotos}
            onPendingUrls={setPendingPhotoUrls}
            compact
          />
        </section>

        <section className="card card-pad">
          <div className="section-title">Notes</div>
          <div className="field"><label>General notes</label><textarea value={form.notes} onChange={set("notes")} /></div>
          <div className="row">
            <div className="field"><label>Pros</label><textarea value={form.pros} onChange={set("pros")} placeholder="One per line" /></div>
            <div className="field"><label>Cons</label><textarea value={form.cons} onChange={set("cons")} placeholder="One per line" /></div>
          </div>
          <div className="field"><label>Visit notes</label><textarea value={form.visit_notes} onChange={set("visit_notes")} /></div>
        </section>
      </div>
    </form>
  );
}
