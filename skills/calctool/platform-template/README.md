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
│   ├── App.tsx                     # 应用壳（录入/指标卡/报告 三页）
│   ├── engine-definition.json      # ★ 引擎定义（改这里 = 改工具，框架不动）
│   ├── engine/
│   │   ├── evaluate.ts             # JSON AST + decimal.js 确定性求值
│   │   └── (recompute.ts 依赖图增量重算，按需扩展)
│   └── store.ts                    # 存储层（localStorage，可换 sqlite）
├── vite.config.ts
└── package.json
```

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
