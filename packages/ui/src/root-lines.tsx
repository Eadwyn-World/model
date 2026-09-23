/**
 * RootLines — connectors between the three stages of the learning loop.
 *
 * Drawn as a wide, shallow band above a three-column layout: a dotted root
 * from stage one to two, and two to three, with one pulse per segment.
 */
export interface RootLinesProps {
  idPrefix?: string;
  className?: string;
}

const SEGMENTS = [
  { id: "a", d: "M 167 70 C 240 70, 260 22, 333 22 S 430 70, 500 70" },
  { id: "b", d: "M 500 70 C 570 70, 590 118, 667 118 S 760 70, 833 70" },
] as const;

const NODES = [
  { x: 167, y: 70 },
  { x: 500, y: 70 },
  { x: 833, y: 70 },
] as const;

export function RootLines({ idPrefix = "roots", className }: RootLinesProps) {
  return (
    <svg
      className={["ew-roots", className].filter(Boolean).join(" ")}
      viewBox="0 0 1000 140"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <title>Learning travels between nodes</title>
      {SEGMENTS.map((segment) => (
        <path
          key={segment.id}
          id={`${idPrefix}-${segment.id}`}
          className="ew-roots__path"
          d={segment.d}
        />
      ))}
      {NODES.map((node) => (
        <circle
          key={`${node.x}-${node.y}`}
          className="ew-roots__node"
          cx={node.x}
          cy={node.y}
          r={6}
        />
      ))}
      {SEGMENTS.map((segment, index) => (
        <circle key={`pulse-${segment.id}`} className="ew-roots__pulse" r={3}>
          <animateMotion
            dur="4.2s"
            begin={`-${(index * 2.1).toFixed(1)}s`}
            repeatCount="indefinite"
            calcMode="linear"
          >
            <mpath href={`#${idPrefix}-${segment.id}`} />
          </animateMotion>
        </circle>
      ))}
    </svg>
  );
}
