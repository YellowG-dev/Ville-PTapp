// verify-time.mjs — Option B+ (duration entry) checks. Run: node verify-time.mjs
// Needs no node_modules: reads src/app.jsx as text and evaluates only the
// helper block between the ==time-input markers.
import fs from "fs";
process.on("uncaughtException", (e) => { console.log("FAIL (crash): " + e.message); process.exit(1); });

const file = process.argv[2] || "src/app.jsx";
const src = fs.readFileSync(file, "utf8");
let pass = 0, fail = 0;
const check = (name, ok) => { ok ? pass++ : fail++; console.log((ok ? "ok   " : "FAIL ") + name); };

const m = src.match(/\/\/ ==time-input:start([\s\S]*?)\/\/ ==time-input:end/);
check("helper block present", Boolean(m));
let parse = () => undefined, fmt = () => undefined, UNIT;
if (m) {
  const f = new Function(m[1] + "\nreturn { parseNumberInput, formatTime, TIME_UNIT };");
  ({ parseNumberInput: parse, formatTime: fmt, TIME_UNIT: UNIT } = f());
}

// Durations -> minutes
check('"42:30" -> 42.5', parse("42:30") === 42.5);
check('"1:45:12" -> 105.2', parse("1:45:12") === 105.2);
check('"5:32" -> 5.5333', parse("5:32") === 5.5333);
check('"0:45" -> 0.75', parse("0:45") === 0.75);
check('"105:00" -> 105', parse("105:00") === 105);
check('" 42:30 " trimmed', parse(" 42:30 ") === 42.5);
// Invalid durations are rejected, not half-read
check('"5:75" rejected', parse("5:75") === null);
check('"1:75:00" rejected', parse("1:75:00") === null);
check('"1:2:3:4" rejected', parse("1:2:3:4") === null);
check('"a:30" rejected', parse("a:30") === null);
check('":30" rejected', parse(":30") === null);
// Plain numbers: identical to the old parseFloat path
const old = (raw) => { const n = parseFloat(String(raw).trim().replace(",", ".")); return raw !== "" && !isNaN(n) ? n : null; };
for (const v of ["82.4", "82,4", "12", "0", "-3", " 7 ", "", "abc", "12abc", "1,5"]) {
  check(`plain "${v}" matches old behaviour`, parse(v) === old(v));
}
// Display round-trip
check('format 42.5 -> "42:30"', fmt(42.5) === "42:30");
check('format 105.2 -> "1:45:12"', fmt(105.2) === "1:45:12");
check('format 5.5333 -> "5:32"', fmt(5.5333) === "5:32");
check('format 60 -> "1:00:00"', fmt(60) === "1:00:00");
check('round-trip "3:05:09"', fmt(parse("3:05:09")) === "3:05:09");
check('TIME_UNIT is "h:mm:ss"', UNIT === "h:mm:ss");
// Wiring
check("commitNumber uses parseNumberInput", /const commitNumber[\s\S]{0,200}parseNumberInput\(raw\)/.test(src));
check("old silent parseFloat gone from commitNumber", !/const commitNumber[\s\S]{0,200}parseFloat/.test(src));
check("time fields get the full keyboard", src.includes('inputMode={task.unit === TIME_UNIT ? "text" : "decimal"}'));
check("time fields display h:mm:ss", src.includes("formatTime(value)"));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
