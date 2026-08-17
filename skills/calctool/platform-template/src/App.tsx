// calctool 生成的可运行工具：Ant Design X 应用壳
// 页面由 engine-definition.json 驱动（配置即产品，框架不变）
import { useState } from 'react'
import { Button, Card, Form, Input, InputNumber, message, Segmented, Space, Statistic, Table, Typography } from 'antd'
import { evaluateEngine, type FormulaNode } from './engine/evaluate'
import { ToolStore } from './store'
import engine from './engine-definition.json'

const { Title, Paragraph, Text } = Typography

type EngineDefinition = {
  engineId: string
  name: string
  fields: Array<{ key: string; label: string; type: string; unit?: string; required?: boolean }>
  formulas: Array<{ key: string; label: string; expression: FormulaNode }>
}

const def = engine as EngineDefinition
const store = new ToolStore(def.engineId)

export default function App() {
  const [form] = Form.useForm()
  const [results, setResults] = useState<Record<string, string>>({})
  const [page, setPage] = useState<string>('input')
  const [history, setHistory] = useState(store.list())

  const run = (values: Record<string, unknown>) => {
    try {
      const inputs = Object.fromEntries(
        Object.entries(values).map(([k, v]) => [k, v === undefined || v === '' ? null : Number(v)]),
      )
      const out = evaluateEngine(def.formulas, inputs)
      setResults(out)
      const record = store.save(inputs, out)
      setHistory(store.list())
      message.success('计算完成')
      setPage('dashboard')
      void record
    } catch (error) {
      message.error(error instanceof Error ? error.message : '计算失败，请检查输入')
    }
  }

  const renderInput = () => (
    <Card title="录入" style={{ maxWidth: 720, margin: '0 auto' }}>
      <Form form={form} layout="vertical" onFinish={run}>
        {def.fields.map((f) => (
          <Form.Item
            key={f.key}
            name={f.key}
            label={`${f.label}${f.unit ? `（${f.unit}）` : ''}`}
            rules={[{ required: Boolean(f.required), message: `请输入${f.label}` }]}
          >
            {f.type === 'integer' || f.type === 'number' || f.type === 'money'
              ? <InputNumber style={{ width: '100%' }} placeholder={`请输入${f.label}`} />
              : <Input placeholder={`请输入${f.label}`} />}
          </Form.Item>
        ))}
        <Button type="primary" htmlType="submit">计算</Button>
      </Form>
    </Card>
  )

  const renderDashboard = () => (
    <Card title="指标卡" style={{ maxWidth: 720, margin: '0 auto' }}>
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Button onClick={() => setPage('input')}>返回修改</Button>
        <Space wrap size="large">
          {def.formulas.map((f) => (
            <Statistic
              key={f.key}
              title={f.label}
              value={results[f.key] ?? '—'}
              precision={2}
              valueStyle={{ fontSize: 22 }}
            />
          ))}
        </Space>
        <Text type="secondary">计算基于确定性公式引擎（decimal.js 精度），结果可复现。</Text>
      </Space>
    </Card>
  )

  const renderReport = () => (
    <Card title="历史记录" style={{ maxWidth: 720, margin: '0 auto' }}>
      <Table<ToolStore['list'][number]>
        rowKey="id"
        dataSource={history}
        pagination={{ pageSize: 5 }}
        columns={[
          { title: '时间', dataIndex: 'updatedAt', render: (v: string) => new Date(v).toLocaleString() },
          { title: '输入', dataIndex: 'inputs', render: (v: Record<string, unknown>) => JSON.stringify(v) },
          { title: '结果', dataIndex: 'results', render: (v: Record<string, unknown>) => JSON.stringify(v) },
        ]}
      />
      <Button danger style={{ marginTop: 16 }} onClick={() => { store.clear(); setHistory([]) }}>清空历史</Button>
    </Card>
  )

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '32px 16px' }}>
      <Title level={2} style={{ textAlign: 'center' }}>{def.name}</Title>
      <Paragraph type="secondary" style={{ textAlign: 'center' }}>
        引擎 ID：{def.engineId} · 配置驱动 · 确定性计算
      </Paragraph>
      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        <Segmented
          value={page}
          onChange={(v) => setPage(String(v))}
          options={[
            { label: '录入', value: 'input' },
            { label: '指标卡', value: 'dashboard' },
            { label: '报告', value: 'report' },
          ]}
        />
      </div>
      {page === 'input' && renderInput()}
      {page === 'dashboard' && renderDashboard()}
      {page === 'report' && renderReport()}
    </div>
  )
}
