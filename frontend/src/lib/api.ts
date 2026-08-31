import type { CategoryResult, Category, CityProfile, CityScore, CitySubScore, DealBreaker, Property, PropertyResult, PropertyScore, Subcriterion, SubcriterionScore, Tracking } from "@shared/types";
import {
  cityExternals, cityScopedCategories, evaluateCity, findCityProfileByName,
  normalizeCityName, resolveCityProfile, DEFAULT_CITY_SCOPED_CATEGORIES, type CityLink, type CityModel,
} from "@shared/city/profiles";
import type { GradeBand } from "@shared/scoring/grade";
import { DEFAULT_GRADE_SCALE } from "@shared/scoring/grade";
import { DEFAULT_DISAGREEMENT_THRESHOLD } from "@shared/scoring/category";
import { evaluateAll, evaluateProperty, type ModelConfig, type PropertyInput } from "@shared/scoring/engine";
import type { SortKey } from "@shared/scoring/ranking";
import { DEFAULT_COMMUTE_ANCHORS, haversineMiles, scoreLeg, type CommuteAnchor } from "@shared/commute/commute";
import { IndianaSimilarityAdapter, DEFAULT_REFERENCE_TOWN, type TownSimilarity } from "@shared/similarity/adapter";
import { DEFAULT_CURVE_ANCHORS, type CurveAnchor } from "@shared/similarity/curve";
import { DEFAULT_QUALITY_FEATURES } from "@shared/similarity/similarity";
import type { SimMeta, SimTown } from "@shared/similarity/types";
import seed from "../data/seed.json";
import townsJson from "../../../data/similarity/towns.json";
import metaJson from "../../../data/similarity/meta.json";
import { loadSharedState, requireEditor, saveSharedState } from "./shared";

export type CategoryWithSubs = Category & { subcriteria: Subcriterion[] };
export interface Destination { key: string; label: string; address: string; lat: number; lon: number }
export interface MetricInfo { key: string; label: string; description: string }
export interface CommuteResult {
  destination: string; label: string; minutes: number; miles: number; score: number;
  origin: "address" | "town"; origin_label: string; fetched_at: string;
}
export type PropertyDetail = PropertyResult & {
  similarity: TownSimilarity | null; commutes: CommuteResult[]; commutes_missing: string[];
  lead_photo: string | null; city: CityContext;
};
/** Where this property's schools/safety/nearby ratings come from, for the detail page. */
export interface CityContext {
  profile: { id: number; name: string } | null;
  source: CityLink["source"];
  /** Categories rated at the city level, so the UI can label them instead of guessing. */
  category_ids: number[];
}
export interface CityRow {
  profile: CityProfile;
  categories: CategoryResult[];
  property_count: number;
  /** Properties in this city that keep their own hand-entered city-scoped scores. */
  overriding: { id: number; name: string; categories: string[] }[];
}

type Photo = { name: string; url?: string; size?: number };
type State = {
  properties: Property[]; categories: Category[]; subcriteria: Subcriterion[];
  property_scores: (PropertyScore & { id?: number })[];
  subcriteria_scores: (SubcriterionScore & { id?: number })[];
  model_presets: any[]; model_preset_weights: any[]; deal_breakers: DealBreaker[];
  commute_cache: any[]; settings: { key: string; value: string }[];
  photos: Record<string, (string | Photo)[]>;
  city_profiles: CityProfile[]; city_scores: CityScore[]; city_sub_scores: CitySubScore[];
};

const STORAGE_KEY = "house-hunt-state-v1";
/** The application-tracking columns, written from the Tracker page. */
const TRACKING_FIELDS: (keyof Tracking)[] = [
  "tour_on", "applied_on", "application_fee", "decision", "available_on",
  "lease_signed_on", "follow_up_on", "contact", "tracking_notes",
];
const DEFAULT_DESTINATIONS: Destination[] = [
  { key: "mark", label: "Mark's work", address: "9225 Priority Way West Dr, Indianapolis, IN 46240", lat: 39.9224008, lon: -86.1066417 },
  { key: "rachel", label: "Rachel's work", address: "Knightstown High School, 8149 W US-40, Knightstown, IN 46148", lat: 39.7925966, lon: -85.5421078 },
];

function normalizeState(input: unknown): State {
  const s = structuredClone(input) as State;
  s.categories = s.categories.map((c: any) => ({
    ...c, enabled: !!c.enabled, single_score: !!c.single_score, metric: c.metric ?? null,
    // Only decided by name the first time a pre-Cities snapshot loads; after that the
    // stored flag rules, so unticking "rated by city" in Tuning sticks.
    city_scoped: c.city_scoped ?? DEFAULT_CITY_SCOPED_CATEGORIES.includes(c.name),
  }));
  s.subcriteria = s.subcriteria.map((x: any) => ({ ...x, enabled: !!x.enabled, metric: x.metric ?? null }));
  s.deal_breakers = s.deal_breakers.map((x: any) => ({ ...x, enabled: !!x.enabled }));
  s.properties = s.properties.map((p: any) => ({
    ...p, city_profile_id: p.city_profile_id ?? null, city_ratings_manual: !!p.city_ratings_manual,
    // Snapshots saved before the tracker existed have no application fields at all.
    // Filling them with null keeps every property the same shape, so the tracker never
    // has to tell "never entered" apart from "not there yet".
    ...Object.fromEntries(TRACKING_FIELDS.map((k) => [k, p[k] ?? null])),
  }));
  if (!Array.isArray(s.city_profiles)) liftCityRatings(s);
  s.city_scores ??= [];
  s.city_sub_scores ??= [];
  return s;
}

