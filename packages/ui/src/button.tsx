import type { ReactNode } from "react";

export interface ButtonLinkProps {
  href: string;
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost";
  /** Set for links that leave the site. */
  external?: boolean;
  className?: string;
}

/** Links styled as buttons. All primary actions on the site are navigations. */
export function ButtonLink({
  href,
  children,
  variant = "secondary",
  external,
  className,
}: ButtonLinkProps) {
  return (
    <a
      href={href}
      className={["ew-button", `ew-button--${variant}`, className].filter(Boolean).join(" ")}
      {...(external ? { target: "_blank", rel: "noreferrer noopener" } : {})}
    >
      <span>{children}</span>
      <span className="ew-button__arrow" aria-hidden="true">
        {external ? "↗" : "→"}
      </span>
    </a>
  );
}
