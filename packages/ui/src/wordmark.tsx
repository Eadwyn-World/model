export interface WordmarkProps {
  href?: string;
  label?: string;
  className?: string;
}

/** A small lattice glyph followed by the name. */
export function Wordmark({ href = "/", label = "Eadwyn", className }: WordmarkProps) {
  return (
    <a
      href={href}
      className={["ew-wordmark", className].filter(Boolean).join(" ")}
      aria-label={`${label} home`}
    >
      <LatticeMark />
      <span>{label}</span>
    </a>
  );
}

export function LatticeMark({ size = 22 }: { size?: number }) {
  return (
    <svg
      className="ew-wordmark__mark"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <g fill="none" stroke="currentColor" strokeWidth="1.1" strokeOpacity="0.6">
        <path d="M5 6 L12 3 L19 6 L19 14 L12 21 L5 14 Z" />
        <path d="M5 6 L12 12 L19 6 M12 12 L12 21 M5 14 L12 12 L19 14" />
      </g>
      <g fill="var(--teal-300, #86ebdc)">
        <circle cx="12" cy="3" r="1.6" />
        <circle cx="5" cy="6" r="1.4" />
        <circle cx="19" cy="6" r="1.4" />
        <circle cx="12" cy="12" r="2" />
        <circle cx="5" cy="14" r="1.4" />
        <circle cx="19" cy="14" r="1.4" />
        <circle cx="12" cy="21" r="1.6" />
      </g>
    </svg>
  );
}
