import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { prepareWordBank } from "../worker/src/word-bank.js";
import { buildWordEntryInsertSql } from "../worker/src/word-bank-import.js";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
const localImport = args.includes("--local");
const positionalArgs = args.filter((argument) => argument !== "--local");
const inputPath = positionalArgs[0];

if (
  !inputPath ||
  positionalArgs.length !== 1 ||
  args.some((argument) => argument.startsWith("--") && argument !== "--local")
) {
  console.error(
    "Usage: node scripts/import-word-bank.mjs <reviewed-dataset.json> [--local]",
  );
  process.exitCode = 2;
} else {
  try {
    const absoluteInputPath = path.resolve(inputPath);
    const dataset = JSON.parse(await readFile(absoluteInputPath, "utf8"));
    const prepared = await prepareWordBank(dataset);
    console.log(JSON.stringify(prepared.report, null, 2));
    if (prepared.rejected.length) {
      console.error(
        "Rejected rows:",
        JSON.stringify(prepared.rejected, null, 2),
      );
    }

    if (localImport && prepared.records.length) {
      const temporaryDirectory = await mkdtemp(
        path.join(os.tmpdir(), "a-forca-word-import-"),
      );
      try {
        const sqlFile = path.join(temporaryDirectory, "word-entries.sql");
        await writeFile(
          sqlFile,
          buildWordEntryInsertSql(prepared.records),
          "utf8",
        );
        const wranglerCli = path.join(
          projectRoot,
          "node_modules",
          "wrangler",
          "bin",
          "wrangler.js",
        );
        const result = spawnSync(
          process.execPath,
          [
            wranglerCli,
            "d1",
            "execute",
            "a-forca-medieval-local",
            "--local",
            "--config",
            "worker/wrangler.jsonc",
            "--file",
            sqlFile,
          ],
          { cwd: projectRoot, stdio: "inherit" },
        );
        if (result.error) {
          throw result.error;
        }
        if (result.status !== 0) {
          throw new Error(
            `Local Wrangler import failed with exit code ${result.status}`,
          );
        }
      } finally {
        await rm(temporaryDirectory, { recursive: true, force: true });
      }
    } else if (localImport) {
      console.log("No valid entries to import; local D1 was not changed.");
    } else {
      console.log(
        "Report-only mode. Pass --local to import these entries into local D1.",
      );
    }
  } catch (error) {
    console.error(`Word-bank import failed: ${error.message}`);
    process.exitCode = 1;
  }
}
