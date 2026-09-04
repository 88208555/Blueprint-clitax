import { createHash } from "node:crypto";
import { BLUEPRINT_OPERATION_INPUTS, blueprintSchemaFindings } from "./blueprint-schema.mjs";
import { buildBlueprintMachineTasks } from "./blueprint-task-graph.mjs";

const BP_RESPONSE_SCHEMA = "blueprint.skill.response/1.0";
const BP_REQUEST_SCHEMA = "blueprint.skill.request/1.0";
const BP_MANIFEST = "ARTIFACT-MANIFEST.json";
const BP_IR_ARTIFACT = "PROJECT-BLUEPRINT.json";
const BP_REPORT_MODE = "caller-supplied-test-evidence";
const blueprintDigest = (value) => createHash("sha256").update(value).digest("hex");
const blueprintSummary = (findings) => ({
  p0: findings.filter((item) => item.severity === "P0").length,
  p1: findings.filter((item) => item.severity === "P1").length,
  p2: findings.filter((item) => item.severity === "P2").length,
  p3: findings.filter((item) => item.severity === "P3").length, total: findings.length,
});
function bridgeFinding(ruleId, entityRef, message, evidence = {}) {
  return { ruleId, severity: "P0", entityRef, message, evidence,
    recommendedAction: "Provide the current compiled Blueprint hash and actual evidence for every criterion." };
}
function blueprintBlocked(request, findings) {
  return { schemaVersion: BP_RESPONSE_SCHEMA, requestId: request.requestId, status: "blocked",
    brainMode: null, requestedBrainMode: "ide", brainUsed: false, revision: null,
    validation: { valid: false, guarantee: "blocked", findings, summary: blueprintSummary(findings) },
    artifacts: [], questions: [], findingSummary: blueprintSummary(findings) };
}
function blueprintJsonArtifact(role, name, value) {
  const content = `${JSON.stringify(value, null, 2)}\n`;
  return { role, name, mediaType: "application/json", sha256: `sha256:${blueprintDigest(content)}`, content };
}
function compiledBlueprint(result) {
  const artifacts = result.artifacts.filter((artifact) => artifact.name === BP_IR_ARTIFACT);
  if (artifacts.length !== 1) throw new Error("Blueprint compiler must return exactly one IR artifact.");
  const artifact = artifacts[0];
  if (artifact.sha256 !== `sha256:${blueprintDigest(artifact.content)}`) throw new Error("Compiled Blueprint artifact digest mismatch.");
  return { blueprint: JSON.parse(artifact.content), blueprintSha256: artifact.sha256 };
}
function addBlueprintMachineArtifact(result) {
  const { blueprint, blueprintSha256 } = compiledBlueprint(result);
  const machineTasks = buildBlueprintMachineTasks(blueprint, blueprintSha256, blueprintDigest);
  const taskArtifact = blueprintJsonArtifact("implementation-tasks-json", "IMPLEMENTATION-TASKS.json", machineTasks);
  const manifests = result.artifacts.filter((artifact) => artifact.name === BP_MANIFEST);
  if (manifests.length !== 1) throw new Error("Blueprint compiler must return exactly one artifact manifest.");
  const manifest = JSON.parse(manifests[0].content);
  const { content, ...entry } = taskArtifact;
  manifest.artifacts.push(entry);
  const manifestArtifact = blueprintJsonArtifact(manifests[0].role, BP_MANIFEST, manifest);
  return { ...result, machineTasks, artifacts: [...result.artifacts.filter((artifact) => artifact.name !== BP_MANIFEST),
    taskArtifact, manifestArtifact] };
}
function criterionEvidenceFindings(results, expectedIds) {
  const findings = [], seen = new Set();
  results.forEach((result, index) => {
    const entityRef = `input.results[${index}]`;
    if (!expectedIds.has(result.criterionId)) findings.push(bridgeFinding("ACCEPTANCE_UNKNOWN_CRITERION", entityRef, "Unknown criterionId.", { criterionId: result.criterionId }));
    if (seen.has(result.criterionId)) findings.push(bridgeFinding("ACCEPTANCE_DUPLICATE_CRITERION", entityRef, "A criterion must have exactly one result.", { criterionId: result.criterionId }));
    seen.add(result.criterionId);
    const evidenceIds = new Set();
    result.evidence.forEach((evidence) => {
      if (evidenceIds.has(evidence.evidenceId)) findings.push(bridgeFinding("ACCEPTANCE_DUPLICATE_EVIDENCE", entityRef, "Duplicate evidenceId within a criterion.", { evidenceId: evidence.evidenceId }));
      evidenceIds.add(evidence.evidenceId);
    });
  });
  return findings;
}
function reconcileBlueprintAcceptance(request, compiled) {
  const { blueprint, blueprintSha256 } = compiledBlueprint(compiled);
  const input = request.input, expectedIds = new Set(blueprint.acceptanceCriteria.map((criterion) => criterion.id));
  const findings = criterionEvidenceFindings(input.results, expectedIds);
  if (input.blueprintSha256 !== blueprintSha256) findings.push(bridgeFinding("ACCEPTANCE_BLUEPRINT_HASH", "input.blueprintSha256",
    "The report does not reference this exact compiled Blueprint.", { expected: blueprintSha256, received: input.blueprintSha256 }));
  const criteria = blueprint.acceptanceCriteria.map((criterion) => {
    const matches = input.results.filter((result) => result.criterionId === criterion.id);
    const evidence = matches.length === 1 ? matches[0].evidence : [];
    const status = matches.length === 0 || evidence.length === 0 ? "missing"
      : matches.length !== 1 || evidence.some((item) => item.exitCode !== 0) ? "failed" : "passed";
    if (status !== "passed") findings.push(bridgeFinding("ACCEPTANCE_EVIDENCE_REQUIRED", `criteria.${criterion.id}`,
      "Each criterion requires a unique result with nonempty, successful TestEvidence.", { criterionId: criterion.id, status }));
    return { criterionId: criterion.id, statement: criterion.statement, nodeRefs: criterion.nodeRefs, status, evidence };
  });
  const passed = findings.length === 0;
  const acceptanceReport = { schemaVersion: "blueprint.acceptance-report/1.0", blueprintId: blueprint.blueprintId,
    revision: blueprint.revision, blueprintSha256, passed, verificationMode: BP_REPORT_MODE, executionVerified: false,
    criteria, summary: { total: criteria.length, passed: criteria.filter((item) => item.status === "passed").length,
      failed: criteria.filter((item) => item.status === "failed").length, missing: criteria.filter((item) => item.status === "missing").length },
    findings };
  return { ...compiled, status: passed ? "succeeded" : "blocked", acceptanceReport,
    validation: { valid: passed, guarantee: passed ? "reported-evidence-structurally-verified" : "blocked", findings, summary: blueprintSummary(findings) },
    artifacts: [blueprintJsonArtifact("acceptance-report", "ACCEPTANCE-REPORT.json", acceptanceReport)],
    findingSummary: blueprintSummary(findings) };
}
function blueprintOperationCatalog(result) {
  const known = new Map(result.operationSchemas.map((schema) => [schema.operation, schema]));
  const operationSchemas = Object.entries(BLUEPRINT_OPERATION_INPUTS).map(([operation, inputSchema]) => {
    if (operation === "acceptance-report") return { operation,
      summary: "Recompile the referenced IR and reconcile every criterion with caller-supplied TestEvidence.",
      input: inputSchema, inputSchema };
    const original = known.get(operation);
    if (!original) throw new Error(`Hermes capability is missing: ${operation}`);
    return { ...original, input: inputSchema, inputSchema };
  });
  return { ...result, operationSchemas, capabilities: { ...result.capabilities,
    operations: Object.keys(BLUEPRINT_OPERATION_INPUTS), machineTaskSchema: "swarm.project/1.0",
    acceptanceReportSchema: "blueprint.acceptance-report/1.0", acceptanceEvidenceMode: BP_REPORT_MODE,
    localRunnerOperations: [] } };
}
function blueprintEnvelopeFindings(request) {
  if (!request || typeof request !== "object" || Array.isArray(request)) return [bridgeFinding("BLUEPRINT_REQUEST", "request", "Request must be an object.")];
  const findings = [];
  if (request.schemaVersion !== BP_REQUEST_SCHEMA) findings.push(bridgeFinding("BLUEPRINT_REQUEST_SCHEMA", "schemaVersion", "Unsupported request schema."));
  if (typeof request.requestId !== "string" || !request.requestId.trim()) findings.push(bridgeFinding("BLUEPRINT_REQUEST_ID", "requestId", "requestId must be a nonempty string."));
  if (typeof request.operation !== "string" || !Object.hasOwn(BLUEPRINT_OPERATION_INPUTS, request.operation)) findings.push(bridgeFinding("BLUEPRINT_OPERATION_UNSUPPORTED", "operation", "Unsupported public operation."));
  return findings;
}
export function createBlueprintRuntime(coreRun) {
  return async function runBlueprint(request, runtimeOptions) {
    const envelopeFindings = blueprintEnvelopeFindings(request);
    if (envelopeFindings.length) return blueprintBlocked(
      { requestId: typeof request?.requestId === "string" ? request.requestId : null }, envelopeFindings);
    const inputFindings = blueprintSchemaFindings(request.input, BLUEPRINT_OPERATION_INPUTS[request.operation]);
    if (inputFindings.length) return blueprintBlocked(request, inputFindings);
    if (request.operation === "acceptance-report") {
      const compiled = await coreRun({ ...request, operation: "compile-inline", input: { blueprint: request.input.blueprint } }, runtimeOptions);
      if (compiled.status !== "succeeded" || compiled.validation?.valid !== true) return compiled;
      return reconcileBlueprintAcceptance(request, compiled);
    }
    const result = await coreRun(request, runtimeOptions);
    if (result.status !== "succeeded") return result;
    if (request.operation === "capabilities") return blueprintOperationCatalog(result);
    if (request.operation === "help") {
      const catalog = blueprintOperationCatalog({ ...result, operationSchemas: result.help.operations, capabilities: {} });
      return { ...result, operationSchemas: catalog.operationSchemas, help: { ...result.help, operations: catalog.operationSchemas } };
    }
    if (request.operation === "compile-inline" && result.validation?.valid === true) return addBlueprintMachineArtifact(result);
    return result;
  };
}
