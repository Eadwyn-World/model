/**
 * cf-provision — creates the Cloudflare resources the Workers bind to and
 * writes their ids into each wrangler.jsonc. Safe to re-run: existing
 * resources are found and reused.
 *
 *   pnpm cf:provision            # needs `wrangler login` or CLOUDFLARE_API_TOKEN
 *   pnpm cf:provision --dry-run  # print what would happen
 *
 * Local development never needs this: wrangler simulates every resource.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const dryRun = process.argv.includes("--dry-run");

const D1 = [
  { name: "eadwyn-coordinator", config: "apps/coordinator/wrangler.jsonc" },
  { name: "eadwyn-governance", config: "apps/governance/wrangler.jsonc" },
  { name: "eadwyn-aggregator", config: "apps/aggregator/wrangler.jsonc" },
  { name: "eadwyn-edge", config: "apps/inference-edge/wrangler.jsonc" },
];
const KV = [
  {
    title: "eadwyn-web-isr-cache",
    binding: "NEXT_INC_CACHE_KV",
    config: "apps/web/wrangler.jsonc",
  },
  {
    title: "eadwyn-edge-response-cache",
    binding: "RESPONSE_CACHE",
    config: "apps/inference-edge/wrangler.jsonc",
  },
];
const R2 = ["eadwyn-deltas", "eadwyn-checkpoints"];
const QUEUES = ["eadwyn-federation-events", "eadwyn-federation-events-dlq"];

function wrangler(args: string[], { json = false } = {}): string {
  const printable = `wrangler ${args.join(" ")}`;
  if (dryRun) {
    console.log(`  would run: ${printable}`);
    return json ? "[]" : "";
  }
  return execFileSync("pnpm", ["exec", "wrangler", ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function tryWrangler(args: string[]): { ok: boolean; output: string } {
  try {
    return { ok: true, output: wrangler(args) };
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string; message: string };
    return { ok: false, output: `${e.stdout ?? ""}${e.stderr ?? ""}${e.message}` };
  }
}

/** Replaces the database_id of the D1 entry named `name` in a wrangler.jsonc. */
export function setD1Id(source: string, name: string, id: string): string {
  const pattern = new RegExp(
    `("database_name":\\s*"${name}",[\\s\\S]*?"database_id":\\s*")[^"]*(")`,
  );
  if (!pattern.test(source)) throw new Error(`no D1 entry named ${name}`);
  return source.replace(pattern, `$1${id}$2`);
}

/** Replaces the id of the KV entry bound as `binding` in a wrangler.jsonc. */
export function setKvId(source: string, binding: string, id: string): string {
  const pattern = new RegExp(`("binding":\\s*"${binding}",\\s*"id":\\s*")[^"]*(")`);
  if (!pattern.test(source)) throw new Error(`no KV entry bound as ${binding}`);
  return source.replace(pattern, `$1${id}$2`);
}

function updateConfig(path: string, change: (source: string) => string): void {
  const file = join(root, path);
  const next = change(readFileSync(file, "utf8"));
  if (dryRun) {
    console.log(`  would update ${path}`);
    return;
  }
  writeFileSync(file, next);
}

function d1Id(name: string): string {
  const created = tryWrangler(["d1", "create", name]);
  const fromCreate = /"database_id":\s*"([0-9a-f-]{36})"/.exec(created.output)?.[1];
  if (fromCreate) return fromCreate;
  const listed = JSON.parse(wrangler(["d1", "list", "--json"], { json: true })) as {
    name: string;
    uuid: string;
  }[];
  const found = listed.find((db) => db.name === name);
  if (!found) throw new Error(`could not create or find D1 database ${name}:\n${created.output}`);
  return found.uuid;
}

function kvId(title: string): string {
  const created = tryWrangler(["kv", "namespace", "create", title]);
  const fromCreate = /"id":\s*"([0-9a-f]{32})"/.exec(created.output)?.[1];
  if (fromCreate) return fromCreate;
  const listed = JSON.parse(wrangler(["kv", "namespace", "list"], { json: true })) as {
    id: string;
    title: string;
  }[];
  const found = listed.find((ns) => ns.title === title);
  if (!found) throw new Error(`could not create or find KV namespace ${title}:\n${created.output}`);
  return found.id;
}

function ensure(kind: string, args: string[]): void {
  const result = tryWrangler(args);
  if (!result.ok && !/already exists|already taken|10004|11009/i.test(result.output)) {
    throw new Error(`could not create ${kind}:\n${result.output}`);
  }
}

function main(): void {
  console.log(
    dryRun ? "Dry run: nothing will be created.\n" : "Provisioning Cloudflare resources.\n",
  );

  for (const db of D1) {
    if (dryRun) wrangler(["d1", "create", db.name]);
    const id = dryRun ? "<new-uuid>" : d1Id(db.name);
    console.log(`D1 ${db.name}: ${id}`);
    if (!dryRun) updateConfig(db.config, (s) => setD1Id(s, db.name, id));
  }
  for (const ns of KV) {
    if (dryRun) wrangler(["kv", "namespace", "create", ns.title]);
    const id = dryRun ? "<new-id>" : kvId(ns.title);
    console.log(`KV ${ns.title}: ${id}`);
    if (!dryRun) updateConfig(ns.config, (s) => setKvId(s, ns.binding, id));
  }
  for (const bucket of R2) {
    ensure(`R2 bucket ${bucket}`, ["r2", "bucket", "create", bucket]);
    console.log(`R2 ${bucket}: ready`);
  }
  for (const queue of QUEUES) {
    ensure(`queue ${queue}`, ["queues", "create", queue]);
    console.log(`Queue ${queue}: ready`);
  }
  console.log("\nNext: set secrets and deploy (docs/deploy/cloudflare.md).");
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop() ?? "")) {
  main();
}
