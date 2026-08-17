---
name: calctool
description: 按需生成「万能计算工具」：用户输入一个领域需求（如"我是财务，想要一个经营健康诊断工具"），本技能通过提问明确指标、公式、输入方式与输出形式，生成一个可执行、可验证、可发布的在线计算工具——支持自定义指标、自定义公式逻辑、用户上传内容自动识别（Excel 映射 / 图片 OCR）、报告输出。当用户想"把某套计算逻辑/指标/公式做成在线工具"时使用。 Generate a runnable, verifiable, publishable online calculator from a domain need, with custom metrics, formulas, and upload recognition (Excel mapping / image OCR). Use when the user wants to turn a calculation logic into an online tool. Создаёт работающий, проверяемый онлайн-калькулятор по потребности домена: пользовательские метрики, формулы и распознавание загрузок (Excel / OCR). Используйте, когда нужно превратить расчётную логику в онлайн-инструмент.
---

# calctool

把「业务计算逻辑」编译为「可执行的在线计算工具」的生成器。

## 全链路总流程（老板视角 → 可运行工具）

```
老板（任何 IDE / DSH）："我要搭电商运营计算工具"
  ↓
1. 顾问式对话（intake-round）   —— 智能体主动给方案（基于领域参考包），
   老板逐轮确认指标/公式/口径，直到说"创建"
  ↓
2. 情报蜂群（research）        —— 自动派情报智能体搜索行业标准/抓指定地址，
   产出可溯源参考包（老板说"电商"等关键词时自动触发）
  ↓
3. 蜂群执行（brain-invoke/complete）—— 需求自动拆解为 fields/formulas/rules/
   imports/reports/pages 任务，依赖图驱动并行，独立复核，确定性合并
  ↓
4. 编译工具（compile-tool）    —— 引擎定义 → 可运行工程文件清单
   （App 壳/公式引擎/存储/构建，页面自动生成：录入/指标卡/报告）
  ↓
5. 环境适配（probe-env/adapt-config）—— 自动探测 Node 版本/包管理器/OS/架构，
   Node≥18 全功能、16 兼容(sql.js)、<16 零构建预览；pnpm/yarn/npm 自动适配
  ↓
6. 完成前门禁（final-gate）      —— 审计/测试/运维三智能体协调接管检测，
   全部符合通过（engine-valid / 基准样例全通过 / 环境就绪）才标记完成
  ↓
7. 交付运行                     —— 按适配命令一键搭建（pnpm install → pnpm run dev）
   → 老板得到可交互工具；后续对话继续改指标/公式（热更新）

或直接走「全自动流水线」（auto-pipeline）——老板只需说需求 + 授权一次：
  授权(告知消耗) → 情报蜂群 → 蜂群生成 → 测试审计 → 编译 → 自动启动弹出页面
  → 完成前门禁（审计/测试/运维三智能体协调接管，全部符合通过才标记完成）
  全程无需老板参与，热更新即时生效
```

**关键**：老板一句话 → 对话确认 → 情报 → 蜂群 → 编译 → 环境适配 → **可运行工具**。全程框架不变，需求变更只改配置。

## 何时使用

- 用户描述了一个领域场景（财务、运营、工程、教育、医疗……）并想要一个可交互的在线计算工具
- 用户已有指标、公式、评分或报告逻辑，想固化成工具
- 用户需要"自定义指标 + 自定义公式 + 上传识别"能力

不要用于：纯展示型页面（无计算）、与计算无关的 CRUD 后台。

## 核心原则

1. **确定性计算**：正式数字由版本化确定性引擎（公式 AST + Decimal 运行时）产生；模型/OCR/AI 只产生候选、草稿与解释，绝不直接给出不可追溯的正式结果。
2. **配置化而非代码化**：工具 = 一份可发布的引擎定义（字段目录 + 公式图 + 规则包 + 导入映射 + 视图 + 报告），不是散落的页面代码。
3. **显式除零**：所有除法必须选 `div`（除零报错）或 `safeDivide`（除零回退），不静默吞错。
4. **零虚构**：能力未接入时保持"未接入态"（planned/not_installed/disconnected），不虚构数据、状态或按钮。

## 五步实施流程

### 1. intake —— 收集需求（必须提问，一次一问）
调用运行时 intake 或按下面问题逐条问用户：
- 目标：这个工具帮用户完成什么？什么必须发生、什么绝不允许发生？
- 输入指标：用户会输入哪些字段？（如收入、成本、人数、月份）
- 公式逻辑：哪些指标由公式算出？（如毛利 = 收入 - 成本）
- 输入方式：手工录入 / Excel 上传 / 图片 OCR / 三者都要？
- 输出形式：指标卡、表格、诊断报告、历史记录？
- 约束：单位、精度、语言、离线/在线、禁止项？

### 2. 生成引擎定义（Engine Definition）
```yaml
engineId: <kebab-case-引擎名>
name: <显示名>
category: <领域，如 finance/operations/education>
ownerType: platform-template
status: draft
semanticVersion: 1.0.0
compatibilityProfile: legacy-compatible
decimalPolicy: decimal-string
defaultLocale: zh-CN
```
包含（详见 references/engine-meta-model.md）：
- field-catalog：字段目录（类型：amount/ratio/int/enum/dimension/date）
- formula-graph：公式图（节点 = 字段/公式，边 = 依赖）
- rule-packs：规则包（阈值、评分、分级）
- import-profiles：导入映射（Excel 列 / OCR 字段 → 字段目录）
- report-template：报告模板（指标卡 + 表格 + 诊断结论）

