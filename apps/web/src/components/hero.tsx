import { ButtonLink, Eyebrow, formatRelativeTime, Lattice } from "@eadwyn/ui";
import { hero } from "@/content/ai-model";
import type { FederationSnapshot } from "@/lib/federation";
import styles from "./hero.module.css";

export function Hero({ snapshot }: { snapshot: FederationSnapshot }) {
  const { stats, governance, fetchedAt } = snapshot;
  const now = new Date(fetchedAt).getTime();
  const readout = [
    `model v${stats.globalModelVersion}`,
    `round ${stats.activeRound.number} ${stats.activeRound.status}`,
    `${stats.activeRound.updatesReceived}/${stats.activeRound.expectedNodes} updates`,
    `${stats.registeredNodes} nodes`,
    `last sync ${formatRelativeTime(stats.lastSyncAt, now)}`,
    governance ? `${governance.pendingMerges} in review` : null,
  ].filter(Boolean);

  return (
    <section className={styles.hero} aria-labelledby="hero-title">
      <div className={styles.lattice} aria-hidden="true">
        <Lattice seed={11} count={54} pulses={7} idPrefix="hero-lattice" />
      </div>
      <div className={`ew-container ${styles.inner}`}>
        <Eyebrow>{hero.eyebrow}</Eyebrow>
        <h1 id="hero-title" className={styles.title}>
          {hero.title}
        </h1>
        <p className={`ew-lede ew-measure ${styles.lede}`}>{hero.lede}</p>
        <div className={styles.actions}>
          <ButtonLink href={hero.primary.href} variant="primary">
            {hero.primary.label}
          </ButtonLink>
          <ButtonLink href={hero.secondary.href} variant="secondary" external>
            {hero.secondary.label}
          </ButtonLink>
        </div>
        <p className={styles.readout}>
          <span className="visually-hidden">Federation readout: </span>
          <span className={styles.readoutDot} data-mode={snapshot.source.mode} aria-hidden="true" />
          {readout.map((item, index) => (
            <span key={String(item)} className={styles.readoutItem}>
              {index > 0 ? <span className={styles.readoutSep}>·</span> : null}
              {item}
            </span>
          ))}
        </p>
      </div>
    </section>
  );
}
