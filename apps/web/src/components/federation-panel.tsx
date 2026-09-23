"use client";

import { formatInteger, formatRelativeTime, formatUtc, SectionHead } from "@eadwyn/ui";
import { useEffect, useState } from "react";
import { federation } from "@/content/ai-model";
import type { FederationSnapshot } from "@/lib/federation";
import styles from "./federation-panel.module.css";

const POLL_INTERVAL_MS = 15_000;
const CLOCK_INTERVAL_MS = 10_000;

export function FederationPanel({ initial }: { initial: FederationSnapshot }) {
  const [snapshot, setSnapshot] = useState(initial);
  // Relative times are computed against the snapshot's own clock on the first
  // render (server and client agree), then against the wall clock after mount.
  const [now, setNow] = useState(() => new Date(initial.fetchedAt).getTime());
  const [pollError, setPollError] = useState<string | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const clock = setInterval(() => setNow(Date.now()), CLOCK_INTERVAL_MS);
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch("/api/federation", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const next = (await res.json()) as FederationSnapshot;
        if (!cancelled) {
          setSnapshot(next);
          setNow(Date.now());
          setPollError(null);
        }
      } catch (error) {
        if (!cancelled) setPollError(error instanceof Error ? error.message : String(error));
      }
    };
    const timer = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(clock);
      clearInterval(timer);
    };
  }, []);

  const { stats, governance, source } = snapshot;
  const round = stats.activeRound;
  const progress =
    round.expectedNodes > 0 ? Math.min(1, round.updatesReceived / round.expectedNodes) : 0;
  const live = source.mode === "live";

  return (
    <section id="federation" className="page-section" aria-labelledby="federation-title">
      <div className="ew-container">
        <SectionHead
          id="federation-title"
          index={federation.index}
          title={federation.title}
          lede={federation.lede}
        />

        <div className={styles.panel}>
          <div className={styles.status}>
            <span className={styles.statusPill} data-mode={source.mode}>
              <span className={styles.statusDot} aria-hidden="true" />
              {live ? federation.sourceLive : federation.sourceSnapshot}
            </span>
            <span className={styles.statusMeta}>
              {live
                ? `coordinator · ${hostOf(source.coordinatorUrl)}`
                : `coordinator unreachable · built-in snapshot`}
            </span>
            <span className={styles.statusMeta}>
              updated {formatRelativeTime(snapshot.fetchedAt, now)}
              {pollError ? ` · refresh failed (${pollError})` : ""}
            </span>
          </div>

          <dl className={styles.tiles}>
            <div className={styles.tile}>
              <dt className={styles.label}>{federation.labels.model}</dt>
              <dd className={styles.value}>
                <span className={styles.valuePrefix}>v</span>
                {stats.globalModelVersion}
              </dd>
              <dd className={styles.sub}>
                published {formatRelativeTime(stats.globalModelPublishedAt, now)}
              </dd>
            </div>

            <div className={`${styles.tile} ${styles.tileWide}`}>
              <dt className={styles.label}>{federation.labels.round}</dt>
              <dd className={styles.value}>
                {round.number}
                <span className={styles.valueTag}>{round.status}</span>
              </dd>
              <dd className={styles.sub}>
                {formatInteger(round.updatesReceived)} of {formatInteger(round.expectedNodes)}{" "}
                updates received
              </dd>
              <dd className={styles.meter} aria-hidden="true">
                <span
                  className={styles.meterFill}
                  style={{ width: `${(progress * 100).toFixed(1)}%` }}
                />
              </dd>
            </div>

            <div className={styles.tile}>
              <dt className={styles.label}>{federation.labels.nodes}</dt>
              <dd className={styles.value}>{formatInteger(stats.registeredNodes)}</dd>
              <dd className={styles.sub}>
                {formatInteger(stats.onlineNodes)} seen in the last six hours
              </dd>
            </div>

            <div className={styles.tile}>
              <dt className={styles.label}>{federation.labels.sync}</dt>
              <dd className={`${styles.value} ${styles.valueCompact}`}>
                {formatRelativeTime(stats.lastSyncAt, now)}
              </dd>
              <dd className={`${styles.sub} ew-mono`}>{formatUtc(stats.lastSyncAt)}</dd>
            </div>

            <div className={styles.tile}>
              <dt className={styles.label}>{federation.labels.merges}</dt>
              <dd className={styles.value}>
                {governance ? formatInteger(governance.pendingMerges) : "—"}
              </dd>
              <dd className={styles.sub}>
                {governance
                  ? `${formatInteger(governance.reviewers)} ${governance.reviewers === 1 ? "reviewer" : "reviewers"} on record`
                  : "governance unreachable"}
              </dd>
            </div>
          </dl>

          <p className={`${styles.foot} ew-mono`}>
            base {round.baseModelVersion} · round {round.roundId.slice(0, 8)} · generated{" "}
            {formatUtc(stats.generatedAt)}
          </p>
        </div>
      </div>
    </section>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