### 3. 编译公式（详见 references/formula-dsl.md）
- 把自然语言/Excel 公式编译为 JSON AST（禁止 eval/new Function）
- 运算符走最小注册表（add/sub/mul/div/safeDivide/percentOf/if/case/sum/avg/lookup…）
- 数值用 Decimal 字符串，单位编译期推断，错误结构化传播
- 发布前跑依赖图检查：引用存在、无环、可见范围

### 4. 生成在线工具（详见 references/declarative-pages.md）
- 表单页：录入字段（按 field-catalog 自动生成）
- 指标卡页：公式结果 StatGrid
- 报告页：结构化输出 + 可导出
- 页面用声明式规格（ApplicationPageSpec），不手写重复模板

### 5. 验收与发布
- validate：确定性校验引擎定义（引用闭合、无环、单位一致、测试通过）
- 上传识别走导入 Profile（Excel 映射 + OCR 草稿确认，自动导入先进草稿）
- **完成前门禁（final-gate）**：每次项目完成之前，审计/测试/运维三智能体协调接管检测——
  - **审计智能体**：引擎定义确定性校验 0 findings、公式仅走受控 AST（禁 eval）、引用闭合
  - **测试智能体**：基准样例（testSuites）全部通过，一个不过都不放行
  - **运维智能体**：环境探测成功、依赖分级适配、安装/启动命令可用、热更新就绪
  - 三智能体全部符合通过（gate passed）才标记完成；任一未通过返回 findings，修复后重新接管检测
- 发布为版本化引擎，任何公式/字段/阈值变化都创建新版本，不原地修改
- 输出：可运行的在线工具 + 引擎定义包 + 验收报告 + 完成前门禁结论

## 多智能体蜂群模式（大脑协同，推荐复杂工具用）

单智能体 `compile-inline` 适合简单工具；复杂工具（多字段 + 多公式 + 规则 + 导入 + 报告）用**蜂群协同**，多智能体并行生成、独立复核、确定性合并——准确率更高、产出更强。

### 大脑模式（brain-handshake）
- `ide`：用当前 IDE 的多智能体（subagent）执行蜂群（默认）
- `hermes_local`：用用户本地安装的 Hermes 执行蜂群

### 蜂群流程（协议 calctool.coordinator.run-plan/1.0）

1. **brain-handshake**：协商大脑模式（ide/hermes_local），返回蜂群能力
2. **brain-invoke**：传需求 → **自动拆解**为蜂群任务（按需派发，需要几个派几个）：
   - `fields` 字段目录（入口，总是有）
   - `formulas` 公式图（有公式才派）· 独立复核
   - `rules` 规则包（有规则才派）· 独立复核
   - `imports` 导入映射（有导入才派）
   - `reports` 报告模板（有报告才派）
   - `pages` 页面规格（总是有）
   依赖图驱动：fields 先 → formulas/imports 并行 → reports → pages；maxParallel 控制并发
3. **brain-invoke 批量派发**：每个就绪 work item 派给一个独立智能体，收集产物
4. **brain-events / brain-status**：流式收集事件、查询蜂群状态（就绪/运行/阻塞）
5. **brain-complete**：提交全部产物 → **确定性合并**为引擎定义 → 校验 → 发布
6. **brain-cancel**：随时取消蜂群

### 准确率与用户控制
- **准确率**：合并后引擎定义必须通过确定性校验（引用闭合/公式链/单位/Decimal/无环），0 findings 才发布
- **用户控制**：每一步产物可查看、修改、重试（budget.maxAttempts）；最终工具可测算、改公式、调阈值
- **编程能力**：蜂群产物是真实可编译的引擎定义（JSON AST + Decimal 运行时），不是伪代码

## 输出产物

```
<engine-id>/
├── manifest.yaml           # 引擎身份与版本
├── field-catalog.json      # 字段目录
├── formula-graph.json      # 公式图（AST）
├── rule-packs.json         # 规则包
├── import-profiles.json    # 导入映射
├── report-template.json    # 报告模板
└── tests/                  # 确定性测试（样例 → 期望结果）
```

## 参考文档

- `references/engine-meta-model.md` —— 引擎元模型（字段/公式/规则/导入/报告）
- `references/formula-dsl.md` —— 公式 DSL 与运行时（AST/Decimal/依赖图/错误值）
- `references/declarative-pages.md` —— 声明式页面规格系统（表单/指标/报告渲染）
- `references/import-ocr.md` —— 导入与 OCR（Excel 映射/图片识别/草稿确认）
- `references/finance-example.md` —— 经营健康诊断完整范例（50 字段 → 10 指标 → 报告）

## 安全规则

- 不执行任意 JavaScript；公式只走受控 AST
- 上传文件先验证类型/大小/指纹，OCR 结果进草稿不覆盖正式数据
- 不虚构后端数据；未接入能力显示真实状态
- 财务/税务输出需明确"经营估算模型，生产使用前由专业人员复核"
