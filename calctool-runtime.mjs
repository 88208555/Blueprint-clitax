// calctool runtime v0.2.0 — 按需生成「万能计算工具」的确定性运行时
// 自包含、无外部依赖、纯 HTTP + 多智能体蜂群协同
// 纯操作: capabilities/help/intake/validate/compile-inline
// 大脑操作: brain-handshake/brain-invoke/brain-events/brain-complete/brain-status/brain-cancel
// 协调协议: calctool.coordinator.run-plan/1.0
import { createHash } from "node:crypto";

const REQUEST_SCHEMA = "calctool.skill.request/1.0";
const RESPONSE_SCHEMA = "calctool.skill.response/1.0";
const ERROR_SCHEMA = "calctool.skill.error/1.0";
const ENGINE_SCHEMA = "engine.spec/1";
const COORDINATOR_SCHEMA = "calctool.coordinator.run-plan/1.0";
const COMPILER_NAME = "calctool";
const COMPILER_VERSION = "0.2.0";
const DEFAULT_MAX_RESPONSE_BYTES = 200_000;

const PURE_OPERATIONS = new Set(["capabilities", "help", "intake", "validate", "compile-inline"]);

// 蜂群任务分区类型（calctool 专属）
const CALCTOOL_PARTITION_KINDS = new Set([
  "field", "formula", "rule", "import", "report", "page", "contract", "acceptance", "custom",
]);
// 复核模式（与 blueprint 对齐）
const CALCTOOL_REVIEW_MODES = new Set(["none", "required", "independent"]);

