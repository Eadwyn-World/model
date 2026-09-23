-- Tables behind the D1 variant of the document store (see src/stores/d1.ts).
CREATE TABLE IF NOT EXISTS eadwyn_documents (
  name TEXT PRIMARY KEY,
  revision TEXT NOT NULL,
  chunks INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS eadwyn_document_chunks (
  name TEXT NOT NULL,
  idx INTEGER NOT NULL,
  revision TEXT NOT NULL,
  body TEXT NOT NULL,
  PRIMARY KEY (name, idx)
);
