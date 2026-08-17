// calctool runtime v0.1.0 — 按需生成「万能计算工具」的确定性运行时
// 自包含、无外部依赖、纯 HTTP 可执行（capabilities/help/intake/validate/compile-inline）
import { createHash } from "node:crypto";

const REQUEST_SCHEMA = "calctool.skill.request/1.0";
const RESPONSE_SCHEMA = "calctool.skill.response/1.0";
const ERROR_SCHEMA = "calctool.skill.error/1.0";
const ENGINE_SCHEMA = "engine.spec/1";
const COMPILER_NAME = "calctool";
const COMPILER_VERSION = "0.1.0";
const DEFAULT_MAX_RESPONSE_BYTES = 200_000;

const PURE_OPERATIONS = new Set(["capabilities", "help", "intake", "validate", "compile-inline"]);

const INTAKE_QUESTIONS = Object.freeze([
  {
    id: "goal",
    prompt: "Describe what the tool must let users do: which domain, what inputs, what outputs. What must never happen?",
    required: true,
    example: "财务经营健康诊断：输入利润表 50 个字段，输出十大指标评分与健康报告；绝不虚构后端数据。",
  },
  {
    id: "inputs",
    prompt: "List the user-entered fields (name, type, unit). Include any custom indicators the user wants to define.",
    required: true,
    example: "收入(money,CNY)、货品成本(money,CNY)、正式员工数(integer,人)；用户可自定义指标。",
  },
  {
    id: "formulas",
    prompt: "Describe the calculation logic: which derived metrics, formulas, scoring rules, or grading thresholds.",
    required: true,
    example: "运营毛利 = 收入 - 货品成本；健康分 = Σ(指标分×权重)，权重 30%/17%/15%/…；除零回退 0。",
  },
  {
    id: "input-method",
    prompt: "How do users get data in: manual entry, Excel upload, image/PDF OCR, or a combination?",
    required: false,
    example: "Excel 上传 + 手工录入；Excel 原生解析，截图走 OCR 草稿确认。",
  },
  {
    id: "output",
    prompt: "What output forms are needed: metric cards, tables, diagnostic report, history, export?",
    required: false,
    example: "指标卡 + 诊断报告(HTML) + 历史记录。",
  },
  {
    id: "constraints",
    prompt: "State hard constraints: precision/rounding, language, offline/online, storage, forbidden behaviors.",
    required: false,
    example: "金额保留 2 位小数；中文界面；无账号也可用；禁止执行任意 JavaScript。",
  },
]);

const INTAKE_INSTRUCTION = "Ask the user these questions one at a time and wait for each answer. Do not compile the engine until all required questions are answered.";

const SKILL_NAME = "calctool";
const SKILL_DESCRIPTION = "按需生成「万能计算工具」：输入领域需求，通过提问明确指标/公式/输入方式/输出形式，生成可执行、可验证、可发布的引擎定义与在线计算工具。";

const OPERATION_CATALOG = Object.freeze([
  {
    operation: "capabilities",
    summary: "Discover skill capabilities, the operation list, per-operation inputs, and the recommended next step.",
    input: {},
    example: { schemaVersion: REQUEST_SCHEMA, requestId: "demo-1", operation: "capabilities", input: {} },
  },
  {
    operation: "help",
    summary: "Return the usage guide, operation catalog, and request examples.",
    input: {},
    example: { schemaVersion: REQUEST_SCHEMA, requestId: "demo-2", operation: "help", input: {} },
  },
  {
    operation: "intake",
    summary: "Return the questions the IDE must ask the user before generating the engine.",
    input: {},
    example: { schemaVersion: REQUEST_SCHEMA, requestId: "demo-3", operation: "intake", input: {} },
  },
  {
    operation: "validate",
    summary: "Deterministically validate an engine definition without generating artifacts.",
    input: { engine: "An engine definition object conforming to engine.spec/1." },
    example: { schemaVersion: REQUEST_SCHEMA, requestId: "demo-4", operation: "validate", input: { engine: {} } },
  },
  {
    operation: "compile-inline",
    summary: "Validate and compile an engine definition from the collected requirements, returning the generated definition inline.",
    input: { requirements: "Collected intake answers (goal/inputs/formulas/inputMethod/output/constraints)." },
    example: { schemaVersion: REQUEST_SCHEMA, requestId: "demo-5", operation: "compile-inline", input: { requirements: {} } },
  },
]);
const LOCAL_RUNNER_OPERATIONS = new Set([
  "run", "compile", "generate", "verify", "estimate", "impact", "status", "inventory", "purge",
  "brain-handshake", "brain-invoke", "brain-events", "brain-cancel", "brain-complete", "brain-resume", "brain-status",
]);

// ---------- 工具函数 ----------
function text(value) { return String(value ?? ""); }

function okResponse(requestId, payload) {
  return { schemaVersion: RESPONSE_SCHEMA, requestId, status: "succeeded", ...payload };
}