const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;

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
      const formulaKeys = new Set((engine.formulas ?? []).map((f) => f?.key));
      for (const [i, fm] of engine.formulas.entries()) {
        const ref = `engine.formulas[${i}]`;
        if (!text(fm?.key)) findings.push(finding("P0", "FORMULA_REQUIRED_KEY", ref, "formula key is required."));
        if (!fm?.expression) findings.push(finding("P0", "FORMULA_REQUIRED_EXPRESSION", ref, "formula expression (AST or text) is required."));
        const refs = extractRefs(fm?.expression);
        for (const r of refs) {
          // 引用可以指向字段（field-catalog）或公式输出（formula key），二者皆合法
          if (!fieldKeys.has(r) && !formulaKeys.has(r)) {
            findings.push(finding("P1", "FORMULA_REF_MISSING", `${ref}.expression`, `formula references missing field or formula ${r}.`));
          }
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

// ---------- 蜂群协调（calctool.coordinator.run-plan/1.0） ----------
function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validId(value) {
  return typeof value === "string" && ID_PATTERN.test(value);
}

function positiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

/**
 * 需求 → 蜂群 run-plan 自动拆解。
 * 根据需求内容自动决定派发哪些 work item（需要几个派几个）：
 *  - 总是有: fields（字段目录，入口）
 *  - 有公式 → formula work item（依赖 fields）
 *  - 有规则/评分/阈值 → rule（依赖 formula）
 *  - 有导入需求 → import（依赖 fields）
 *  - 有报告/输出 → report（依赖 formula）
 *  - 有页面/交互 → page（依赖 fields+formula+report）
 * 每类 work item 配置 role、partition、reviewPolicy（关键产物独立复核）。
 */
function decomposeRequirementsToRunPlan(requirements) {
  const r = requirements ?? {};
  const goal = text(r.goal || "通用计算工具");
  const hasFormulas = Array.isArray(r.formulas) && r.formulas.length > 0;
  const hasRules = Array.isArray(r.rules) && r.rules.length > 0;
  const hasImport = /excel|ocr|upload|导入|上传|识别/i.test(`${r.inputMethod ?? ""} ${r.requirements ?? ""}`);
  const hasReport = Array.isArray(r.output) && (r.output.includes("report") || r.output.includes("history") || /报告|导出/.test(String(r.output)));
  const hasPage = true; // 在线工具总是需要页面

  const tasks = [];
  const task = (workItemId, role, objective, partitionKind, partitionRefs, dependsOn, reviewMode) => ({
    workItemId, role, objective, partition: { kind: partitionKind, refs: partitionRefs },
    scopeRefs: [goal], dependsOn, inputRefs: [],
    acceptanceGateIds: [`gate-${workItemId}`],
    reviewPolicy: { mode: reviewMode, ...(reviewMode === "independent" ? { reviewerRole: `${role}-reviewer` } : {}) },
    budget: { maxAttempts: 2, timeoutSeconds: 120, maxOutputBytes: 16384, leaseSeconds: 60 },
  });

  tasks.push(task("fields", "fields-architect", "定义字段目录：类型/单位/必填/校验", "field", ["inputs"], [], "required"));
  if (hasFormulas) {
    tasks.push(task("formulas", "formula-architect", "编译公式图：JSON AST/单位/依赖", "formula", ["formulas"], ["fields"], "independent"));
  }
  if (hasRules) {
    tasks.push(task("rules", "rule-architect", "定义规则包：阈值/评分/分级", "rule", ["rules"], ["formulas"], "independent"));
  }
  if (hasImport) {
    tasks.push(task("imports", "import-architect", "定义导入映射：Excel/OCR → 字段", "import", ["inputMethod"], ["fields"], "required"));
  }
  if (hasReport) {
    tasks.push(task("reports", "report-architect", "定义报告模板：指标卡/表格/结论", "report", ["output"], ["formulas"], "required"));
  }
  tasks.push(task("pages", "page-builder", "生成声明式页面规格：表单/指标卡/报告页", "page", ["output"], hasReport ? ["reports"] : ["fields", "formulas"], "required"));

  const runId = `run-${createHash("sha256").update(JSON.stringify(requirements)).digest("hex").slice(0, 16)}`;
  const plan = {
    schemaVersion: COORDINATOR_SCHEMA,
    runId,
    engineId: text(r.engineId) || goal.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "calc-engine",
    baseRevision: 0,
    inputHash: `sha256:${createHash("sha256").update(JSON.stringify(requirements)).digest("hex")}`,
    limits: {
      maxParallel: Math.min(4, Math.max(1, tasks.length)),
      maxWorkItems: tasks.length,
      maxEvents: 256,
      maxReadyPageSize: 16,
    },
    tasks,
  };
  return plan;
}

/** 校验 run-plan（确定性） */
function validateRunPlan(plan) {
  const errors = [];
  if (!isObject(plan)) return ["plan must be an object"];
  if (plan.schemaVersion !== COORDINATOR_SCHEMA) errors.push(`schemaVersion must be ${COORDINATOR_SCHEMA}`);
  for (const key of ["runId", "engineId"]) {
    if (!validId(plan[key])) errors.push(`${key} must be a stable ID of at most 128 characters`);
  }
  if (!Number.isInteger(plan.baseRevision) || plan.baseRevision < 0) errors.push("baseRevision must be a non-negative integer");
  if (!HASH_PATTERN.test(plan.inputHash ?? "")) errors.push("inputHash must be sha256:<64 lowercase hex>");
  if (!isObject(plan.limits)) errors.push("limits must be an object");
  else {
    for (const key of ["maxParallel", "maxWorkItems", "maxEvents", "maxReadyPageSize"]) {
      if (!positiveInteger(plan.limits[key])) errors.push(`limits.${key} must be a positive integer`);
    }
    if (positiveInteger(plan.limits.maxParallel) && positiveInteger(plan.limits.maxWorkItems)
      && plan.limits.maxParallel > plan.limits.maxWorkItems) {
      errors.push("limits.maxParallel cannot exceed limits.maxWorkItems");
    }
  }
  if (!Array.isArray(plan.tasks) || plan.tasks.length === 0) {
    errors.push("tasks must be a non-empty array");
    return errors;
  }
  const taskIds = new Set();
  for (const [index, task] of plan.tasks.entries()) {
    const prefix = `tasks[${index}]`;
    if (!isObject(task)) { errors.push(`${prefix} must be an object`); continue; }
    if (!validId(task.workItemId) || !validId(task.role)) {
      errors.push(`${prefix}.workItemId and .role must be stable IDs`);
    }
    if (validId(task.workItemId)) taskIds.add(task.workItemId);
    if (!(typeof task.objective === "string" && task.objective.length > 0)) errors.push(`${prefix}.objective is required`);
    if (!isObject(task.partition) || !CALCTOOL_PARTITION_KINDS.has(task.partition?.kind)
      || !Array.isArray(task.partition?.refs) || task.partition.refs.length === 0) {
      errors.push(`${prefix}.partition must contain a supported kind and non-empty refs`);
    }
    if (!Array.isArray(task.dependsOn)) errors.push(`${prefix}.dependsOn must be an array`);
    if (!isObject(task.reviewPolicy) || !CALCTOOL_REVIEW_MODES.has(task.reviewPolicy?.mode)) {
      errors.push(`${prefix}.reviewPolicy.mode is invalid`);
    } else if (task.reviewPolicy.mode === "independent" && !validId(task.reviewPolicy.reviewerRole)) {
      errors.push(`${prefix}.reviewPolicy.reviewerRole is required for independent review`);
    }
  }
  // 依赖引用存在
  for (const task of plan.tasks) {
    for (const dep of task.dependsOn ?? []) {
      if (!taskIds.has(dep)) errors.push(`task ${task.workItemId} depends on unknown ${dep}`);
    }
  }
  return errors;
}

/** 就绪队列：找出所有依赖已满足的任务（蜂群并行调度用） */
function readyTasks(plan, completed) {
  return plan.tasks.filter((task) => {
    if (completed.has(task.workItemId)) return false;
    return (task.dependsOn ?? []).every((dep) => completed.has(dep));
  });
}

/** 蜂群产物 → 引擎定义 确定性合并 */
function mergeSwarmArtifacts(plan, artifacts) {
  const r = artifacts ?? {};
  const fields = Array.isArray(r.fields) ? r.fields : [];
  const formulas = Array.isArray(r.formulas) ? r.formulas : [];
  const rules = Array.isArray(r.rules) ? r.rules : [];
  const importProfiles = Array.isArray(r.importProfiles) ? r.importProfiles : [];
  const reports = Array.isArray(r.reports) ? r.reports : [];
  const views = Array.isArray(r.views) ? r.views : [];
  const engine = {
    schemaVersion: ENGINE_SCHEMA,
    engineId: plan.engineId,
    name: r.name || plan.engineId,
    category: r.category || "general",
    semanticVersion: "1.0.0",
    status: "draft",
    compatibilityProfile: "legacy-compatible",
    decimalPolicy: "decimal-string",
    defaultLocale: "zh-CN",
    inputMethod: r.inputMethod || "manual",
    output: Array.isArray(r.output) ? r.output : ["metric-cards"],
    constraints: text(r.constraints),
    fields, formulas, rules, views, importProfiles, reports,
    testSuites: Array.isArray(r.testSuites) ? r.testSuites : [],
    runPlanRef: plan.runId,
    swarmProduced: true,
  };
  return engine;
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
        brainModes: ["ide", "hermes_local"],
        coordinatorSchema: COORDINATOR_SCHEMA,
      },
      skill: { name: SKILL_NAME, version: COMPILER_VERSION },
      nextStep: { operation: "intake", instruction: "Ask the user the intake questions, collect answers, then build the engine definition and call compile-inline; for multi-agent swarm generation call brain-handshake first." },
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
      nextStep: { operation: "brain-handshake", instruction: "For multi-agent swarm generation, call brain-handshake to negotiate the brain mode, then brain-invoke to dispatch swarm tasks." },
    });
  }

  // ---------- 大脑操作（多智能体蜂群协同） ----------
  if (operation === "brain-handshake") {
    const input = request.input ?? {};
    const brainMode = input.brainMode ?? "ide"; // ide | hermes_local
    const supportedModes = ["ide", "hermes_local"];
    if (!supportedModes.includes(brainMode)) {
      return blockedResponse(requestId, request, [finding("P0", "BRAIN_MODE_UNSUPPORTED", "input.brainMode", `Unsupported brain mode ${brainMode}; supported: ${supportedModes.join(", ")}`)]);
    }
    const swarmEnabled = input.swarmEnabled !== false;
    return okResponse(requestId, {
      brainMode,
      requestedBrainMode: brainMode,
      brainUsed: true,
      capabilities: {
        swarm: swarmEnabled,
        coordinatorSchema: COORDINATOR_SCHEMA,
        partitionKinds: [...CALCTOOL_PARTITION_KINDS],
        reviewModes: [...CALCTOOL_REVIEW_MODES],
        maxParallelDefault: 4,
      },
      nextStep: { operation: "brain-invoke", instruction: "Send the requirements with operation brain-invoke to decompose and dispatch the swarm." },
    });
  }

  if (operation === "brain-invoke") {
    const input = request.input ?? {};
    const requirements = input.requirements ?? {};
    const plan = decomposeRequirementsToRunPlan(requirements);
    const errors = validateRunPlan(plan);
    if (errors.length) {
      return blockedResponse(requestId, request, errors.map((message, i) => finding("P0", "RUN_PLAN_INVALID", `runPlan[${i}]`, message)));
    }
    const ready = readyTasks(plan, new Set());
    return okResponse(requestId, {
      runPlan: plan,
      dispatch: {
        totalWorkItems: plan.tasks.length,
        maxParallel: plan.limits.maxParallel,
        readyNow: ready.map((t) => ({ workItemId: t.workItemId, role: t.role, objective: t.objective })),
        instruction: "Dispatch each ready work item to an independent agent (subagent/Hermes). Collect per-item artifacts; when all complete, call brain-complete with the merged artifacts.",
      },
      nextStep: { operation: "brain-complete", instruction: "After all work items are dispatched and completed, submit the collected artifacts for deterministic merge." },
    });
  }

  if (operation === "brain-events") {
    const input = request.input ?? {};
    const events = Array.isArray(input.events) ? input.events : [];
    return okResponse(requestId, {
      events,
      nextStep: { operation: "brain-status", instruction: "Query swarm status or continue dispatching ready work items." },
    });
  }

  if (operation === "brain-status") {
    const input = request.input ?? {};
    const plan = input.runPlan;
    const completed = new Set(Array.isArray(input.completedWorkItemIds) ? input.completedWorkItemIds : []);
    const errors = plan ? validateRunPlan(plan) : [];
    if (errors.length) {
      return blockedResponse(requestId, request, errors.map((message, i) => finding("P0", "RUN_PLAN_INVALID", `runPlan[${i}]`, message)));
    }
    const ready = plan ? readyTasks(plan, completed) : [];
    const allDone = plan ? plan.tasks.every((t) => completed.has(t.workItemId)) : false;
    return okResponse(requestId, {
      status: allDone ? "complete" : "running",
      completedWorkItems: [...completed],
      readyNow: ready.map((t) => t.workItemId),
      remaining: plan ? plan.tasks.filter((t) => !completed.has(t.workItemId)).length : 0,
      nextStep: allDone
        ? { operation: "brain-complete", instruction: "All work items complete; merge the artifacts." }
        : { operation: "brain-invoke", instruction: "Dispatch the next ready batch." },
    });
  }

  if (operation === "brain-complete") {
    const input = request.input ?? {};
    const plan = input.runPlan;
    const artifacts = input.artifacts ?? {};
    const errors = plan ? validateRunPlan(plan) : ["runPlan is required"];
    if (errors.length) {
      return blockedResponse(requestId, request, errors.map((message, i) => finding("P0", "RUN_PLAN_INVALID", `runPlan[${i}]`, message)));
    }
    const engine = mergeSwarmArtifacts(plan, artifacts);
    const findings = validateEngine(engine);
    if (findings.length) {
      return blockedResponse(requestId, request, findings);
    }
    const digest = createHash("sha256").update(JSON.stringify(engine)).digest("hex");
    return okResponse(requestId, {
      status: "complete",
      revision: 1,
      swarmProduced: true,
      runPlanRef: plan.runId,
      validation: { valid: true, guarantee: "engine-definition-green", findings: [] },
      artifacts: [{ path: `${engine.engineId}/manifest.yaml`, kind: "engine-manifest", engineId: engine.engineId, digest }],
      engine,
      nextStep: { operation: "validate", instruction: "Swarm-generated engine definition is valid; publish it as a versioned engine." },
    });
  }

  if (operation === "brain-cancel") {
    const input = request.input ?? {};
    return okResponse(requestId, {
      status: "cancelled",
      cancelledWorkItemIds: Array.isArray(input.workItemIds) ? input.workItemIds : [],
      reason: input.reason ?? "cancelled by caller",
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
