import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

async function readProjectFile(path) {
  return readFile(new URL(path, root), "utf8");
}

test("login page exposes accessible same-origin provider actions and session status", async () => {
  const html = await readProjectFile("index.html");

  assert.match(html, /<main\b/);
  assert.match(html, /<h1 id="page-title">A Forca Medieval<\/h1>/);
  assert.match(html, /aria-busy="true"/);
  assert.match(html, /id="auth-status"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(html, /href="\/api\/auth\/google\/start">Entrar com Google<\/a>/);
  assert.match(html, /href="\/api\/auth\/github\/start">Entrar com GitHub<\/a>/);
  assert.match(html, /id="logout-button"[^>]*hidden/);
  assert.match(html, /id="retry-session-button"/);
  assert.match(html, /Verificando sessão/);
  assert.doesNotMatch(html, /workers\.dev|client_secret|access_token|id_token/i);
});

test("session UI uses relative API routes, text-only identity rendering, and no browser token storage", async () => {
  const script = await readProjectFile("src/main.js");
  const sessionModule = await readProjectFile("src/auth-session.js");
  const uiModule = await readProjectFile("src/auth-ui.js");
  const config = await readProjectFile("src/config.js");

  assert.match(config, /API_BASE_URL = "\/api"/);
  assert.match(script, /import \{ API_BASE_URL, APP_ENV \} from "\.\/config\.js"/);
  assert.match(script, /apiBaseUrl: API_BASE_URL/);
  assert.match(uiModule, /requestSession\(\{ fetchImpl, apiBaseUrl \}\)/);
  assert.match(sessionModule, /`\$\{apiBaseUrl\}\/auth\/session`/);
  assert.match(sessionModule, /credentials: "same-origin"/);
  assert.match(sessionModule, /cache: "no-store"/);
  assert.match(sessionModule, /redirect: "error"/);
  assert.match(script, /initializeAuthUI\(/);
  assert.match(script, /export const authUI/);
  assert.match(script, /await authUI\.initialization/);
  assert.match(uiModule, /`\$\{apiBaseUrl\}\/auth\/logout`/);
  assert.match(uiModule, /textContent = `Bem-vindo, \$\{session\.displayName\}\./);
  assert.match(uiModule, /retryButton\.addEventListener\("click", loadSession\)/);
  assert.match(uiModule, /authActions\.hidden = true/);
  assert.match(uiModule, /authActions\.hidden = false/);
  assert.match(uiModule, /logoutButton\.hidden = false/);
  assert.match(uiModule, /logoutButton\.disabled = true/);
  assert.match(sessionModule, /redirect: "error"/);
  assert.doesNotMatch(`${script}\n${uiModule}`, /localStorage|sessionStorage|document\.cookie/);
});

test("login controls retain visible keyboard focus and fit narrow viewports", async () => {
  const css = await readProjectFile("styles/components.css");
  const responsive = await readProjectFile("styles/responsive.css");

  assert.match(css, /\.auth-button:focus-visible\s*\{[^}]*outline:/s);
  assert.match(css, /\.auth-actions\s*\{[^}]*flex-wrap:\s*wrap/s);
  assert.match(css, /\.auth-button\s*\{[^}]*flex:\s*1 1 12rem/s);
  assert.match(responsive, /max-width:\s*480px/);
  assert.match(responsive, /prefers-reduced-motion:\s*reduce/);
});
