// test-notes.mjs — typed notes survive a reload. Run: node test-notes.mjs
//
// Drives the real app in a fake browser (same method as verify-otp.mjs), signed
// out, with a day already stored on the device. Runs unchanged in all four
// client repos: the storage prefix is read from src/config.jsx.
//
// Why it exists (11 Nov 2026): a long daily note was saved, uploaded, and then
// deleted by the app. After a reload the notes box started EMPTY although a
// note was stored, and tapping in and out of the empty box saved "empty" over
// it. A second weakness found the same day: the save-on-page-hide guard blurred
// the box but the write ran too late to land before a reload.
import { JSDOM } from "jsdom";
import fs from "fs";
import { execSync } from "child_process";

let pass = 0, fail = 0;
const ok = (n, c) => { c ? pass++ : fail++; console.log((c ? "ok   " : "FAIL ") + n); };
const done = () => { console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0); };
process.on("uncaughtException", (e) => { console.log("FAIL (crash): " + e.message); fail++; done(); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const prefix = (fs.readFileSync("src/config.jsx", "utf8").match(/STORAGE_PREFIX\s*=\s*"([^"]+)"/) || [])[1];
ok("storage prefix found in src/config.jsx", Boolean(prefix));
if (!prefix) done();

execSync("npx esbuild src/entry.jsx --bundle --outfile=/tmp/test-notes-bundle.js --loader:.jsx=jsx --log-level=error");
const bundle = fs.readFileSync("/tmp/test-notes-bundle.js", "utf8");

const pad = (n) => String(n).padStart(2, "0");
const now = new Date();
const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
const NOTE = "A long note about how the day went, typed over several minutes.";

// One fresh "browser" per scenario, so nothing leaks between them.
async function boot(storedLog) {
  const dom = new JSDOM(`<!DOCTYPE html><div id="root"></div>`, {
    url: "https://yellowg-dev.github.io/Test-PTapp/", runScripts: "outside-only", pretendToBeVisual: true,
  });
  const w = dom.window;
  w.fetch = async () => ({ ok: true, status: 200, headers: { get: () => "application/json" }, json: async () => [], text: async () => "[]" });
  w.localStorage.setItem(prefix + "log", JSON.stringify(storedLog));
  w.eval(bundle);
  await wait(1200);
  const stored = () => JSON.parse(w.localStorage.getItem(prefix + "log") || "{}")[today] || {};
  const box = () => w.document.querySelector("textarea");
  const type = (el, v) => {
    Object.getOwnPropertyDescriptor(w.HTMLTextAreaElement.prototype, "value").set.call(el, v);
    el.dispatchEvent(new w.Event("input", { bubbles: true }));
  };
  return { w, stored, box, type, close: () => w.close() };
}

console.log("--- 1. the box shows the stored note after a cold start ---");
{
  const a = await boot({ [today]: { done: { x: true }, notes: NOTE } });
  ok("notes box is on screen", Boolean(a.box()));
  if (!a.box()) done();
  ok("box shows the stored note", a.box().value === NOTE);

  console.log("--- 2. tapping in and out of the box never deletes the note ---");
  a.box().focus(); await wait(50);
  a.box().blur(); await wait(1500);
  ok("note still stored after focus + blur", a.stored().notes === NOTE);
  ok("box still shows the note", a.box().value === NOTE);

  console.log("--- 3. deleting the text on purpose still removes the note ---");
  a.box().focus(); a.type(a.box(), ""); await wait(50);
  a.box().blur(); await wait(100);
  ok("cleared note is removed", !("notes" in a.stored()));
  ok("the rest of the day is kept", a.stored().done && a.stored().done.x === true);
  a.close();
}

console.log("--- 4. a reload while the box is still focused keeps the text ---");
{
  const a = await boot({ [today]: { done: { x: true } } });
  a.box().focus(); a.type(a.box(), NOTE);
  // No waiting here on purpose: what is in storage the instant pagehide returns
  // is all that survives a real reload.
  a.w.dispatchEvent(new a.w.Event("pagehide"));
  ok("note is in storage as pagehide returns", a.stored().notes === NOTE);
  a.close();
}

console.log("--- 5. typing saves by itself about a second after the last key ---");
{
  const a = await boot({ [today]: { done: { x: true } } });
  a.box().focus(); a.type(a.box(), NOTE);
  await wait(300);
  ok("not saved on every keystroke", !("notes" in a.stored()));
  await wait(1200);
  ok("saved without tapping out", a.stored().notes === NOTE);
  ok("box keeps focus and text while it saves", a.w.document.activeElement === a.box() && a.box().value === NOTE);
  a.close();
}

console.log("--- 6. exercise notes: dated, and tied to the exercise not the variant ---");
{
  const src = fs.readFileSync("src/app.jsx", "utf8");
  ok("last note is collected with the day it was written", /out\[id\] = \{ note, day: dstr \}/.test(src));
  ok("last note is shown with its date", /noteDateLabel\(lastNote\.day\)\}: \{lastNote\.note\}/.test(src));
  ok("notes are looked up by the exercise id", /const lastNote = lastExNotes\[task\.id\];/.test(src));
  ok("no note is read or written under a variant key", !/exNotes\??\.?\[(lk|loadKeyFor)/.test(src) && !/commitExNote\(lk/.test(src));
}

done();
