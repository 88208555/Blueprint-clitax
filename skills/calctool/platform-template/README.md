# calctool 平台模板

由 calctool 生成的**可运行计算工具**工程模板（配置驱动、框架不变）。

## 一键运行

```bash
npm install        # 或 pnpm install / yarn install（环境自动适配）
npm run dev        # 启动开发服务器 http://localhost:5173
```

## 结构

```
├── src/
│   ├── main.tsx                    # 入口（Ant Design X ConfigProvider）
│   ├── App.tsx                     # 应用壳（录入/指标卡/链路/报告/授权 五页）
│   ├── engine-definition.json      # ★ 引擎定义 + 链路（改这里 = 改工具，框架不动）
│   ├── engine/
│   │   ├── evaluate.ts             # JSON AST + decimal.js 确定性求值
│   │   └── (recompute.ts 依赖图增量重算，按需扩展)
│   ├── pipeline.ts                 # ★ 链路编排（联通节点，非单页孤岛）
│   ├── authz.ts                    # ★ 授权管理（首次使用同意 + 逐能力授权，一次授权持久化）
│   └── store.ts                    # 存储层（localStorage，可换 sqlite）
├── vite.config.ts
└── package.json
```

## 整套工具（联通节点，非单页孤岛）

工具由**联通节点**组成，数据流在节点间流动：

```
录入/导入 → 数据校验 → 确定性计算 → 数据存储 → 指标卡/报告
                                    ↘ 自动化（可选）
```

- 改动指标/公式：只改 `engine-definition.json`，链路自动感知
- 新增能力：在 `pipeline.ts` 加节点（如导入、导出、告警），页面无需改
- 页面「链路」Tab 可视化每个节点及其上下游，改工具时定位影响范围

## 授权与消耗提示

1. **首次使用总提示**：打开工具时弹窗告知"可能调用其他技能辅助、可能增加消耗"，同意后持久化不再提示（可按工具分别记录）
2. **逐能力授权**：实际调用外部能力（Blueprint/搜索/模型/存储/自动化）前询问，一次授权永久记住
3. **授权管理页**：随时查看已授权能力、撤销授权


## 改指标/公式（需求变更，框架不变）

编辑 `src/engine-definition.json`：

```json
{
  "fields": [{ "key": "visitors", "label": "访客数", "type": "integer", "unit": "人" }],
  "formulas": [
    { "key": "conversionRate", "label": "转化率",
      "expression": { "op": "safeDivide", "args": [{ "ref": "orders" }, { "ref": "visitors" }] } }
  ]
}
```

保存即热更新——**不用改任何代码**。

## 公式运算符（详见 formula-dsl.md）

`add / sub / mul / div（除零报错）/ safeDivide（除零回退）/ percentOf / round / if / ref / lit`

## 环境适配

- Node ≥18：全功能（可换 better-sqlite3 持久化）
- Node 16：兼容（sql.js WASM）
- Node <16：建议只用 L0 配置预览
- 包管理器：npm/pnpm/yarn 命令自动适配
