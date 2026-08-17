// calctool 链路编排：整套工具 = 联通节点（非单页孤岛）
// 定义数据如何在节点间流动：输入 → 校验 → 计算 → 存储 → 输出 → 自动化
// 节点可增删改，链路随之更新 —— 后期改工具只动这里，不改页面

import type { FormulaNode } from './engine/evaluate'

export type PipelineNodeKind =
  | 'input'          // 数据输入（表单/导入）
  | 'validate'       // 校验（必填/类型/范围）
  | 'compute'        // 确定性计算（公式引擎）
  | 'store'          // 数据存储（持久化）
  | 'output'         // 输出（指标卡/报告/导出）
  | 'automate'       // 自动化（触发器/定时/通知）

export type PipelineNode = {
  id: string
  kind: PipelineNodeKind
  label: string
  inputs: string[]        // 上游节点 id
  outputs: string[]       // 下游节点 id
  config?: Record<string, unknown>
}

export type Pipeline = {
  engineId: string
  nodes: PipelineNode[]
  // 数据流：input -> validate -> compute -> store -> output (+ automate)
}

/** 默认链路：整套工具的骨架（模块联通，非孤岛） */
export function defaultPipeline(engineId: string): Pipeline {
  return {
    engineId,
    nodes: [
      { id: 'input', kind: 'input', label: '录入/导入', inputs: [], outputs: ['validate'] },
      { id: 'validate', kind: 'validate', label: '数据校验', inputs: ['input'], outputs: ['compute'] },
      { id: 'compute', kind: 'compute', label: '确定性计算', inputs: ['validate'], outputs: ['store', 'output'] },
      { id: 'store', kind: 'store', label: '数据存储', inputs: ['compute'], outputs: ['output'] },
      { id: 'output', kind: 'output', label: '指标卡/报告', inputs: ['compute', 'store'], outputs: [] },
      { id: 'automate', kind: 'automate', label: '自动化（可选）', inputs: ['store'], outputs: ['output'], config: { enabled: false } },
    ],
  }
}

export type FieldDef = {
  key: string
  label: string
  type: 'number' | 'integer' | 'money' | 'percent' | 'text' | 'date' | 'enum'
  unit?: string
  required?: boolean
}

export type FormulaDef = {
  key: string
  label: string
  expression: FormulaNode
}

export type EngineDefinition = {
  engineId: string
  name: string
  semanticVersion: string
  category: string
  decimalPolicy: string
  fields: FieldDef[]
  formulas: FormulaDef[]
  rules: unknown[]
  pipeline: Pipeline
}

/** 在链路中找节点的上下游（改工具时定位影响范围） */
export function nodeNeighbors(pipeline: Pipeline, nodeId: string) {
  const node = pipeline.nodes.find((n) => n.id === nodeId)
  if (!node) return null
  return {
    node,
    upstream: pipeline.nodes.filter((n) => node.inputs.includes(n.id)),
    downstream: pipeline.nodes.filter((n) => n.inputs.includes(nodeId)),
  }
}
