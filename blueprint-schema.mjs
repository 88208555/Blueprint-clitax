// Public operation schemas supplement, and never replace, Hermes IR semantic validation.
const bpString = { type: "string", minLength: 1, pattern: "\\S" };
const bpArray = (items, minItems = 0) => ({ type: "array", items, minItems });
const bpObject = (properties, required = Object.keys(properties), additionalProperties = false) =>
  ({ type: "object", properties, required, additionalProperties });
const bpRefs = bpArray(bpString);
const bpPort = bpObject({ name: bpString, exposed: { type: "boolean" } }, ["name"], true);
const bpNode = bpObject({
  id: bpString, title: bpString, moduleId: bpString, entry: { type: "boolean" },
  inputs: bpArray(bpPort), outputs: bpArray(bpPort), requirementRefs: bpRefs,
}, ["id", "title", "moduleId", "inputs", "outputs"], true);
const bpEdge = bpObject({
  id: bpString, fromNodeId: bpString, toNodeId: bpString,
  type: { enum: ["data", "control", "success", "error", "trace", "event", "approval", "recovery", "audit", "optional", "compensation"] },
  fromOutput: bpString, toInput: bpString, allowCycle: { type: "boolean" }, loopGuard: bpString,
  loopLimit: bpObject({ maxIterations: { type: "integer", minimum: 1 } }, ["maxIterations"], true),
}, ["id", "fromNodeId", "toNodeId", "type"], true);
export const BLUEPRINT_IR_INPUT_SCHEMA = bpObject({
  schemaVersion: { const: "blueprint.ir/1.0" }, blueprintId: bpString, title: bpString,
  revision: { type: "integer", minimum: 0 }, entryNodeId: bpString,
  baseline: bpObject({ summary: bpString, facts: bpArray(bpObject({
    id: bpString, statement: bpString,
    status: { enum: ["confirmed", "inferred", "defaulted", "unknown", "conflicted", "rejected"] },
  }, ["id", "statement", "status"], true)) }, ["summary", "facts"], true),
  domains: bpArray(bpObject({ id: bpString, name: bpString, summary: bpString }, ["id", "name"], true)),
  modules: bpArray(bpObject({ id: bpString, domainId: bpString, name: bpString }, ["id", "domainId", "name"], true)),
  nodes: bpArray(bpNode, 1), edges: bpArray(bpEdge),
  acceptanceCriteria: bpArray(bpObject({ id: bpString, statement: bpString, nodeRefs: bpRefs }, ["id", "statement", "nodeRefs"], true), 1),
}, undefined, true);
export const BLUEPRINT_EVIDENCE_SCHEMA = bpObject({
  schemaVersion: { const: "cli.tax.test-evidence/1.0" }, evidenceId: bpString,
  kind: { enum: ["test", "build", "lint", "security", "benchmark"] },
  runner: { enum: ["local", "trusted-runner"] }, command: bpString, exitCode: { type: "integer" },
  durationMs: { type: "number", minimum: 0 }, summary: bpString,
  artifactSha256: { type: "string", pattern: "^[0-9a-f]{64}$" },
}, ["schemaVersion", "evidenceId", "kind", "runner", "command", "exitCode", "durationMs", "summary"], true);
const bpEmptyInput = bpObject({});
const bpCompileInput = bpObject({ blueprint: BLUEPRINT_IR_INPUT_SCHEMA });
export const BLUEPRINT_OPERATION_INPUTS = Object.freeze({
  capabilities: bpEmptyInput, help: bpEmptyInput, intake: bpEmptyInput,
  validate: bpCompileInput, "compile-inline": bpCompileInput,
  "acceptance-report": bpObject({
    blueprint: BLUEPRINT_IR_INPUT_SCHEMA,
    blueprintSha256: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
    results: bpArray(bpObject({ criterionId: bpString, evidence: bpArray(BLUEPRINT_EVIDENCE_SCHEMA) })),
  }),
});
export function blueprintSchemaFindings(value, schema, path = "input") {
  const findings = [];
  const reject = (message) => findings.push({
    severity: "P0", ruleId: "BLUEPRINT_INPUT_SCHEMA", entityRef: path, message,
    evidence: {}, recommendedAction: "Follow this operation's published inputSchema.",
  });
  const object = value !== null && typeof value === "object" && !Array.isArray(value);
  const matches = !schema.type || (schema.type === "object" ? object
    : schema.type === "array" ? Array.isArray(value)
      : schema.type === "integer" ? Number.isInteger(value)
        : typeof value === schema.type && (schema.type !== "number" || Number.isFinite(value)));
  if (!matches) { reject(`Expected ${schema.type}.`); return findings; }
  if (Object.hasOwn(schema, "const") && value !== schema.const) reject(`Expected ${schema.const}.`);
  if (schema.enum && !schema.enum.includes(value)) reject("Value is not in the supported enum.");
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) reject("String is too short.");
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) reject("String does not match the required pattern.");
  }
  if (typeof value === "number" && schema.minimum !== undefined && value < schema.minimum) reject("Number is below the minimum.");
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) reject("Array has too few items.");
    if (schema.items) value.forEach((item, index) => findings.push(...blueprintSchemaFindings(item, schema.items, `${path}[${index}]`)));
  }
  if (object) {
    if (schema.required) for (const key of schema.required) {
      if (!Object.hasOwn(value, key)) findings.push(...blueprintSchemaFindings(undefined, schema.properties[key], `${path}.${key}`));
    }
    for (const [key, item] of Object.entries(value)) {
      if (schema.properties && Object.hasOwn(schema.properties, key)) findings.push(...blueprintSchemaFindings(item, schema.properties[key], `${path}.${key}`));
      else if (schema.additionalProperties === false) reject(`Unsupported property: ${key}.`);
    }
  }
  return findings;
}
