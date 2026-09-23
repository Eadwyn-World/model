#!/usr/bin/env node
// Copies .dev.vars.example to .dev.vars in the current app if it is missing.
// .dev.vars holds local-only values for `wrangler dev` and is git-ignored.
import { copyFileSync, existsSync } from "node:fs";

if (existsSync(".dev.vars.example") && !existsSync(".dev.vars")) {
  copyFileSync(".dev.vars.example", ".dev.vars");
  console.log(`created ${process.cwd()}/.dev.vars from .dev.vars.example`);
}
