import { RootLines, SectionHead } from "@eadwyn/ui";
import { loop } from "@/content/ai-model";
import styles from "./learning-loop.module.css";

export function LearningLoop() {
  return (
    <section id="how-it-grows" className="page-section" aria-labelledby="loop-title">
      <div className="ew-container">
        <SectionHead id="loop-title" index={loop.index} title={loop.title} />
        <div className={styles.roots} aria-hidden="true">
          <RootLines idPrefix="loop-roots" />
        </div>
        <ol className={styles.steps}>
          {loop.steps.map((step, index) => (
            <li key={step.title} className={styles.step}>
              <span className={styles.stepIndex}>{String(index + 1).padStart(2, "0")}</span>
              <h3 className={styles.stepTitle}>{step.title}</h3>
              <p className={styles.stepBody}>{step.body}</p>
              <p className={`${styles.stepMeta} ew-mono`}>{step.meta}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
