# 声明式页面规格系统

把"信息型页面"从代码降级为**数据声明**，用通用渲染器渲染几十个页面，避免复制粘贴页面结构。这是生成工具页面的核心机制。

## 1. 规格 Schema

```ts
interface ApplicationPageSpec {
  title: string;
  description?: string;
  tabs?: TabSpec[];
  actions?: ActionSpec[];       // 页头操作（default|primary|danger）
  sections?: SectionSpec[];     // 内容分区
}

interface SectionSpec {
  layout: 'rows' | 'grid' | 'table' | 'steps';
  rows?: RowSpec[];             // 标签/值/说明/状态/行内操作
  metrics?: MetricSpec[];       // 指标卡
  columns?: ColumnSpec[];
  data?: (string | number)[][]; // 表格数据
  empty?: EmptyStateSpec;       // 空状态（标题/说明/操作）
}
```

## 2. 注册与路由匹配

- 规格文件按域拆分（core/settings/management/finance/studio/supplementary），每份是 `Record<string, ApplicationPageSpec>` + 路由映射
- 支持参数化路由：`/tools/:toolId/runs/:runId`、`/automations/:automationId/edit`
- 匹配算法：按路径段数**从长到短**排序 → 逐段精确匹配（`:` 前缀为参数位）→ 命中后提取 params → `encodeURIComponent` 回填规格内 `href`

## 3. 渲染器

`ApplicationPageSpec → 通用构建块组件树`：

```
PageShell（内容 768px）
  → PageHeader（标题/说明/操作）
  → SectionCard × N（分区）
    → 按 layout 分发：
      rows   → SettingRow 行
      grid   → 网格卡
      table  → 表格
      steps  → 步骤条
      empty  → EmptyState
```

- 无 `href` 的操作自动 `disabled`——保证"未接入"按钮不产生假交互
- 所有构建块来自共享组件（PageShell/PageHeader/SectionCard/SettingRow/EmptyState/StatGrid/PageList/Toolbar），页面只提供数据
- 单文件 ≤ 1000 行（审计脚本强制），接近上限必须拆分

## 4. 生成工具时的页面映射

| 工具模块 | 页面规格 |
|---|---|
| 录入表单 | 字段目录 → 自动生成 rows/grid 表单（含必填/类型/单位） |
| 指标卡 | 公式结果 → metrics 数组（StatGrid） |
| 专题工具 | 每个专题 → 独立 SectionCard（增值税/盈亏平衡/定价/利润率优化） |
| 历史记录 | table 布局 + 分页 |
| 诊断报告 | 指标卡 + 表格 + 诊断结论 + 建议 |
| 空状态 | 无数据时 EmptyState（不虚构装饰图标） |

## 5. 硬约束（从工具项目继承）

- 正文内容容器统一 768px（与 Composer 同宽），窄屏等比收窄，禁止按页面类型自由设宽
- 禁内联 style、禁硬编码颜色、禁阴影
- 图标统一 Lucide、14px、描边 2
- 空页面不显示装饰图标，不虚构状态/数据/提示/按钮
- 能拆成组件的内容禁止堆积在页面文件中
