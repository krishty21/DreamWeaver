// Quick test of the JSON extraction/repair logic in src/lib/ai/shared.ts.
//
// Module 1 refactored the AI layer: ai.ts is now a thin delegator and the
// real repair logic lives in src/lib/ai/shared.ts. Both AI backends (zai +
// gemini) import these helpers so the SAME validation/retry/clamp logic
// runs regardless of which model serves the request.
//
// This test loads shared.ts, stubs out the zod + type imports so the pure
// functions can be evaluated standalone, and exercises the repair logic.
import { readFileSync } from "fs";
import { join } from "path";

// Resolve the shared repair module relative to this script so the test is
// portable across machines (no hardcoded /home/z/... paths).
const SHARED_PATH = join(import.meta.dir, "..", "src", "lib", "ai", "shared.ts");
const src = readFileSync(SHARED_PATH, "utf8");
// Stub `z` so the zod schemas at module load become inert Proxy objects
// (extractJSON / parseWithRepairs / repairTruncated don't call into zod).
const pre = src
  .replace(/import \{ z \} from "zod";/, `const mkStub = () => new Proxy(function(){}, { get: (t, p) => (p === "parse" ? (x) => x : (p === "parseSafe" ? () => ({ success: true, data: x }) : mkStub())), apply: () => mkStub() });\nconst z = mkStub();`)
  .replace(/import type[\s\S]*?from "@\/lib\/types";/, "");
// Transpile TS -> JS, strip ALL `export ` + `export default ` modifiers so
// `new Function` can evaluate the body (exports are stubbed via the wrapper).
const js = new Bun.Transpiler({ loader: "ts" })
  .transformSync(pre)
  .replace(/export\s+(async\s+)?(function|const|let|var)/g, "$1$2")
  .replace(/export\s+\*/g, "");
const mod: any = { exports: {} };
const fn = new Function("exports", js + "\nexports.extractJSON = extractJSON;\nexports.parseWithRepairs = parseWithRepairs;\nexports.repairTruncated = repairTruncated;\nexports.normalizeJSONSource = normalizeJSONSource;");
fn(mod);

const extractJSON = (mod as any).extractJSON;

const cases: { name: string; input: string; expect: "ok" | "null" }[] = [
  { name: "clean object", input: '{"a":1}', expect: "ok" },
  { name: "fenced", input: '```json\n{"a":1}\n```', expect: "ok" },
  { name: "prose-wrapped", input: 'Here is the JSON you asked for:\n{"a":1}\nHope that helps!', expect: "ok" },
  { name: "trailing comma", input: '{"a":[1,2,],}', expect: "ok" },
  { name: "truncated mid-array", input: '{"sceneText":"The door creaks open","choices":[{"id":"c1","label":"Enter"},{"id":"c2","label":"Run"', expect: "ok" },
  { name: "truncated mid-string", input: '{"sceneText":"The door creaks open and the hallway stret', expect: "ok" },
  { name: "line comments", input: '{\n  // the scene\n  "a": 1\n}', expect: "ok" },
  { name: "smart quotes", input: '{\u201Ca\u201D:1}', expect: "ok" },
  { name: "BOM + zero-width", input: '\uFEFF\u200B{"a":1}\u200B', expect: "ok" },
  { name: "truncated with one complete field", input: '{"sceneText":"complete scene","proposedDelta":{"fear":10,', expect: "ok" },
  { name: "array top-level", input: '[{"id":"c1"},{"id":"c2"}]', expect: "ok" },
  { name: "pure prose (no JSON at all)", input: "I am sorry, I cannot produce JSON today.", expect: "null" },
  { name: "empty", input: "", expect: "null" },
];

let pass = 0, fail = 0;
for (const c of cases) {
  const out = extractJSON(c.input);
  const ok = c.expect === "ok" ? out !== null && typeof out === "object" : out === null;
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "PASS" : "FAIL"} — ${c.name}${ok ? "" : " (got " + JSON.stringify(out).slice(0, 120) + ")"}`);
}
// Truncation correctness check: repaired object must contain the complete field
const trunc = extractJSON('{"sceneText":"complete scene","proposedDelta":{"fear":10,');
console.log("truncation keeps complete field:", trunc?.sceneText === "complete scene" ? "PASS" : "FAIL", JSON.stringify(trunc));
console.log(`\n${pass} pass / ${fail} fail`);
if (fail > 0) process.exit(1);
