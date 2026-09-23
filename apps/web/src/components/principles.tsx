import { SectionHead } from "@eadwyn/ui";
import { principles } from "@/content/ai-model";
import styles from "./principles.module.css";

export function Principles() {
  return (
    <section id="principles" className="page-section" aria-labelledby="principles-title">
      <div className="ew-container">
        <SectionHead
          id="principles-title"
          index={principles.index}
          title={principles.title}
          lede={principles.lede}
        />
        <ol className={styles.grid}>
          {principles.items.map((item) => (
            <li key={item.number} className={styles.item}>
              <span className={styles.number}>{item.number}</span>
              <h3 className={styles.title}>{item.title}</h3>
              <p className={styles.body}>{item.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
