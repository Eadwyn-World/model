import type { ReactNode } from "react";

export interface SectionHeadProps {
  index: string;
  title: ReactNode;
  lede?: ReactNode;
  id?: string;
}

/** Numbered section heading: index label, display title, optional lede on the right. */
export function SectionHead({ index, title, lede, id }: SectionHeadProps) {
  return (
    <div className="ew-section-head">
      <div>
        <p className="ew-section-head__index">{index}</p>
        <h2 id={id}>{title}</h2>
      </div>
      {lede ? <p className="ew-section-head__lede">{lede}</p> : null}
    </div>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="ew-eyebrow">{children}</p>;
}

export function Rule() {
  return <hr className="ew-rule" />;
}
