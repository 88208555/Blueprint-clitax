# 引擎元模型（Engine Meta-Model）

一个可发布、可运行、可验收的"计算工具"= 一份**引擎定义**。本文件规定引擎定义的结构与约束。

## 1. 顶级对象

```ts
interface EngineDefinition {
  id: string;                    // kebab-case 稳定机器标识
  name: string;                  // 中文显示名，可改
  semanticVersion: string;       // 语义版本，发布后不可原地修改
  status: 'draft' | 'review' | 'published' | 'retired';
  compatibilityProfile?: string; // 如 legacy-compatible（复现旧口径）
  decimalPolicy: 'decimal-string' | 'source-compatible-float';
  inputSchema: JsonSchema;       // 输入校验
  fields: FieldDefinition[];     // 字段目录
  tables: TableDefinition[];     // 表格定义（如成本结构表）
  dimensions: DimensionDefinition[]; // 维度（公司/部门/周期）
  entities: EntitySchemaDefinition[]; // 实体
  relations: RelationDefinition[];    // 关系
  choiceSources: ChoiceSourceDefinition[];
  interactionRules: InteractionRuleDefinition[];
  formulas: FormulaDefinition[]; // 公式图
  rules: RuleDefinition[];       // 规则包（阈值/评分/分级）
  views: ViewDefinition[];       // 视图
  documents: MarkdownDocumentDefinition[]; // Markdown 说明/报告
  approvalPolicyRefs: string[];
  importProfiles: ImportProfile[]; // 导入映射
  reports: ReportDefinition[];   // 报告模板
  outputs: OutputContract[];     // 输出契约（跨引擎引用用）
  permissions: EnginePermissionPolicy;
  testSuites: EngineTestSuite[]; // 确定性测试
  migrationFrom?: EngineMigration[];
}
```

**铁律**：
- `id` 与字段 `key` 是稳定机器标识；中文标签可以改，ID 不改
- 所有引用用 ID，不用页面标题或表格坐标作主键
- 发布版本不可原地修改；运行记录绑定精确的 `engineVersionId`
- 跨引擎只允许引用对方声明的输出契约

## 2. 字段类型

```text
number, money, percent, integer, text, richText, boolean,
date, dateTime, enum, singleSelect, multiSelect, dimensionRef,
entityRef, file, image, object, repeatGroup, table, reference, derived
```

每个数值字段至少含：
- `key`（稳定 ID）、`label`（中文标签）、`type`
- `required` / `defaultValue`
- `precision` / `rounding`（金额、比例、整数分别定义）
- `unit`（如 CNY、CNY/person、%）
- 枚举字段含 `choiceSourceRef`

## 3. 公式定义

```ts
interface FormulaDefinition {
  key: string;
  label: string;
  type: 'derived' | 'score' | 'aggregate' | 'lookup';
  expression: FormulaAst;        // 编译后的 AST（见 formula-dsl.md）
  source?: string;               // 可读字符串（仅编辑用，保存必须 AST）
  outputUnit?: string;
  description?: string;
}
```

## 4. 规则包（Rule Pack）

```ts
interface RuleDefinition {
  id: string;
  name: string;
  kind: 'threshold' | 'scoring' | 'grading' | 'validation';
  // 阈值：区间 → 级别
  // 评分：指标值 → 0-100 分（可曲线/分段）
  // 分级：总分 → 健康等级（如 优/良/中/差）
  inputs: string[];              // 引用字段/公式 key
  evaluation: RuleAst;           // 条件 AST
}
```

## 5. 导入 Profile

```ts
interface ImportProfile {
  id: string;
  kind: 'excel' | 'ocr' | 'manual';
  sourceFormat: string;          // Excel 列 / OCR 字段布局
  mapping: { source: string; targetField: string; transform?: string }[];
  verification: 'draft' | 'auto'; // 自动导入先进草稿
}
```

## 6. 报告模板

```ts
interface ReportDefinition {
  id: string;
  name: string;
  sections: ReportSection[];
  // 指标卡 / 表格 / 诊断结论 / 历史分位 / 建议
}
```

## 7. 版本与迁移

- `1.x legacy-compatible`：复现原工具结果（保留旧公式、边界、取整）
- `2.x corrected`：修正数据质量问题（通过显式迁移发布，绝不静默改变旧运行）
- 任何公式/字段/阈值/导入映射/报告变化 → 新版本

## 8. 引擎状态机（能力接入）

```text
planned → not_installed → disconnected → configuring
  → pending_verification → connected → disabled | unavailable
```

健康状态 `healthy/degraded/failed/unknown` **只在真实连接与探针后出现**；客户端不能提交健康状态。
