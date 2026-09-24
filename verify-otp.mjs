// verify-otp.mjs — 6-digit code sign-in works inside the installed app.
// Drives the real built app in a fake browser with the network stubbed.
import { JSDOM } from "jsdom";
import fs from "fs";
import { execSync } from "child_process";
process.on("uncaughtException", (e) => { console.log("FAIL (crash): " + e.message); console.log(`\n${pass} passed, ${fail + 1} failed`); process.exit(1); });
let pass = 0, fail = 0;
const ok = (n, c) => { c ? pass++ : fail++; console.log((c ? "ok   " : "FAIL ") + n); };

const src = fs.readFileSync("src/core/supabase.js", "utf8");
ok("supabase.js exports verifyCode", /export async function verifyCode/.test(src));
ok("verifyCode calls verifyOtp with type email", /verifyOtp\(\{ email: address, token, type: "email" \}\)/.test(src));
ok("app.jsx imports verifyCode", /import \{[^}]*verifyCode/.test(fs.readFileSync("src/app.jsx", "utf8")));

execSync("npx esbuild src/entry.jsx --bundle --outfile=/tmp/verify-otp-bundle.js --loader:.jsx=jsx --log-level=error");
const bundle = fs.readFileSync("/tmp/verify-otp-bundle.js", "utf8");
const dom = new JSDOM(`<!DOCTYPE html><div id="root"></div>`, { url: "https://yellowg-dev.github.io/Ville-PTapp/", runScripts: "outside-only", pretendToBeVisual: true });
const w = dom.window;
const calls = [];
const jwt = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const session = { access_token: `x.${jwt({ sub: "u1", exp: Math.floor(Date.now()/1000)+3600, email: "test@example.com", role: "authenticated" })}.y`, token_type: "bearer", expires_in: 3600, refresh_token: "r1", user: { id: "u1", email: "test@example.com" } };
w.fetch = async (url, opt = {}) => {
  const u = String(url); calls.push({ u, body: opt.body ? String(opt.body) : null });
  const json = u.includes("/auth/v1/otp") ? {} : u.includes("/auth/v1/verify") ? session : u.includes("/rest/v1/") ? [] : {};
  return { ok: true, status: 200, headers: { get: () => "application/json" }, json: async () => json, text: async () => JSON.stringify(json) };
};
w.eval(bundle);
await new Promise((r) => setTimeout(r, 1200));
const byText = (t) => [...w.document.querySelectorAll("button")].find((b) => b.textContent.trim() === t);
const need = (t) => { const b = byText(t); if (!b) { ok(`button "${t}" is on screen`, false); console.log(`\n${pass} passed, ${fail} failed`); process.exit(1); } return b; };
const click = async (el) => { el.dispatchEvent(new w.MouseEvent("click", { bubbles: true })); await new Promise((r) => setTimeout(r, 400)); };
const type = (el, v) => { Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, "value").set.call(el, v); el.dispatchEvent(new w.Event("input", { bubbles: true })); };

await click([...w.document.querySelectorAll("button")].find((b) => /Settings|settings/.test(b.getAttribute("aria-label") || "")) || byText("Settings"));
const email = w.document.querySelector('input[type="email"]');
ok("sign-in email field is on screen", Boolean(email));
ok("no code field before a code is sent", !w.document.querySelector('input[aria-label="Six-digit sign-in code"]'));
type(email, "test@example.com");
await click(need("Send code"));
ok("app asked Supabase to send a code", calls.some((c) => c.u.includes("/auth/v1/otp")));
const codeField = w.document.querySelector('input[aria-label="Six-digit sign-in code"]');
ok("code field appears after sending", Boolean(codeField));
if (codeField) {
  type(codeField, "123456");
  await click(need("Sign in"));
  const v = calls.find((c) => c.u.includes("/auth/v1/verify"));
  ok("app verified the code", Boolean(v) && v.body.includes('"token":"123456"') && v.body.includes('"type":"email"'));
  await new Promise((r) => setTimeout(r, 600));
  ok("app shows the account as signed in", w.document.body.textContent.includes("test@example.com"));
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
