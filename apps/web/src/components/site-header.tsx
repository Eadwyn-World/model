import { ButtonLink, Wordmark } from "@eadwyn/ui";
import { nav } from "@/content/ai-model";
import styles from "./site-header.module.css";

export function SiteHeader() {
  return (
    <header className={styles.header}>
      <div className={`ew-container ${styles.inner}`}>
        <Wordmark />
        <nav aria-label="Page sections" className={styles.nav}>
          {nav.links.map((link) => (
            <a key={link.href} href={link.href} className={styles.link}>
              {link.label}
            </a>
          ))}
        </nav>
        <div className={styles.actions}>
          <ButtonLink href={nav.source.href} variant="secondary" external>
            {nav.source.label}
          </ButtonLink>
        </div>
      </div>
    </header>
  );
}
