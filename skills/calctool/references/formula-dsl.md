# 公式 DSL 与确定性运行时

## 1. 禁止任意 JavaScript

禁止存储并执行 `eval(formula)` / `new Function(formula)`。原因：任意代码执行、无法静态分析、无法稳定迁移、难以做单位检查和依赖审计。

自然语言或可视化公式统一编译为 **JSON AST**：

```json
{
  "op": "mul",
  "args": [
    { "ref": "gmv" },
    { "op": "sub", "args": [{ "lit": "1" }, { "ref": "preRefundRate" }] },
    { "op": "sub", "args": [{ "lit": "1" }, { "ref": "postRefundRate" }] }
  ]
}
```

可提供接近 Excel 的编辑语法（字符串只用于编辑；保存前必须解析为 AST，执行时不重新解释任意脚本）。

## 2. 最小运算符注册表

| 类别 | 运算符 |
|---|---|
| 算术 | `add sub mul div mod pow abs neg min max` |
| 比例 | `percentOf percentageChange basisPoints` |
| 比较 | `eq ne gt gte lt lte between` |
| 逻辑 | `and or not if case` |
| 空值 | `coalesce isNull isFinite safeDivide` |
| 取整 | `round floor ceil truncate` |
| 聚合 | `sum avg minOf maxOf count countIf sumIf` |
| 表格 | `rowRef column map filter groupBy lookup` |
| 文本 | `concat trim upper lower match` |
| 日期 | `dateAdd dateDiff startOf endOf` |
| 维度 | `selectedIds containsAny containsAll isDescendantOf memberAttribute` |
| 财务（二阶段） | `npv irr pmt rate` |
| 统计（二阶段） | `percentile rank stdev` |
| 引用 | `ref tableRef engineOutput configRef` |

**显式除法**（必选其一）：
- `div`：除数为 0 产生错误值（`DIV_ZERO`）
- `safeDivide`：除数为 0 使用指定回退值（如兼容旧引擎"除零返回 0"）

## 3. Decimal、单位与错误值

生产运行时不依赖 JS `number` 作为财务真值：

- 内部数值用 `decimal.js` 或等价 Decimal 实现
- JSON 中以**字符串**持久化 Decimal
- 公式定义精度和取整边界
- 单位在**编译期推断**：
  - `金额 + 比例` → 类型错误 `UNIT_MISMATCH`
  - `金额 ÷ 人数` → 推导为 `CNY/person`
- 错误以结构化值传播，不伪装成 0：

```ts
type CalcError =
  | { code: 'DIV_ZERO'; nodeId: string }
  | { code: 'MISSING_INPUT'; fieldId: string }
  | { code: 'UNIT_MISMATCH'; expected: string; actual: string }
  | { code: 'NON_FINITE'; nodeId: string }
  | { code: 'CYCLE'; path: string[] };
```

## 4. 依赖图（发布前必查）

1. 从 AST 提取字段和公式依赖
2. 验证引用存在且符合可见范围
3. 建立有向图
4. 检测循环（`CYCLE` 错误）
5. 标记跨模块/跨引擎引用（必须绑定版本和输出契约）

## 5. 编译流程

```
自然语言/Excel 公式
  → 解析（JSON AST，含 op/args/ref/lit）
  → 类型检查（单位推断、字段存在、操作数类型）
  → 依赖提取（字段/公式/表格/维度引用）
  → 循环检测
  → 编译为可执行运行时
  → 测试（样例 → 期望结果，Decimal 精确比对）
  → 发布（版本化，不可变）
```

## 6. 执行语义

- 增量重算：字段变化只重算下游依赖
- 执行轨迹：记录每个节点的输入/输出/错误，可审计
- 快照：运行记录绑定引擎版本 + 输入 + 结果，可复现
- 错误值传播：上游错误 → 下游保持错误（不吞掉）
