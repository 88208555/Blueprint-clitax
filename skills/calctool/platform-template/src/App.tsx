// calctool 生成的可运行工具：整套工具（联通节点，非单页孤岛）
// 链路：录入 → 校验 → 计算 → 存储 → 输出（+ 自动化）
// 调用外部能力前必须授权（一次授权持久化，不再提示）
import { useEffect, useState } from 'react'
import { Alert, Button, Card, Form, Input, InputNumber, message, Modal, Segmented, Space, Statistic, Table, Tag, Typography } from 'antd'
import { evaluateEngine } from './engine/evaluate'
import { ToolStore } from './store'
import { authz, OnboardingConsent, type CapabilityKind } from './authz'
import { defaultPipeline, nodeNeighbors, type EngineDefinition } from './pipeline'
import engine from './engine-definition.json'

const { Title, Paragraph, Text } = Typography

const def = engine as EngineDefinition
const store = new ToolStore(def.engineId)
const pipeline = def.pipeline ?? defaultPipeline(def.engineId)
const onboarding = new OnboardingConsent(def.engineId)

export default function App() {
  const [form] = Form.useForm()
  const [results, setResults] = useState<Record<string, string>>({})
  const [page, setPage] = useState<string>('input')
  const [history, setHistory] = useState(store.list())
  const [authzModal, setAuthzModal] = useState<{ capability: CapabilityKind; purpose: string } | null>(null)
  const [showOnboarding, setShowOnboarding] = useState(!onboarding.accepted())

  // 首次使用总提示（一次性同意，持久化不再弹）
  useEffect(() => {
    if (!onboarding.accepted()) setShowOnboarding(true)
  }, [])

  const acceptOnboarding = () => {
    onboarding.accept()
    setShowOnboarding(false)
    message.success('已记录同意；如需调整可在「授权管理」页查看')
  }

  // 授权确认（一次授权持久化；未授权则询问，授权后不再提示）
  const ensureAuthz = (capability: CapabilityKind, purpose: string): boolean => {
    if (authz.isGranted(capability)) return true
    setAuthzModal({ capability, purpose })
    return false
  }
  const confirmAuthz = () => {
    if (authzModal) {
      authz.grant(authzModal.capability, authzModal.purpose)
      message.success(`已授权「${authz.label(authzModal.capability)}」，后续不再提示`)
      setAuthzModal(null)
    }
  }

  const run = (values: Record<string, unknown>) => {
    // 计算前需授权存储能力（写入历史）
    if (!ensureAuthz('storage', '保存计算记录到本地历史')) return
    try {
      const inputs = Object.fromEntries(
        Object.entries(values).map(([k, v]) => [k, v === undefined || v === '' ? null : Number(v)]),
      )
      // 链路：compute -> store -> output
      const out = evaluateEngine(def.formulas, inputs)
      setResults(out)
      store.save(inputs, out)
      setHistory(store.list())
      message.success('计算完成')
      setPage('dashboard')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '计算失败，请检查输入')
    }
  }

  // 首次使用总提示弹窗（同意后持久化，不再弹出）
  const renderOnboardingModal = () => (
    <Modal
      open={showOnboarding}
      title={`欢迎使用「${def.name}」`}
      okText="同意并开始使用"
      cancelText="暂不使用"
      onOk={acceptOnboarding}
      onCancel={acceptOnboarding}
      closable={false}
      maskClosable={false}
    >
      <Paragraph>
        <Text strong>关于能力调用与消耗：</Text>
      </Paragraph>
      <Paragraph>
        本工具为整套计算工具（录入 → 校验 → 计算 → 存储 → 输出，联通节点）。
        使用过程中<b>可能调用其他技能辅助</b>（如 Blueprint 开发流程编排、互联网情报搜索、AI 模型），
        <b>可能增加调用消耗</b>。
      </Paragraph>
      <Paragraph type="secondary">
        同意后不再提示；后续可在「授权管理」页查看已授权能力并随时撤销。
      </Paragraph>
    </Modal>
  )

  // 授权确认弹窗（用户可见，一次授权）
  const renderAuthzModal = () => (
    <Modal
      open={authzModal !== null}
      title="能力调用授权"
      okText="授权"
      cancelText="拒绝"
      onOk={confirmAuthz}
      onCancel={() => setAuthzModal(null)}
    >
      {authzModal ? (
        <Paragraph>
          本工具将调用 <Text strong>{authz.label(authzModal.capability)}</Text>：
          <br />{authzModal.purpose}
          <br />
          <Text type="secondary">授权一次后永久记住，后续不再提示。可在「授权管理」页撤销。</Text>
        </Paragraph>
      ) : null}
    </Modal>
  )

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
            {['integer', 'number', 'money', 'percent'].includes(f.type)
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
            <Statistic key={f.key} title={f.label} value={results[f.key] ?? '—'} precision={2} valueStyle={{ fontSize: 22 }} />
          ))}
        </Space>
        <Text type="secondary">计算基于确定性公式引擎（decimal.js），结果可复现。</Text>
      </Space>
    </Card>
  )

  const renderPipeline = () => (
    <Card title="工具链路（整套工具 · 联通节点）" style={{ maxWidth: 720, margin: '0 auto' }}>
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        {pipeline.nodes.map((node) => {
          const neighbors = nodeNeighbors(pipeline, node.id)
          const downstream = neighbors?.downstream.map((n) => n.id).join(' → ') || '（终端）'
          return (
            <div key={node.id} style={{ border: '1px solid #d9d9d9', borderRadius: 8, padding: 12 }}>
              <Space>
                <Tag color="blue">{node.kind}</Tag>
                <Text strong>{node.label}</Text>
                <Text type="secondary">→ {downstream}</Text>
              </Space>
            </div>
          )
        })}
        <Alert type="info" showIcon message="链路说明" description="工具由联通节点组成：录入 → 校验 → 计算 → 存储 → 输出。改动指标/公式只改引擎定义，链路自动感知；新增自动化节点可扩展。" />
      </Space>
    </Card>
  )

  const renderReport = () => (
    <Card title="历史记录" style={{ maxWidth: 720, margin: '0 auto' }}>
      <Table<Record<string, unknown>>
        rowKey="id"
        dataSource={history}
        pagination={{ pageSize: 5 }}
        columns={[
          { title: '时间', dataIndex: 'updatedAt', render: (v: string) => new Date(v).toLocaleString() },
          { title: '输入', dataIndex: 'inputs', render: (v: Record<string, unknown>) => JSON.stringify(v) },
          { title: '结果', dataIndex: 'results', render: (v: Record<string, unknown>) => JSON.stringify(v) },
        ]}
      />
      <Button danger style={{ marginTop: 16 }} onClick={() => { if (ensureAuthz('storage', '清空本地历史记录')) { store.clear(); setHistory([]) } }}>清空历史</Button>
    </Card>
  )

  const renderAuthz = () => (
    <Card title="授权管理" style={{ maxWidth: 720, margin: '0 auto' }}>
      <Table<ReturnType<typeof authz.list>[number]>
        rowKey="capability"
        dataSource={authz.list()}
        pagination={false}
        columns={[
          { title: '能力', dataIndex: 'capability', render: (v: CapabilityKind) => authz.label(v) },
          { title: '状态', dataIndex: 'granted', render: (v: boolean) => (v ? <Tag color="green">已授权</Tag> : <Tag>未授权</Tag>) },
          { title: '授权时间', dataIndex: 'grantedAt', render: (v: string) => new Date(v).toLocaleString() },
          { title: '操作', render: (_, r) => <Button size="small" danger onClick={() => { authz.revoke(r.capability); setPage('authz') }}>撤销</Button> },
        ]}
      />
    </Card>
  )

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '32px 16px' }}>
      <Title level={2} style={{ textAlign: 'center' }}>{def.name}</Title>
      <Paragraph type="secondary" style={{ textAlign: 'center' }}>
        引擎 ID：{def.engineId} · 整套工具（{pipeline.nodes.length} 个联通节点）· 配置驱动
      </Paragraph>
      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        <Segmented
          value={page}
          onChange={(v) => setPage(String(v))}
          options={[
            { label: '录入', value: 'input' },
            { label: '指标卡', value: 'dashboard' },
            { label: '链路', value: 'pipeline' },
            { label: '报告', value: 'report' },
            { label: '授权', value: 'authz' },
          ]}
        />
      </div>
      {page === 'input' && renderInput()}
      {page === 'dashboard' && renderDashboard()}
      {page === 'pipeline' && renderPipeline()}
      {page === 'report' && renderReport()}
      {page === 'authz' && renderAuthz()}
      {renderOnboardingModal()}
      {renderAuthzModal()}
    </div>
  )
}