function blockedResponse(requestId, request, findings) {
  return {
    schemaVersion: RESPONSE_SCHEMA,
    requestId,
    status: "blocked",
    brainMode: null,
    requestedBrainMode: request?.requestedBrainMode ?? "ide",
    brainUsed: false,
    revision: null,
    validation: { valid: false, guarantee: "blocked", findings },
  };
}

function finding(severity, ruleId, entityRef, message, evidence = {}) {
  return { severity, ruleId, entityRef, message, evidence };
}

// ---------- 引擎定义校验（engine.spec/1） ----------
function validateEngine(engine) {
  const findings = [];
  if (engine === null || typeof engine !== "object" || Array.isArray(engine)) {
    return [finding("P0", "ENGINE_OBJECT", "engine", "engine must be an object.")];
  }
  if (engine.schemaVersion !== ENGINE_SCHEMA) {
    findings.push(finding("P0", "ENGINE_SCHEMA_VERSION", "engine.schemaVersion", `Expected ${ENGINE_SCHEMA}.`));
  }
  if (!text(engine.engineId)) findings.push(finding("P0", "ENGINE_REQUIRED_FIELD", "engine.engineId", "engineId is required."));
  if (!text(engine.name)) findings.push(finding("P0", "ENGINE_REQUIRED_FIELD", "engine.name", "name is required."));
  if (!text(engine.semanticVersion)) findings.push(finding("P0", "ENGINE_REQUIRED_FIELD", "engine.semanticVersion", "semanticVersion is required."));
  if (!Array.isArray(engine.fields)) {
    findings.push(finding("P0", "ENGINE_REQUIRED_ARRAY", "engine.fields", "fields must be an array."));
  } else {
    const keys = new Set();
    for (const [i, f] of engine.fields.entries()) {
      const ref = `engine.fields[${i}]`;
      if (!text(f?.key)) findings.push(finding("P0", "FIELD_REQUIRED_KEY", ref, "field key is required."));
      else if (keys.has(f.key)) findings.push(finding("P0", "FIELD_DUPLICATE_KEY", ref, `duplicate field key ${f.key}.`));
      else keys.add(f.key);
      if (!f?.type) findings.push(finding("P0", "FIELD_REQUIRED_TYPE", ref, "field type is required."));
      if (f?.unit === undefined && ["number", "money", "percent", "integer"].includes(f?.type)) {
        findings.push(finding("P1", "FIELD_UNIT_MISSING", ref, "numeric field should declare a unit."));
      }
    }
  }
  if (engine.formulas !== undefined) {
    if (!Array.isArray(engine.formulas)) {
      findings.push(finding("P0", "ENGINE_REQUIRED_ARRAY", "engine.formulas", "formulas must be an array."));
    } else {
      const fieldKeys = new Set((engine.fields ?? []).map((f) => f?.key));
      for (const [i, fm] of engine.formulas.entries()) {
        const ref = `engine.formulas[${i}]`;
        if (!text(fm?.key)) findings.push(finding("P0", "FORMULA_REQUIRED_KEY", ref, "formula key is required."));
        if (!fm?.expression) findings.push(finding("P0", "FORMULA_REQUIRED_EXPRESSION", ref, "formula expression (AST or text) is required."));
        const refs = extractRefs(fm?.expression);
        for (const r of refs) {
          if (!fieldKeys.has(r)) findings.push(finding("P1", "FORMULA_REF_MISSING", `${ref}.expression`, `formula references missing field ${r}.`));
        }
      }
    }
  }
  if (!Array.isArray(engine.rules)) {
    findings.push(finding("P0", "ENGINE_REQUIRED_ARRAY", "engine.rules", "rules must be an array."));
  }
  if (!Array.isArray(engine.views)) {
    findings.push(finding("P0", "ENGINE_REQUIRED_ARRAY", "engine.views", "views must be an array."));
  }
  if (!Array.isArray(engine.testSuites)) {
    findings.push(finding("P0", "ENGINE_REQUIRED_ARRAY", "engine.testSuites", "testSuites must be an array."));
  }
  if (!Array.isArray(engine.importProfiles)) {
    findings.push(finding("P1", "ENGINE_RECOMMENDED_ARRAY", "engine.importProfiles", "importProfiles should be an array."));
  }
  return findings;
}

function extractRefs(expression) {
  const refs = [];
  if (!expression || typeof expression !== "object") return refs;
  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    if (typeof node.ref === "string") refs.push(node.ref);
    for (const key of ["args", "then", "else", "cases"]) {
      const v = node[key];
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") walk(v);
    }
  };
  walk(expression);
  return refs;
}

function validateRequest(request) {
  const findings = [];
  if (request === null || typeof request !== "object") {
    return [finding("P0", "REQUEST_OBJECT", "request", "request must be an object.")];
  }
  if (request.schemaVersion !== REQUEST_SCHEMA) {
    findings.push(finding("P0", "REQUEST_SCHEMA", "request.schemaVersion", `Expected ${REQUEST_SCHEMA}.`));
  }
  if (!text(request.requestId)) findings.push(finding("P0", "REQUEST_REQUIRED_FIELD", "request.requestId", "requestId is required."));
  if (!text(request.operation)) findings.push(finding("P0", "REQUEST_REQUIRED_FIELD", "request.operation", "operation is required."));
  return findings;
}

