import assert from "node:assert/strict";
import test from "node:test";
import { compareDiagnosticCodeSets } from "./sample-diagnostic-codes.mjs";

test("a documented counter-example owns exactly its diagnostic-code set", () => {
  assert.deepEqual(compareDiagnosticCodeSets("error VEL4001", "error VEL4001"), {
    quoted: ["VEL4001"],
    produced: ["VEL4001"],
    missing: [],
    unexpected: [],
  });
  assert.deepEqual(compareDiagnosticCodeSets("error VEL4001", "error VEL4001\nerror VEL5065"), {
    quoted: ["VEL4001"],
    produced: ["VEL4001", "VEL5065"],
    missing: [],
    unexpected: ["VEL5065"],
  });
  assert.deepEqual(compareDiagnosticCodeSets("error VEL3007", "error VEL4001"), {
    quoted: ["VEL3007"],
    produced: ["VEL4001"],
    missing: ["VEL3007"],
    unexpected: ["VEL4001"],
  });
});
