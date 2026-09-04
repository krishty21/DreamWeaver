// Quick test of the JSON extraction/repair logic in src/lib/ai.ts
import { readFileSync } from "fs";

// Strip SDK/zod imports so the pure functions can be evaluated standalone.
const src = readFileSync("/home/z/my-project/src/lib/ai.ts", "utf8");
const pre = src
  .replace(/import ZAI from "z-ai-web-dev-sdk";/, "")
  .replace(/import \{ z \} from "zod";/, `const mkStub = () => new Proxy(function(){}, { get: (t, p) => (p === "parse" ? (x) => x : mkStub()), apply: () => mkStub() });
const z = mkStub();`)
  .replace(/import type[\s\S]*?from "@\/lib\/types";/, "")
  .replace(/import \{ DREAM_ANALYSIS_PROMPT, ARCADE_SYSTEM_PROMPT \} from "@\/lib\/prompts";/, "");
// Transpile TS -> JS so `new Function` can evaluate it (exports are stubbed)
const js = new Bun.Transpiler({ loader: "ts" }).transformSync(pre).replace(/export (async )?function/g, "$1function");
const mod: any = { exports: {} };
const fn = new Function("exports", js + "\nexports.extractJSON = extractJSON;");
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
