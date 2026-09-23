import { ButtonLink } from "@eadwyn/ui";
import { philosophy } from "@/content/ai-model";
import styles from "./philosophy.module.css";

export function Philosophy() {
  return (
    <section id="philosophy" className="page-section" aria-labelledby="philosophy-title">
      <div className={`ew-container ${styles.inner}`}>
        <div className={styles.lead}>
          <p className="ew-section-head__index">{philosophy.index}</p>
          <blockquote className={styles.quote}>
            <p id="philosophy-title" className={styles.epigraph}>
              “{philosophy.epigraph}”
            </p>
            <footer className={styles.attribution}>{philosophy.attribution}</footer>
          </blockquote>
          <div className={styles.link}>
            <ButtonLink href={philosophy.link.href} variant="ghost" external>
              {philosophy.link.label}
            </ButtonLink>
          </div>
        </div>
        <ul className={styles.tenets}>
          {philosophy.tenets.map((tenet) => (
            <li key={tenet.title} className={styles.tenet}>
              <h3 className={styles.tenetTitle}>{tenet.title}</h3>
              <p className={styles.tenetBody}>{tenet.body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
