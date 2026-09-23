import { SectionHead } from "@eadwyn/ui";
import { contribute } from "@/content/ai-model";
import styles from "./contribute.module.css";

export function Contribute() {
  return (
    <section id="contribute" className="page-section" aria-labelledby="contribute-title">
      <div className="ew-container">
        <SectionHead
          id="contribute-title"
          index={contribute.index}
          title={contribute.title}
          lede={contribute.lede}
        />
        <ul className={styles.list}>
          {contribute.items.map((item, index) => (
            <li key={item.title} className={styles.row}>
              <span className={`${styles.rowIndex} ew-mono`}>
                {String(index + 1).padStart(2, "0")}
              </span>
              <div className={styles.rowMain}>
                <h3 className={styles.rowTitle}>{item.title}</h3>
                <p className={styles.rowBody}>{item.body}</p>
              </div>
              <div className={styles.rowAside}>
                <code className={styles.hint}>{item.hint}</code>
                <a
                  href={item.link.href}
                  className={styles.rowLink}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  {item.link.label} <span aria-hidden="true">↗</span>
                </a>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
