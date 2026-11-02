import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createFrontendConfig } from "./frontend-config.js";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const outputDirectory = path.join(projectRoot, "dist");
const frontendConfig = createFrontendConfig({
  appEnv: process.env.PUBLIC_APP_ENV || "local",
});

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });

for (const entry of [
  "index.html",
  "styles",
  "src/main.js",
  "src/config.js",
  "public/assets",
]) {
  await cp(path.join(projectRoot, entry), path.join(outputDirectory, entry), {
    recursive: true,
  });
}

await writeFile(
  path.join(outputDirectory, "src/config.js"),
  frontendConfig,
  "utf8",
);
await writeFile(
  path.join(outputDirectory, "_routes.json"),
  `${JSON.stringify({ version: 1, include: ["/api/*"], exclude: [] }, null, 2)}\n`,
  "utf8",
);

console.log("Frontend build written to dist/.");