// ---------- 引擎定义生成（compile-inline 核心） ----------
function buildEngine(requirements) {
  const r = requirements ?? {};
  const goal = text(r.goal || "通用计算工具");
  const inputs = Array.isArray(r.inputs) ? r.inputs : [];
  const formulas = Array.isArray(r.formulas) ? r.formulas : [];
  const slug = (text(r.engineId) || goal)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "calc-engine";

  const fields = inputs.map((f, i) => ({
    key: f.key || `field-${i + 1}`,
    label: f.label || f.key || `字段 ${i + 1}`,
    type: f.type || "number",
    unit: f.unit,
    required: Boolean(f.required),
    description: f.description,
  }));

  return {
    schemaVersion: ENGINE_SCHEMA,
    engineId: slug,
    name: r.name || "通用计算工具",
    category: r.category || "general",
    semanticVersion: "1.0.0",
    status: "draft",
    compatibilityProfile: "legacy-compatible",
    decimalPolicy: "decimal-string",
    defaultLocale: "zh-CN",
    inputMethod: r.inputMethod || "manual",
    output: Array.isArray(r.output) ? r.output : ["metric-cards"],
    constraints: text(r.constraints),
    fields,
    formulas,
    rules: [],
    views: [],
    importProfiles: [],
    reports: [],
    testSuites: [],
    acceptance: text(r.acceptance),
  };
}

// ---------- run 入口 ----------
export async function run(request, runtimeOptions = {}) {
  const maxResponseBytes = runtimeOptions.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  const requestFindings = validateRequest(request);
  if (requestFindings.length) {
    const response = blockedResponse(request?.requestId ?? "unknown", request, requestFindings);
    return { ...response, errorSchema: ERROR_SCHEMA };
  }
  const { requestId } = request;
  const operation = request.operation;

  if (operation === "capabilities") {
    return okResponse(requestId, {
      capabilities: {
        pure: true, stateless: true, networkRequired: false, filesystemRequired: false,
        defaultMaxResponseBytes: maxResponseBytes,
        coverageModes: ["standard", "exhaustive"],
        operations: [...PURE_OPERATIONS],
        localRunnerOperations: [...LOCAL_RUNNER_OPERATIONS],
      },
      skill: { name: SKILL_NAME, version: COMPILER_VERSION },
      nextStep: { operation: "intake", instruction: "Ask the user the intake questions, collect answers, then build the engine definition and call compile-inline." },
    });
  }

  if (operation === "help") {
    return okResponse(requestId, {
      help: {
        name: SKILL_NAME,
        version: COMPILER_VERSION,
        description: SKILL_DESCRIPTION,
        usage: "POST the request envelope with schemaVersion, requestId, operation, and input. Start with capabilities, ask the user for requirements through intake, then validate or compile-inline the engine definition.",
        operations: OPERATION_CATALOG,
      },
      nextStep: { operation: "intake", instruction: "Ask the user the intake questions one at a time." },
    });
  }

  if (operation === "intake") {
    return okResponse(requestId, {
      questions: INTAKE_QUESTIONS,
      nextStep: { operation: "compile-inline", instruction: "Turn the user's answers into an engine definition, call compile-inline with input.requirements, and present the generated definition after a clean validation." },
    });
  }

  if (operation === "validate") {
    const engine = request.input?.engine;
    const findings = validateEngine(engine);
    if (findings.length) {
      return blockedResponse(requestId, request, findings);
    }
    return okResponse(requestId, {
      validation: { valid: true, guarantee: "engine-definition-green", findings: [] },
      nextStep: { operation: "compile-inline", instruction: "Engine definition is valid; call compile-inline to emit the final package." },
    });
  }

  if (operation === "compile-inline") {
    const requirements = request.input?.requirements ?? {};
    const engine = buildEngine(requirements);
    const findings = validateEngine(engine);
    if (findings.length) {
      return blockedResponse(requestId, request, findings);
    }
    const digest = createHash("sha256").update(JSON.stringify(engine)).digest("hex");
    return okResponse(requestId, {
      revision: 1,
      validation: { valid: true, guarantee: "engine-definition-green", findings: [] },
      artifacts: [{ path: `${engine.engineId}/manifest.yaml`, kind: "engine-manifest", engineId: engine.engineId, digest }],
      engine,
      nextStep: { operation: "validate", instruction: "Review the generated engine definition; publish it as a versioned engine and build the online tool pages." },
    });
  }

  return {
    schemaVersion: RESPONSE_SCHEMA,
    requestId,
    status: "failed",
    errorSchema: ERROR_SCHEMA,
    error: { code: "UNSUPPORTED_OPERATION", message: `Unsupported operation: ${operation}` },
  };
}
