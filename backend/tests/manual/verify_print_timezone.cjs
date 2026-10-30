const fs = require("fs");
const vm = require("vm");
const assert = require("assert");
const path = require("path");
const root = path.resolve(__dirname, "../../..");
const ts = require(path.join(root, "frontend/node_modules/typescript"));
const source = fs.readFileSync(path.join(root, "frontend/src/lib/localPrint.ts"), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const moduleObject = { exports: {} };
vm.runInNewContext(compiled, { exports: moduleObject.exports, module: moduleObject, require: () => ({}), Intl, Date });
const convert = moduleObject.exports.cairoPrintTimestamp;
for (const [input, output] of [
  ["2026-04-23T21:59:59Z", "2026-04-23T23:59:59+02:00"],
  ["2026-04-23T22:00:00Z", "2026-04-24T01:00:00+03:00"],
  ["2026-10-29T20:59:59Z", "2026-10-29T23:59:59+03:00"],
  ["2026-10-29T21:00:00Z", "2026-10-29T23:00:00+02:00"],
]) {
  assert.strictEqual(convert(input), output);
  assert.strictEqual(Date.parse(convert(input)), Date.parse(input));
}
assert.strictEqual(convert("2026-10-29T23:00:00"), "2026-10-29T23:00:00");
console.log("Print timestamps preserve the instant and Cairo DST transitions");
