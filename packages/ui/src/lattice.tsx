/**
 * Lattice — the federation motif.
 *
 * A field of nodes joined to their nearest neighbours, with a few pulses
 * travelling along edges ("learning travels"). Positions are generated from a
 * seed so server and client render identical markup (no hydration drift),
 * and the same seed always gives the same lattice.
 */
import type { CSSProperties } from "react";

export interface LatticeProps {
  seed?: number;
  /** Number of nodes to place. */
  count?: number;
  width?: number;
  height?: number;
  /** Nearest neighbours each node connects to. */
  degree?: number;
  /** How many travelling pulses to animate. */
  pulses?: number;
  /** Unique prefix for the internal SVG ids when several lattices share a page. */
  idPrefix?: string;
  className?: string;
  style?: CSSProperties;
}

interface Point {
  x: number;
  y: number;
  r: number;
  dim: boolean;
}

/** mulberry32: tiny deterministic PRNG (kept local so @eadwyn/ui has no runtime deps). */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildLattice(
  options: Required<Pick<LatticeProps, "seed" | "count" | "width" | "height" | "degree">>,
) {
  const { seed, count, width, height, degree } = options;
  const random = mulberry32(seed);
  const points: Point[] = [];
  const minDistance = Math.sqrt((width * height) / count) * 0.62;

  let attempts = 0;
  while (points.length < count && attempts < count * 40) {
    attempts += 1;
    const candidate = { x: random() * width, y: random() * height };
    const tooClose = points.some(
      (p) => Math.hypot(p.x - candidate.x, p.y - candidate.y) < minDistance,
    );
    if (tooClose) continue;
    points.push({
      ...candidate,
      r: 1.2 + random() * 1.9,
      dim: random() < 0.45,
    });
  }

  const edgeKeys = new Set<string>();
  const edges: [number, number][] = [];
  points.forEach((point, i) => {
    const neighbours = points
      .map((other, j) => ({ j, d: Math.hypot(other.x - point.x, other.y - point.y) }))
      .filter(({ j }) => j !== i)
      .sort((a, b) => a.d - b.d)
      .slice(0, degree);
    for (const { j } of neighbours) {
      const key = i < j ? `${i}-${j}` : `${j}-${i}`;
      if (edgeKeys.has(key)) continue;
      edgeKeys.add(key);
      edges.push(i < j ? [i, j] : [j, i]);
    }
  });

  return { points, edges, random };
}

export function Lattice({
  seed = 7,
  count = 46,
  width = 1200,
  height = 720,
  degree = 2,
  pulses = 6,
  idPrefix = "lattice",
  className,
  style,
}: LatticeProps) {
  const { points, edges, random } = buildLattice({ seed, count, width, height, degree });
  const pulseEdges = edges
    .map((edge, index) => ({ edge, index, sort: random() }))
    .sort((a, b) => a.sort - b.sort)
    .slice(0, Math.min(pulses, edges.length));

  return (
    <svg
      className={["ew-lattice", className].filter(Boolean).join(" ")}
      style={style}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      focusable="false"
    >
      <title>Lattice of federated nodes</title>
      <g>
        {edges.map(([a, b], index) => {
          const from = points[a] as Point;
          const to = points[b] as Point;
          return (
            <path
              key={`${a}-${b}`}
              id={`${idPrefix}-edge-${index}`}
              className="ew-lattice__edge"
              d={`M ${from.x.toFixed(1)} ${from.y.toFixed(1)} L ${to.x.toFixed(1)} ${to.y.toFixed(1)}`}
            />
          );
        })}
      </g>
      <g>
        {points.map((point) => (
          <g key={`${point.x.toFixed(2)}-${point.y.toFixed(2)}`}>
            {!point.dim ? (
              <circle className="ew-lattice__halo" cx={point.x} cy={point.y} r={point.r * 5} />
            ) : null}
            <circle
              className={point.dim ? "ew-lattice__node ew-lattice__node--dim" : "ew-lattice__node"}
              cx={point.x}
              cy={point.y}
              r={point.r}
            />
          </g>
        ))}
      </g>
      <g>
        {pulseEdges.map(({ index }, order) => {
          const duration = 5 + (order % 4) * 1.7;
          return (
            <circle key={index} className="ew-lattice__pulse" r={2.2}>
              <animateMotion
                dur={`${duration}s`}
                begin={`-${(order * 1.9).toFixed(1)}s`}
                repeatCount="indefinite"
                keyPoints={order % 2 === 0 ? "0;1" : "1;0"}
                keyTimes="0;1"
                calcMode="linear"
              >
                <mpath href={`#${idPrefix}-edge-${index}`} />
              </animateMotion>
            </circle>
          );
        })}
      </g>
    </svg>
  );
}
