/**
 * Turning a raw similarity number into a housing-app score.
 *
 * Why a curve at all: raw similarity-to-Westfield across the 207 other Indiana towns
 * runs max 88 / median 39 / min 13 (one-sided). Reading those straight off a
 * conventional grading table fails 93% of the state — Zionsville, Greenwood and
 * Lafayette all land at F — because 85-ish is the *ceiling* of the metric, not the A+
 * floor. So we rank the town against the observed distribution and map percentile to a
 * 0-100 app score, which is what spec sec.8 describes.
 *
 * The A+ anchor: everything at or above `aPlusRaw` (default: the most Westfield-like
 * town in the state) grades A+, scaling up to 100 for the reference town itself.
 *
 * Every anchor here is data, not code — the Tuning page edits them and the rankings
 * recalculate live.
 */

export interface CurveAnchor {
  /** 0-100 percentile within the peer distribution. */
  percentile: number;
  /** App score that percentile maps to. */
  score: number;
}

/**
 * Default anchors. Chosen so the median Indiana town lands at a C and the full A-F
 * range is actually used, rather than everything piling up at one end.
 */
export const DEFAULT_CURVE_ANCHORS: CurveAnchor[] = [
  { percentile: 0, score: 55 },
  { percentile: 10, score: 63 },
  { percentile: 25, score: 70 },
  { percentile: 50, score: 77 },
  { percentile: 75, score: 85 },
  { percentile: 90, score: 91 },
  { percentile: 100, score: 97 },
];

export interface CurveConfig {
  anchors?: CurveAnchor[];
  /**
   * Raw similarity at which A+ begins. Null means "use the highest-scoring peer town",
   * i.e. the most Westfield-like place in Indiana defines the top of the scale.
   */
  aPlusRaw?: number | null;
}

export class SimilarityCurve {
  /** Peer raw scores, ascending, excluding the reference town itself. */
  readonly peers: number[];
  readonly anchors: CurveAnchor[];
  readonly aPlusRaw: number;

  constructor(peerScores: number[], config: CurveConfig = {}) {
    this.peers = [...peerScores].sort((a, b) => a - b);
    this.anchors = [...(config.anchors ?? DEFAULT_CURVE_ANCHORS)].sort(
      (a, b) => a.percentile - b.percentile
    );
    const top = this.peers.length ? this.peers[this.peers.length - 1] : 100;
    this.aPlusRaw = config.aPlusRaw ?? top;
  }

  /** Share of peer towns strictly below `raw`, as 0-100. */
  percentileOf(raw: number): number {
    const n = this.peers.length;
    if (n === 0) return 100;
    let lo = 0;
    let hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.peers[mid] < raw) lo = mid + 1;
      else hi = mid;
    }
    return (100 * lo) / n;
  }

  /** Raw similarity -> 0-100 app score. Monotonic in raw. */
  toScore(raw: number): number {
    if (raw >= this.aPlusRaw) {
      // A+ band: 97 at the anchor, 100 for a perfect match with the reference town.
      const headroom = Math.max(1e-9, 100 - this.aPlusRaw);
      return 97 + 3 * Math.min(1, (raw - this.aPlusRaw) / headroom);
    }
    const p = this.percentileOf(raw);
    const a = this.anchors;
    if (a.length === 0) return raw;
    if (p <= a[0].percentile) return a[0].score;
    for (let i = 0; i < a.length - 1; i++) {
      const lo = a[i];
      const hi = a[i + 1];
      if (p <= hi.percentile) {
        const span = hi.percentile - lo.percentile;
        const t = span <= 0 ? 0 : (p - lo.percentile) / span;
        return lo.score + (hi.score - lo.score) * t;
      }
    }
    return a[a.length - 1].score;
  }
}