/** The value a town "really" has, given the same score typed into several properties. */
function typicalScore(values: (number | null)[]): number | null {
  const nums = values.filter((v): v is number => v != null && Number.isFinite(v));
  if (!nums.length) return null;
  const counts = new Map<number, number>();
  for (const n of nums) counts.set(n, (counts.get(n) ?? 0) + 1);
  const best = Math.max(...counts.values());
  // Ties go to the median of the tied values, so two-property towns stay sensible.
  const tied = [...counts.entries()].filter(([, c]) => c === best).map(([v]) => v).sort((a, b) => a - b);
  return tied[Math.floor((tied.length - 1) / 2)];
}

/**
 * One-time migration: move schools/safety/nearby ratings off the properties and onto
 * the towns they were really describing.
 *
 * Each city takes the rating its properties agreed on. A property whose own number
 * survives that (the one house rated 60 where the rest of Greenfield is 88) keeps it —
 * it becomes a visible per-property override rather than being averaged away.
 */
function liftCityRatings(s: State) {
  s.city_profiles = [];
  s.city_scores = [];
  s.city_sub_scores = [];
  const now = new Date().toISOString();
  const scoped = s.categories.filter((c) => c.city_scoped);
  const scopedSubs = s.subcriteria.filter((x) => scoped.some((c) => c.id === x.category_id));

  const byCity = new Map<string, Property[]>();
  for (const p of s.properties) {
    const key = normalizeCityName(p.city);
    if (!key) continue;
    byCity.set(key, [...(byCity.get(key) ?? []), p]);
  }

  for (const group of byCity.values()) {
    const profile: CityProfile = {
      id: Math.max(0, ...s.city_profiles.map((c) => c.id)) + 1,
      name: String(group[0].city), state: group[0].state ?? null, notes: null,
      created_at: now, updated_at: now,
    };
    s.city_profiles.push(profile);
    const ids = new Set(group.map((p) => p.id));

    for (const c of scoped) {
      const rows = s.property_scores.filter((r) => ids.has(r.property_id) && r.category_id === c.id);
      const lifted = {
        score: typicalScore(rows.map((r) => r.score)),
        mark_score: typicalScore(rows.map((r) => r.mark_score)),
        rachel_score: typicalScore(rows.map((r) => r.rachel_score)),
      };
      if (lifted.score == null && lifted.mark_score == null && lifted.rachel_score == null) continue;
      s.city_scores.push({ city_profile_id: profile.id, category_id: c.id, notes: null, ...lifted });
      for (const r of rows) {
        if (r.score === lifted.score && r.mark_score === lifted.mark_score && r.rachel_score === lifted.rachel_score) {
          Object.assign(r, { score: null, mark_score: null, rachel_score: null });
        }
      }
    }

    for (const sub of scopedSubs) {
      const rows = s.subcriteria_scores.filter((r) => ids.has(r.property_id) && r.subcriterion_id === sub.id);
      const lifted = {
        score: typicalScore(rows.map((r) => r.score)),
        mark_score: typicalScore(rows.map((r) => r.mark_score)),
        rachel_score: typicalScore(rows.map((r) => r.rachel_score)),
      };
      if (lifted.score == null && lifted.mark_score == null && lifted.rachel_score == null) continue;
      s.city_sub_scores.push({ city_profile_id: profile.id, subcriterion_id: sub.id, ...lifted });
      for (const r of rows) {
        if (r.score === lifted.score && r.mark_score === lifted.mark_score && r.rachel_score === lifted.rachel_score) {
          Object.assign(r, { score: null, mark_score: null, rachel_score: null });
        }
      }
    }
  }
}
function freshState(): State { return normalizeState(seed); }

let state: State = (() => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? normalizeState(JSON.parse(saved)) : freshState();
  } catch { return freshState(); }
})();

let revision = 0;
const remoteReady = loadSharedState<State>().then((snapshot) => {
  if (!snapshot) return;
  state = normalizeState(snapshot.data);
  revision = snapshot.revision;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
});

