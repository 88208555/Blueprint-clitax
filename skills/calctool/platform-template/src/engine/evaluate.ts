// calctool 公式引擎：JSON AST + decimal.js 确定性求值
// 公式 DSL 规范见 references/formula-dsl.md
import Decimal from 'decimal.js'

export type FormulaNode =
  | { ref: string }
  | { lit: string | number }
  | { op: string; args: FormulaNode[] }

export type CalcError =
  | { code: 'DIV_ZERO'; nodeId: string }
  | { code: 'MISSING_INPUT'; fieldId: string }
  | { code: 'NON_FINITE'; nodeId: string }

export type EngineValues = Record<string, string | number | null>

/** 安全除法：除数为 0 用 fallback（默认 0），与 div 报错区分 */
function safeDiv(a: Decimal, b: Decimal, fallback = '0'): Decimal {
  if (b.isZero()) return new Decimal(fallback)
  return a.div(b)
}

/** 求值一个公式 AST 节点（纯函数，无副作用）
 * 节点形态：{ ref: 'field' } 引用 / { lit: 1 } 字面量 / { op, args } 运算
 */
export function evaluate(node: FormulaNode, values: EngineValues): Decimal {
  // 引用节点（无 op，只有 ref）
  if ('ref' in node && node.ref !== undefined) {
    const raw = values[node.ref]
    if (raw === null || raw === undefined || raw === '') {
      throw { code: 'MISSING_INPUT', fieldId: node.ref } as CalcError
    }
    return new Decimal(String(raw))
  }
  // 字面量节点（无 op，只有 lit）
  if ('lit' in node && node.lit !== undefined) {
    return new Decimal(String(node.lit ?? 0))
  }
  switch (node.op) {
    case 'add':
      return node.args.reduce((acc, arg) => acc.plus(evaluate(arg, values)), new Decimal(0))
    case 'sub': {
      const [a, b] = node.args
      return evaluate(a, values).minus(evaluate(b, values))
    }
    case 'mul':
      return node.args.reduce((acc, arg) => acc.times(evaluate(arg, values)), new Decimal(1))
    case 'div': {
      const [a, b] = node.args
      const divisor = evaluate(b, values)
      if (divisor.isZero()) throw { code: 'DIV_ZERO', nodeId: 'div' } as CalcError
      return evaluate(a, values).div(divisor)
    }
    case 'safeDivide': {
      const [a, b] = node.args
      return safeDiv(evaluate(a, values), evaluate(b, values))
    }
    case 'percentOf': {
      const [a, b] = node.args
      return evaluate(a, values).div(evaluate(b, values)).times(100)
    }
    case 'round': {
      const [a] = node.args
      return evaluate(a, values).toDecimalPlaces(2)
    }
    case 'if': {
      const [cond, thenNode, elseNode] = node.args
      const v = evaluate(cond, values)
      return v.isZero() ? evaluate(elseNode, values) : evaluate(thenNode, values)
    }
    default:
      throw new Error(`Unsupported operator: ${node.op}`)
  }
}

/** 从 AST 提取引用的字段 key（依赖图构建用） */
export function extractRefs(node: FormulaNode | undefined): string[] {
  if (!node) return []
  if ('ref' in node && node.ref !== undefined) return [node.ref]
  if ('lit' in node && node.lit !== undefined) return []
  return (node.args ?? []).flatMap(extractRefs)
}

/** 按公式定义计算全部结果（含跨公式引用，安全除零） */
export function evaluateEngine(
  formulas: Array<{ key: string; expression: FormulaNode }>,
  inputs: EngineValues,
): Record<string, string> {
  const values: EngineValues = { ...inputs }
  const results: Record<string, string> = {}
  const visited = new Set<string>()
  const stack: string[] = []

  const compute = (key: string) => {
    if (visited.has(key)) return
    if (stack.includes(key)) throw new Error(`Cycle detected: ${[...stack, key].join(' → ')}`)
    const formula = formulas.find((f) => f.key === key)
    if (!formula) return
    stack.push(key)
    const refs = extractRefs(formula.expression)
    for (const ref of refs) {
      if (formulas.some((f) => f.key === ref)) compute(ref) // 跨公式引用先算
    }
    const result = evaluate(formula.expression, values)
    const str = result.toFixed(4).replace(/\.?0+$/, '')
    values[key] = str
    results[key] = str
    stack.pop()
    visited.add(key)
  }

  for (const f of formulas) compute(f.key)
  return results
}
