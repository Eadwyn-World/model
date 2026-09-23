import { Wordmark } from "@eadwyn/ui";
import { footer } from "@/content/ai-model";
import styles from "./site-footer.module.css";

export function SiteFooter() {
  return (
    <footer className={styles.footer}>
      <div className={`ew-container ${styles.inner}`}>
        <div className={styles.brand}>
          <Wordmark />
          <p className={styles.line}>{footer.line}</p>
        </div>
        <nav aria-label="Documentation" className={styles.links}>
          {footer.links.map((link) => (
            <a key={link.href} href={link.href} target="_blank" rel="noreferrer noopener">
              {link.label}
            </a>
          ))}
        </nav>
        <blockquote className={styles.quote}>
          <p>“{footer.quote}”</p>
          <footer>{footer.attribution}</footer>
        </blockquote>
      </div>
    </footer>
  );
}