async function persist() {
  revision = await saveSharedState(state, revision);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
function setting<T>(key: string, fallback: T): T {
  const row = state.settings.find((r) => r.key === key);
  if (!row) return fallback;
  try { return JSON.parse(row.value) as T; } catch { return fallback; }
}
function setSetting(key: string, value: unknown) {
  const row = state.settings.find((r) => r.key === key);
  if (row) row.value = JSON.stringify(value); else state.settings.push({ key, value: JSON.stringify(value) });
}
function nextId(rows: { id?: number }[]) { return Math.max(0, ...rows.map((r) => Number(r.id) || 0)) + 1; }

function similaritySettings() {
  return {
    referenceTown: setting("reference_town", DEFAULT_REFERENCE_TOWN),
    oneSided: setting("one_sided", true),
    qualityFeatures: setting<string[]>("quality_features", [...DEFAULT_QUALITY_FEATURES]),
    anchors: setting<CurveAnchor[]>("curve_anchors", DEFAULT_CURVE_ANCHORS),
    aPlusRaw: setting<number | null>("a_plus_raw", null),
  };
}
function adapter(overrides: Record<string, unknown> = {}) {
  const s = { ...similaritySettings(), ...overrides };
  return new IndianaSimilarityAdapter(townsJson as SimTown[], metaJson as SimMeta, {
    ...s, gradeScale: setting<GradeBand[]>("grade_scale", DEFAULT_GRADE_SCALE),
  });
}
function commuteSettings() {
  return {
    destinations: setting<Destination[]>("commute_destinations", DEFAULT_DESTINATIONS),
    anchors: setting<CommuteAnchor[]>("commute_anchors", DEFAULT_COMMUTE_ANCHORS),
  };
}
function commutesFor(p: Property): CommuteResult[] {
  const { destinations, anchors } = commuteSettings();
  // Never present a town-centre route as this property's commute when a street
  // address is available. Older snapshots may contain those fallback rows.
  const rows = new Map(state.commute_cache
    .filter((r) => r.property_id === p.id && (!p.address || r.origin === "address"))
    .map((r) => [r.destination, r]));
  return destinations.flatMap((d) => {
    const r: any = rows.get(d.key); if (!r) return [];
    return [scoreLeg({ destination: d.key, label: d.label, minutes: r.minutes, miles: r.miles, origin: r.origin, origin_label: r.origin_label ?? "", fetched_at: r.fetched_at }, anchors)];
  });
}
function resolveMetrics(p: Property) {
  const out: Record<string, number | null> = {};
  out["similarity:westfield"] = adapter().scoreForCity(p.similarity_town ?? p.city, p.latitude, p.longitude)?.score ?? null;
  for (const c of commutesFor(p)) out[`commute:${c.destination}`] = c.score;
  return out;
}
function config(): ModelConfig {
  return {
    categories: state.categories, subcriteria: state.subcriteria, dealBreakers: state.deal_breakers,
    gradeScale: setting("grade_scale", DEFAULT_GRADE_SCALE), combine: setting("rater_combine", "average"),
    disagreementThreshold: setting("disagreement_threshold", DEFAULT_DISAGREEMENT_THRESHOLD),
  };
}
function cityModel(): CityModel {
  return {
    categories: state.categories, subcriteria: state.subcriteria,
    cityScores: state.city_scores, citySubScores: state.city_sub_scores,
    combine: setting("rater_combine", "average"),
    gradeScale: setting<GradeBand[]>("grade_scale", DEFAULT_GRADE_SCALE),
    disagreementThreshold: setting("disagreement_threshold", DEFAULT_DISAGREEMENT_THRESHOLD),
  };
}
function cityLinkFor(p: Property): CityLink { return resolveCityProfile(p, state.city_profiles); }
function cityContext(p: Property): CityContext {
  const link = cityLinkFor(p);
  return {
    profile: link.profile ? { id: link.profile.id, name: link.profile.name } : null,
    source: link.source,
    category_ids: cityScopedCategories(state.categories).map((c) => c.id),
  };
}
function inputFor(p: Property): PropertyInput {
  const metrics = resolveMetrics(p); const externalScores: Record<number, number | null> = {}; const externalSubScores: Record<number, number | null> = {};
  state.categories.filter((c) => c.metric).forEach((c) => externalScores[c.id] = metrics[c.metric as string] ?? null);
  state.subcriteria.filter((s) => s.metric).forEach((s) => externalSubScores[s.id] = metrics[s.metric as string] ?? null);
  // The city's ratings arrive as ordinary external scores, which the engine already
  // ranks below anything typed on the property — so overriding a town needs no new rule.
  const fromCity = cityExternals(cityLinkFor(p).profile, cityModel());
  Object.assign(externalScores, fromCity.categories);
  Object.assign(externalSubScores, fromCity.subcriteria);
  return { property: p, scores: state.property_scores.filter((s) => s.property_id === p.id), subScores: state.subcriteria_scores.filter((s) => s.property_id === p.id), externalScores, externalSubScores };
}
function parseSort(sort: string): SortKey { return sort.startsWith("category:") ? { category: sort.slice(9) } : sort as SortKey; }
function results(sort = "overall") { return evaluateAll(state.properties.map(inputFor), config(), parseSort(sort)); }
function photoRows(id: number | string) {
  return (state.photos[String(id)] ?? []).map((p): Photo => typeof p === "string" ? { name: p } : p);
}
function photoUrl(id: number | string, p: Photo) { return p.url ?? `${import.meta.env.BASE_URL}data/photos/${id}/${encodeURIComponent(p.name)}`; }
function detail(id: number | string): PropertyDetail {
  const p = state.properties.find((x) => x.id === Number(id)); if (!p) throw new Error("Property not found");
  const evaluated = evaluateProperty(inputFor(p), config());
  evaluated.rank = results().find((r) => r.property.id === p.id)?.rank ?? null;
  const cs = commutesFor(p); const cached = new Set(cs.map((c) => c.destination));
  return { ...evaluated, similarity: adapter().scoreForCity(p.similarity_town ?? p.city, p.latitude, p.longitude), commutes: cs, commutes_missing: commuteSettings().destinations.filter((d) => !cached.has(d.key)).map((d) => d.label), lead_photo: photoRows(p.id)[0] ? photoUrl(p.id, photoRows(p.id)[0]) : null, city: cityContext(p) };
}

const WRITABLE = ["name","address","city","state","zip","url","property_type","status","monthly_cost","hoa","property_taxes","insurance","utilities","deposit","move_in_costs","bedrooms","bathrooms","square_feet","lot_size","year_built","garage_spaces","parking","latitude","longitude","similarity_town","city_profile_id","city_ratings_manual","notes","pros","cons","visit_notes",...TRACKING_FIELDS];
const NUMERIC = new Set(["monthly_cost","hoa","property_taxes","insurance","utilities","deposit","move_in_costs","bedrooms","bathrooms","square_feet","lot_size","year_built","garage_spaces","latitude","longitude","city_profile_id","application_fee"]);
const BOOLEAN = new Set(["city_ratings_manual"]);
function picked(body: Record<string, unknown>) { const out: any = {}; for (const k of WRITABLE) if (k in body) { const v = body[k]; out[k] = BOOLEAN.has(k) ? (v === true || v === "true" || v === 1) : v === "" || v == null ? null : NUMERIC.has(k) ? (Number.isFinite(Number(v)) ? Number(v) : null) : v; } return out; }

/**
 * A city typed on a property becomes a town you can rate.
 *
 * Creating the empty profile here is what makes the Cities page self-populating: enter
 * "Fortville" on a listing and Fortville is waiting to be rated, rather than needing to
 * be added by hand in a second place.
 */
function ensureCityProfile(p: Property): CityProfile | null {
  if (!p.city?.trim()) return null;
  const existing = findCityProfileByName(state.city_profiles, p.city);
  if (existing) return existing;
  const now = new Date().toISOString();
  const profile: CityProfile = { id: nextId(state.city_profiles), name: p.city.trim(), state: p.state ?? null, notes: null, created_at: now, updated_at: now };
  state.city_profiles.push(profile);
  return profile;
}
function cityRows(): CityRow[] {
  const model = cityModel();
  return state.city_profiles
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((profile) => {
      const inCity = state.properties.filter((p) => cityLinkFor(p).profile?.id === profile.id);
      const scoped = cityScopedCategories(state.categories);
      const subsFor = (id: number) => state.subcriteria.filter((s) => s.category_id === id);
      return {
        profile,
        categories: evaluateCity(profile, model),
        property_count: inCity.length,
        overriding: inCity.flatMap((p) => {
          const names = scoped.filter((c) => {
            const own = state.property_scores.find((s) => s.property_id === p.id && s.category_id === c.id);
            const ownScored = own && (own.score != null || own.mark_score != null || own.rachel_score != null || own.override_score != null);
            const subScored = subsFor(c.id).some((sub) => {
              const row = state.subcriteria_scores.find((s) => s.property_id === p.id && s.subcriterion_id === sub.id);
              return row && (row.score != null || row.mark_score != null || row.rachel_score != null);
            });
            return ownScored || subScored;
          }).map((c) => c.name);
          return names.length ? [{ id: p.id, name: p.name, categories: names }] : [];
        }),
      };
    });
}
/** Drop a property's own city-scoped entries so it falls back to its town's ratings. */
function clearCityScopedScores(propertyId: number) {
  const scoped = cityScopedCategories(state.categories);
  const scopedIds = new Set(scoped.map((c) => c.id));
  const subIds = new Set(state.subcriteria.filter((s) => scopedIds.has(s.category_id)).map((s) => s.id));
  for (const row of state.property_scores) {
    if (row.property_id === propertyId && scopedIds.has(row.category_id)) {
      Object.assign(row, { score: null, mark_score: null, rachel_score: null, override_score: null, override_reason: null });
    }
  }
  state.subcriteria_scores = state.subcriteria_scores.filter((r) => !(r.property_id === propertyId && subIds.has(r.subcriterion_id)));
}
function exactAddress(p: Property) {
  const address = p.address?.trim() ?? "";
  const lower = address.toLowerCase();
  return [
    address,
    p.city && !lower.includes(p.city.toLowerCase()) ? p.city : null,
    p.state && !lower.includes(p.state.toLowerCase()) ? p.state : null,
    p.zip && !lower.includes(p.zip.toLowerCase()) ? p.zip : null,
  ].filter(Boolean).join(", ");
}

async function fileData(file: File): Promise<string> { return await new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = () => reject(r.error); r.readAsDataURL(file); }); }
function download(name: string, type: string, body: string) { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([body], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }
function csvCell(v: unknown) { if (v == null) return ""; const s = String(v); return /[\",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }

const rawApi = {
  properties: async (sort = "overall") => results(sort).map((r) => ({ ...r, lead_photo: photoRows(r.property.id)[0] ? photoUrl(r.property.id, photoRows(r.property.id)[0]) : null })),
  property: async (id: number | string) => detail(id),
  createProperty: async (body: Record<string, unknown>) => { const data: any = picked(body); if (!data.name) throw new Error("name is required"); const now = new Date().toISOString(); const p = { id: nextId(state.properties), property_type: "House", status: "Considering", state: "IN", ...Object.fromEntries(WRITABLE.map((k) => [k, null])), city_ratings_manual: false, ...data, created_at: now, updated_at: now } as Property; state.properties.push(p); ensureCityProfile(p); await persist(); await refreshCommute(p.id); return detail(p.id); },
  updateProperty: async (id: number | string, body: Record<string, unknown>) => { const p = state.properties.find((x) => x.id === Number(id)); if (!p) throw new Error("Property not found"); const data = picked(body); const moved = ["address","city","state","zip","latitude","longitude"].some((k) => k in data && (p as any)[k] !== data[k]); Object.assign(p, data, { updated_at: new Date().toISOString() }); ensureCityProfile(p); if (moved) { state.commute_cache = state.commute_cache.filter((r) => r.property_id !== p.id); await refreshCommute(p.id); } await persist(); return detail(p.id); },
  deleteProperty: async (id: number | string) => { const n = Number(id); state.properties = state.properties.filter((p) => p.id !== n); state.property_scores = state.property_scores.filter((s) => s.property_id !== n); state.subcriteria_scores = state.subcriteria_scores.filter((s) => s.property_id !== n); state.commute_cache = state.commute_cache.filter((r) => r.property_id !== n); delete state.photos[String(n)]; await persist(); },
  saveScores: async (id: number | string, scores: any[]) => { const n = Number(id); for (const row of scores) { let hit = state.property_scores.find((s) => s.property_id === n && s.category_id === row.category_id); if (!hit) { hit = { id: nextId(state.property_scores), property_id: n, category_id: row.category_id, score: null, mark_score: null, rachel_score: null, override_score: null, override_reason: null, notes: null }; state.property_scores.push(hit); } Object.assign(hit, row, { property_id: n }); } await persist(); return detail(n); },
  saveSubScores: async (id: number | string, scores: any[]) => { const n = Number(id); for (const row of scores) { let hit = state.subcriteria_scores.find((s) => s.property_id === n && s.subcriterion_id === row.subcriterion_id); if (!hit) { hit = { id: nextId(state.subcriteria_scores), property_id: n, subcriterion_id: row.subcriterion_id, score: null, mark_score: null, rachel_score: null }; state.subcriteria_scores.push(hit); } Object.assign(hit, row, { property_id: n }); } await persist(); return detail(n); },
  cities: async (): Promise<CityRow[]> => cityRows(),
  city: async (id: number | string) => { const row = cityRows().find((c) => c.profile.id === Number(id)); if (!row) throw new Error("City not found"); return row; },
  createCity: async (body: { name?: string; state?: string | null }) => {
    const name = String(body.name ?? "").trim();
    if (!name) throw new Error("Give the city a name.");
    if (findCityProfileByName(state.city_profiles, name)) throw new Error(`${name} is already on the list.`);
    const now = new Date().toISOString();
    const profile: CityProfile = { id: nextId(state.city_profiles), name, state: body.state ?? "IN", notes: null, created_at: now, updated_at: now };
    state.city_profiles.push(profile); await persist(); return profile;
  },
  updateCity: async (id: number, body: Partial<CityProfile>) => {
    const profile = state.city_profiles.find((c) => c.id === id); if (!profile) throw new Error("City not found");
    if (body.name != null) {
      const name = String(body.name).trim(); if (!name) throw new Error("Give the city a name.");
      const clash = findCityProfileByName(state.city_profiles, name);
      if (clash && clash.id !== id) throw new Error(`${name} is already on the list.`);
      profile.name = name;
    }
    if (body.state !== undefined) profile.state = body.state;
    if (body.notes !== undefined) profile.notes = body.notes;
    profile.updated_at = new Date().toISOString();
    await persist(); return profile;
  },
  deleteCity: async (id: number) => {
    state.city_profiles = state.city_profiles.filter((c) => c.id !== id);
    state.city_scores = state.city_scores.filter((s) => s.city_profile_id !== id);
    state.city_sub_scores = state.city_sub_scores.filter((s) => s.city_profile_id !== id);
    // Properties pointing here fall back to matching on their own city name.
    state.properties.forEach((p) => { if (p.city_profile_id === id) p.city_profile_id = null; });
    await persist();
  },
  saveCityScores: async (id: number | string, rows: { category_id: number; score?: number | null; mark_score?: number | null; rachel_score?: number | null; notes?: string | null }[]) => {
    const cityId = Number(id);
    for (const row of rows) {
      let hit = state.city_scores.find((s) => s.city_profile_id === cityId && s.category_id === row.category_id);
      if (!hit) { hit = { city_profile_id: cityId, category_id: row.category_id, score: null, mark_score: null, rachel_score: null, notes: null }; state.city_scores.push(hit); }
      Object.assign(hit, row, { city_profile_id: cityId });
    }
    const profile = state.city_profiles.find((c) => c.id === cityId); if (profile) profile.updated_at = new Date().toISOString();
    await persist(); return cityRows().find((c) => c.profile.id === cityId)!;
  },
  saveCitySubScores: async (id: number | string, rows: { subcriterion_id: number; score?: number | null; mark_score?: number | null; rachel_score?: number | null }[]) => {
    const cityId = Number(id);
    for (const row of rows) {
      let hit = state.city_sub_scores.find((s) => s.city_profile_id === cityId && s.subcriterion_id === row.subcriterion_id);
      if (!hit) { hit = { city_profile_id: cityId, subcriterion_id: row.subcriterion_id, score: null, mark_score: null, rachel_score: null }; state.city_sub_scores.push(hit); }
      Object.assign(hit, row, { city_profile_id: cityId });
    }
    const profile = state.city_profiles.find((c) => c.id === cityId); if (profile) profile.updated_at = new Date().toISOString();
    await persist(); return cityRows().find((c) => c.profile.id === cityId)!;
  },
  /** Throw away a property's hand-entered town ratings and go back to the city's. */
  useCityRatings: async (propertyId: number | string) => {
    const p = state.properties.find((x) => x.id === Number(propertyId)); if (!p) throw new Error("Property not found");
    p.city_ratings_manual = false;
    clearCityScopedScores(p.id);
    await persist(); return detail(p.id);
  },
  categories: async () => state.categories.slice().sort((a,b) => a.sort_order-b.sort_order).map((c) => ({ ...c, subcriteria: state.subcriteria.filter((s) => s.category_id === c.id) })),
  createCategory: async (body: any) => { if (!body.name) throw new Error("name is required"); if (state.categories.some((c) => c.name === body.name)) throw new Error(`A category named "${body.name}" already exists.`); const metric = body.metric || null; const c: Category = { id: nextId(state.categories), name: body.name, description: body.description ?? null, weight: Number(body.weight) || 0, enabled: body.enabled !== false, scoring_method: metric ? "external" : "manual", metric, single_score: false, city_scoped: !!body.city_scoped, sort_order: Math.max(-1, ...state.categories.map((x) => x.sort_order)) + 1 }; state.categories.push(c); await persist(); return { ...c, subcriteria: [] }; },
  updateCategory: async (id: number, body: any) => { const c = state.categories.find((x) => x.id === id); if (!c) throw new Error("Category not found"); Object.assign(c, body); if ("metric" in body) c.scoring_method = body.metric ? "external" : "manual"; await persist(); return { ...c, subcriteria: state.subcriteria.filter((s) => s.category_id === id) }; },
  deleteCategory: async (id: number) => { state.categories = state.categories.filter((c) => c.id !== id); const subIds = new Set(state.subcriteria.filter((s) => s.category_id === id).map((s) => s.id)); state.subcriteria = state.subcriteria.filter((s) => s.category_id !== id); state.property_scores = state.property_scores.filter((s) => s.category_id !== id); state.subcriteria_scores = state.subcriteria_scores.filter((s) => !subIds.has(s.subcriterion_id)); await persist(); },
  saveWeights: async (weights: {category_id:number;weight:number}[]) => { weights.forEach((w) => { const c = state.categories.find((x) => x.id === w.category_id); if (c) c.weight = Number(w.weight) || 0; }); await persist(); return { ok: true as const }; },
  settings: async () => ({ gradeScale: setting<GradeBand[]>("grade_scale", DEFAULT_GRADE_SCALE), raterCombine: setting<"average"|"min"|"max">("rater_combine", "average"), disagreementThreshold: setting("disagreement_threshold", DEFAULT_DISAGREEMENT_THRESHOLD), defaultGradeScale: DEFAULT_GRADE_SCALE }),
  saveSettings: async (body: any) => { if (body.gradeScale) setSetting("grade_scale", body.gradeScale); if (body.raterCombine) setSetting("rater_combine", body.raterCombine); if (body.disagreementThreshold != null) setSetting("disagreement_threshold", Number(body.disagreementThreshold) || 0); await persist(); return { ok: true as const }; },
  dealBreakers: async () => state.deal_breakers,
  createDealBreaker: async (body: any) => { const id = nextId(state.deal_breakers); state.deal_breakers.push({ id, label: body.label, field: body.field, comparator: body.comparator === "min" ? "min" : "max", value: Number(body.value) || 0, enabled: !!body.enabled }); await persist(); return { id }; },
  updateDealBreaker: async (id: number, body: any) => { const d = state.deal_breakers.find((x) => x.id === id); if (d) Object.assign(d, body); await persist(); return { ok: true as const }; },
  deleteDealBreaker: async (id: number) => { state.deal_breakers = state.deal_breakers.filter((d) => d.id !== id); await persist(); },
  towns: async () => adapter().towns.map((t) => ({ name: t.name, county: t.county })).sort((a,b) => a.name.localeCompare(b.name)),
  distribution: async () => { const a = adapter(); return { summary: a.summary(), histogram: a.gradeDistribution(), towns: a.allScored(), settings: similaritySettings(), families: a.meta.families }; },
  previewSimilarity: async (body: any) => { const a = adapter(body); return { summary: { a_plus_raw: a.summary().a_plus_raw, one_sided: a.summary().one_sided, reference: a.summary().reference }, histogram: a.gradeDistribution(), towns: a.allScored().slice(0,30) }; },
  saveSimilaritySettings: async (body: any) => { if (body.anchors) setSetting("curve_anchors", body.anchors); if (body.aPlusRaw !== undefined) setSetting("a_plus_raw", body.aPlusRaw); if (body.oneSided !== undefined) setSetting("one_sided", !!body.oneSided); if (body.referenceTown) setSetting("reference_town", body.referenceTown); if (body.qualityFeatures) setSetting("quality_features", body.qualityFeatures); adapter(); await persist(); return { ok: true as const }; },
  compare: async (ids: number[]) => ids.map((id) => results().find((r) => r.property.id === id)).filter(Boolean) as PropertyResult[],
  addSubcriterion: async (categoryId: number, body: any) => { state.subcriteria.push({ id: nextId(state.subcriteria), category_id: categoryId, name: body.name, weight: Number(body.weight) || 1, enabled: body.enabled !== false, metric: body.metric || null }); await persist(); const c = state.categories.find((x) => x.id === categoryId)!; return { ...c, subcriteria: state.subcriteria.filter((s) => s.category_id === categoryId) }; },
  updateSubcriterion: async (id: number, body: any) => { const s = state.subcriteria.find((x) => x.id === id); if (s) Object.assign(s, body); await persist(); return { ok: true as const }; },
  deleteSubcriterion: async (id: number) => { state.subcriteria = state.subcriteria.filter((s) => s.id !== id); state.subcriteria_scores = state.subcriteria_scores.filter((s) => s.subcriterion_id !== id); await persist(); },
  presets: async () => state.model_presets.map((p) => ({ ...p, weights: state.model_preset_weights.filter((w) => w.preset_id === p.id).map((w) => ({ category_id: w.category_id, weight: w.weight })) })),
  createPreset: async (body: any) => { if (state.model_presets.some((p) => p.name === body.name)) throw new Error(`A preset named "${body.name}" already exists.`); const id = nextId(state.model_presets); state.model_presets.push({ id, name: body.name, description: body.description ?? null, created_at: new Date().toISOString() }); for (const w of body.weights ?? []) state.model_preset_weights.push({ preset_id: id, category_id: Number(w.category_id), weight: Number(w.weight) || 0 }); await persist(); return { id }; },
  updatePreset: async (id: number, body: any) => { const p = state.model_presets.find((x) => x.id === id); if (p) Object.assign(p, { ...(body.name != null ? { name: body.name } : {}), ...(body.description != null ? { description: body.description } : {}) }); if (Array.isArray(body.weights)) { state.model_preset_weights = state.model_preset_weights.filter((w) => w.preset_id !== id); body.weights.forEach((w: any) => state.model_preset_weights.push({ preset_id: id, category_id: Number(w.category_id), weight: Number(w.weight) || 0 })); } await persist(); return { ok: true as const }; },
  deletePreset: async (id: number) => { state.model_presets = state.model_presets.filter((p) => p.id !== id); state.model_preset_weights = state.model_preset_weights.filter((w) => w.preset_id !== id); await persist(); },
  photos: async (id: number | string) => photoRows(id).map((p) => ({ name: p.name, url: photoUrl(id,p), size: p.size ?? 0 })),
  uploadPhotos: async (id: number | string, files: FileList | File[]) => { const key = String(id); state.photos[key] ??= []; for (const f of Array.from(files)) state.photos[key].push({ name: `${Date.now()}-${f.name}`, url: await fileData(f), size: f.size }); await persist(); return { uploaded: Array.from(files).length }; },
  deletePhoto: async (id: number | string, name: string) => { const key = String(id); state.photos[key] = (state.photos[key] ?? []).filter((p) => (typeof p === "string" ? p : p.name) !== name); await persist(); },
  addPhotosFromUrl: async (id: number | string, urls: string[]) => { const key = String(id); state.photos[key] ??= []; urls.forEach((url, i) => state.photos[key].push({ name: `${Date.now()+i}-linked-image`, url })); await persist(); return { saved: urls.length, failed: [] as {url:string;reason:string}[] }; },
  metrics: async () => [{ key: "similarity:westfield", label: `${similaritySettings().referenceTown} Similarity`, description: "Town similarity score." }, ...commuteSettings().destinations.map((d) => ({ key: `commute:${d.key}`, label: `Drive to ${d.label}`, description: `Minutes of actual driving to ${d.address}.` }))],
  commute: async () => commuteSettings(),
  refreshCommute: async (id: number | string) => refreshCommute(Number(id), true),
  saveCommute: async (body: any) => { if (body.destinations) setSetting("commute_destinations", body.destinations); if (body.anchors) setSetting("commute_anchors", body.anchors); await persist(); return { ok: true as const }; },
  exportProperties: () => { const r = results(); const names = [...new Set(r.flatMap((x) => x.categories.map((c) => c.name)))]; const header = ["Name","Address","City","State","ZIP","Type","Status","City Ratings","Monthly Cost","HOA","Taxes","Insurance","Utilities","Bedrooms","Bathrooms","Square Feet","Year Built","Garage","Overall","Grade","Rank","Deal Breakers",...names.flatMap((n) => [n,`${n} Grade`]),"Notes","Pros","Cons","Visit Notes","URL"]; const rows = r.map((x) => { const p=x.property, by=new Map(x.categories.map((c)=>[c.name,c])); const link=cityLinkFor(p); return [p.name,p.address,p.city,p.state,p.zip,p.property_type,p.status,link.profile?link.profile.name:link.source==="manual"?"Rated by hand":"—",p.monthly_cost,p.hoa,p.property_taxes,p.insurance,p.utilities,p.bedrooms,p.bathrooms,p.square_feet,p.year_built,p.garage_spaces,x.overall,x.grade,x.rank,x.failed_deal_breakers.join("; "),...names.flatMap((n)=>[by.get(n)?.score??null,by.get(n)?.grade??null]),p.notes,p.pros,p.cons,p.visit_notes,p.url]; }); download(`house-hunt-properties-${new Date().toISOString().slice(0,10)}.csv`,"text/csv;charset=utf-8","\ufeff"+[header,...rows].map((row)=>row.map(csvCell).join(",")).join("\r\n")); },
  exportModel: () => download(`house-hunt-model-${new Date().toISOString().slice(0,10)}.json`,"application/json",JSON.stringify({ exported:new Date().toISOString(),categories:state.categories,subcriteria:state.subcriteria,deal_breakers:state.deal_breakers,presets:state.model_presets,preset_weights:state.model_preset_weights,grade_scale:setting("grade_scale",DEFAULT_GRADE_SCALE),rater_combine:setting("rater_combine","average"),disagreement_threshold:setting("disagreement_threshold",15),similarity:similaritySettings() },null,2)),
};

const MUTATIONS = new Set([
  "createProperty", "updateProperty", "deleteProperty", "saveScores", "saveSubScores",
  "createCategory", "updateCategory", "deleteCategory", "saveWeights", "saveSettings",
  "createDealBreaker", "updateDealBreaker", "deleteDealBreaker", "saveSimilaritySettings",
  "addSubcriterion", "updateSubcriterion", "deleteSubcriterion", "createPreset", "updatePreset",
  "deletePreset", "uploadPhotos", "deletePhoto", "addPhotosFromUrl", "refreshCommute", "saveCommute",
  "createCity", "updateCity", "deleteCity", "saveCityScores", "saveCitySubScores", "useCityRatings",
]);

export const api = new Proxy(rawApi, {
  get(target, property: keyof typeof rawApi) {
    const value = target[property];
    if (typeof value !== "function") return value;
    return async (...args: unknown[]) => {
      await remoteReady;
      if (MUTATIONS.has(String(property))) requireEditor();
      return await (value as (...inner: unknown[]) => unknown)(...args);
    };
  },
}) as typeof rawApi;

async function geocode(query: string) {
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1&countrycodes=us`,
      { headers: { Accept: "application/json" } }
    );
    const d = await r.json();
    if (d?.[0]) return { lat: Number(d[0].lat), lon: Number(d[0].lon) };
  } catch { /* try the second provider */ }

  // Apartment communities and newer streets are sometimes missing from OpenStreetMap.
  // ArcGIS's public locator supplies point-address matches for those listings.
  try {
    const r = await fetch(
      `https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates?SingleLine=${encodeURIComponent(query)}&f=json&outFields=Match_addr,Addr_type&maxLocations=1`
    );
    const d = await r.json();
    const hit = d?.candidates?.[0];
    const exactTypes = new Set(["PointAddress", "StreetAddress", "Subaddress"]);
    if (hit?.score >= 90 && exactTypes.has(hit.attributes?.Addr_type)) {
      return { lat: Number(hit.location.y), lon: Number(hit.location.x) };
    }
  } catch { /* leave commute unscored */ }
  return null;
}
async function route(from:{lat:number;lon:number},to:{lat:number;lon:number}) { try { const r=await fetch(`https://router.project-osrm.org/route/v1/driving/${from.lon},${from.lat};${to.lon},${to.lat}?overview=false`); const d=await r.json(); const x=d?.routes?.[0]; if(!x) return null; const miles=x.distance/1609.344, minutes=x.duration/60, crow=haversineMiles(from.lat,from.lon,to.lat,to.lon); return crow>0.5&&(miles<crow*.8||minutes<=0)?null:{miles,minutes}; } catch{return null;} }
async function refreshCommute(id:number, force=false) { const p=state.properties.find((x)=>x.id===id); if(!p) throw new Error("Property not found"); let lat=p.latitude,lon=p.longitude,origin:"address"|"town"|null=lat!=null&&lon!=null?"address":null,origin_label:string|null=origin?exactAddress(p):null; if((lat==null||lon==null)&&p.address){const q=exactAddress(p); const g=await geocode(q); if(g){lat=g.lat;lon=g.lon;p.latitude=lat;p.longitude=lon;origin="address";origin_label=q;}} const failed:string[]=[];let routed=0; for(const d of commuteSettings().destinations){const hasExact=state.commute_cache.some((r)=>r.property_id===id&&r.destination===d.key&&(!p.address||r.origin==="address"));if(!force&&hasExact)continue;if(lat==null||lon==null){failed.push(d.label);continue;}const x=await route({lat,lon},{lat:d.lat,lon:d.lon});if(!x){failed.push(d.label);continue;}state.commute_cache=state.commute_cache.filter((r)=>!(r.property_id===id&&r.destination===d.key));state.commute_cache.push({property_id:id,destination:d.key,...x,origin:"address",origin_label,fetched_at:new Date().toISOString()});routed++;} await persist();return{routed,failed,origin,origin_label,result:detail(id)}; }
