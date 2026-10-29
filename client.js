/**
 * dsh-token-count — 浏览器侧（dsh.client 声明，包入口 dsh-token-count/client）。
 *
 * 在设置页单开一页「Token 统计」：
 *   1. 顶部：累计总量（输入 / 输出 / 缓存读 / 缓存写 四大桶 + 总计）。
 *   2. 绿色热力网格：横轴 = 周、纵轴 = 星期几，每格 = 一天，颜色深浅 = 当天用量。
 *   3. 图表区：饼图 / 柱状图切换按钮，展示四大桶占比。
 *
 * 数据通道：Host 的同源 HTTP 路由 GET /dsh-token-count-api（只读）。
 * 图表用纯 SVG 手绘，零第三方依赖。
 */
window.__ModuleLoader__.load({
  id: 'dsh-token-count',
  factory: (require) => {
    const React = require('react')
    const { useCallback, useEffect, useMemo, useState } = React
    const h = React.createElement

    const API = '/dsh-token-count-api'

    const BUCKETS = [
      { key: 'inputTokens', label: '输入', color: '#2f9e6b' },
      { key: 'outputTokens', label: '输出', color: '#5cc489' },
      { key: 'cacheReadTokens', label: '缓存读', color: '#a8e6c1' },
      { key: 'cacheWriteTokens', label: '缓存写', color: '#0b6e4f' },
    ]

    const styles = {
      page: { display: 'flex', flexDirection: 'column', gap: '16px', padding: '4px 0', maxWidth: '760px' },
      card: {
        border: '1px solid var(--dsw-alias-border-strong, rgba(128,128,128,.3))',
        borderRadius: '12px',
        padding: '14px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
      },
      title: { fontSize: '15px', fontWeight: 600 },
      hint: { fontSize: '13px', opacity: 0.72, lineHeight: '1.6' },
      totalsGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '10px' },
      totalCell: { display: 'flex', flexDirection: 'column', gap: '4px' },
      totalValue: { fontSize: '20px', fontWeight: 700, fontVariantNumeric: 'tabular-nums' },
      totalLabel: { fontSize: '12px', opacity: 0.65 },
      row: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' },
      button: {
        border: '1px solid var(--dsw-alias-border-strong, rgba(128,128,128,.3))',
        background: 'transparent',
        color: 'inherit',
        borderRadius: '8px',
        padding: '5px 12px',
        fontSize: '13px',
        cursor: 'pointer',
        fontFamily: 'inherit',
      },
      buttonActive: {
        border: 'none',
        background: 'var(--dsw-specific-accent, #2f9e6b)',
        color: '#fff',
        borderRadius: '8px',
        padding: '5px 12px',
        fontSize: '13px',
        cursor: 'pointer',
        fontFamily: 'inherit',
      },
    }

    function fmtTokens(n) {
      if (!Number.isFinite(n)) return '0'
      if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + 'B'
      if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M'
      if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
      return String(Math.round(n))
    }

    // ── 热力网格（GitHub 贡献图风格，纯 div 格子） ─────────────────────
    function Heatmap({ series }) {
      // 补成 7 的整数倍列（每周 7 行）。series 升序（最旧在前）。
      const cells = useMemo(() => {
        if (!series || series.length === 0) return []
        const pad = (7 - (series.length % 7)) % 7
        const padded = [
          ...Array(pad).fill({ date: '', tokens: 0 }),
          ...series,
        ]
        const max = Math.max(1, ...padded.map((c) => c.tokens))
        return padded.map((c) => ({ ...c, level: c.tokens <= 0 ? 0 : Math.ceil((c.tokens / max) * 4) }))
      }, [series])

      const GREEN = ['transparent', '#c8f0d8', '#8adcb0', '#3fb77e', '#0b6e4f']
      const cellStyle = {
        width: '12px',
        height: '12px',
        borderRadius: '3px',
        boxSizing: 'border-box',
      }

      if (cells.length === 0) {
        return h('div', { style: styles.hint }, '暂无数据')
      }

      // 转置：按「列」渲染，每列 7 格（星期一到星期日）。
      const cols = []
      for (let c = 0; c < cells.length / 7; c += 1) {
        const weekCells = []
        for (let r = 0; r < 7; r += 1) {
          const cell = cells[c * 7 + r]
          weekCells.push(
            h('div', {
              key: r,
              style: {
                ...cellStyle,
                background: cell.level > 0 ? GREEN[cell.level] : 'transparent',
                border: cell.level > 0 ? 'none' : '1px solid rgba(128,128,128,.25)',
              },
              title: cell.date ? `${cell.date} · ${fmtTokens(cell.tokens)} tokens` : '',
            }),
          )
        }
        cols.push(h('div', { key: c, style: { display: 'flex', flexDirection: 'column', gap: '3px' } }, weekCells))
      }

      const weekdayLabels = ['一', '', '三', '', '五', '', '日']
      const labelCol = h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: '3px', marginRight: '4px' } },
        weekdayLabels.map((t, i) =>
          h('div', { key: i, style: { height: '12px', fontSize: '10px', opacity: 0.55, lineHeight: '12px' } }, t),
        ),
      )

      return h(
        'div',
        { style: { display: 'flex', overflowX: 'auto', paddingBottom: '4px' } },
        labelCol,
        h('div', { style: { display: 'flex', gap: '3px' } }, cols),
      )
    }

    // ── 饼图（纯 SVG） ────────────────────────────────────────────────
    function PieChart({ totals }) {
      const total = Math.max(1, BUCKETS.reduce((a, b) => a + (totals[b.key] || 0), 0))
      const size = 180
      const cx = size / 2
      const cy = size / 2
      const radius = size / 2 - 4
      let angle = -Math.PI / 2
      const slices = []
      for (const b of BUCKETS) {
        const v = totals[b.key] || 0
        const sweep = (v / total) * Math.PI * 2
        if (v > 0 && sweep > 0) {
          const x1 = cx + radius * Math.cos(angle)
          const y1 = cy + radius * Math.sin(angle)
          const x2 = cx + radius * Math.cos(angle + sweep)
          const y2 = cy + radius * Math.sin(angle + sweep)
          const large = sweep > Math.PI ? 1 : 0
          slices.push(
            h('path', {
              key: b.key,
              d: `M ${cx} ${cy} L ${x1} ${y1} A ${radius} ${radius} 0 ${large} 1 ${x2} ${y2} Z`,
              fill: b.color,
              stroke: 'rgba(0,0,0,.15)',
              strokeWidth: '1',
            }),
          )
        }
        angle += sweep
      }
      return h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' } },
        h(
          'svg',
          { width: size, height: size, viewBox: `0 0 ${size} ${size}` },
          slices,
        ),
        h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
          BUCKETS.map((b) => {
            const v = totals[b.key] || 0
            const pct = total > 0 ? ((v / total) * 100).toFixed(1) : '0.0'
            return h(
              'div',
              { key: b.key, style: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px' } },
              h('span', { style: { width: '10px', height: '10px', borderRadius: '2px', background: b.color, display: 'inline-block' } }),
              h('span', null, `${b.label}  ${fmtTokens(v)}  (${pct}%)`),
            )
          }),
        ),
      )
    }

    // ── 柱状图（纯 SVG） ──────────────────────────────────────────────
    function BarChart({ totals }) {
      const max = Math.max(1, ...BUCKETS.map((b) => totals[b.key] || 0))
      const width = 320
      const height = 180
      const pad = 28
      const barW = 44
      const gap = 20
      return h(
        'div',
        { style: { display: 'flex', alignItems: 'flex-end', gap: '16px', flexWrap: 'wrap' } },
        h(
          'svg',
          { width, height, viewBox: `0 0 ${width} ${height}` },
          h('line', { x1: pad, y1: height - pad, x2: width, y2: height - pad, stroke: 'rgba(128,128,128,.4)', strokeWidth: '1' }),
          BUCKETS.map((b, i) => {
            const v = totals[b.key] || 0
            const barH = (v / max) * (height - pad - 16)
            const x = pad + i * (barW + gap)
            const y = height - pad - barH
            return h('g', { key: b.key },
              h('rect', { x, y, width: barW, height: barH, rx: 4, fill: b.color }),
              h('text', { x: x + barW / 2, y: height - pad + 14, textAnchor: 'middle', fontSize: '11', fill: 'currentColor', opacity: 0.75 }, b.label),
              h('text', { x: x + barW / 2, y: y - 6, textAnchor: 'middle', fontSize: '11', fill: 'currentColor', opacity: 0.9 }, fmtTokens(v)),
            )
          }),
        ),
      )
    }

    // ── 主组件 ────────────────────────────────────────────────────────
    function TokenCountPage() {
      const [data, setData] = useState(null)
      const [error, setError] = useState('')
      const [chart, setChart] = useState('pie')
      const [days, setDays] = useState(90)

      const load = useCallback(async () => {
        try {
          const res = await fetch(API + '?days=' + days, { headers: { Accept: 'application/json' }, cache: 'no-store' })
          if (!res.ok) throw new Error('HTTP ' + res.status)
          const json = await res.json()
          if (!json.ok) throw new Error(json.message || '读取失败')
          setData(json)
          setError('')
        } catch (e) {
          setError(String(e && e.message ? e.message : e))
        }
      }, [days])

      useEffect(() => {
        load()
      }, [load])

      return h(
        'div',
        { style: styles.page },
        // 标题与刷新
        h(
          'div',
          { style: styles.row },
          h('div', { style: { ...styles.title, flex: 1 } }, 'Token 用量统计'),
          h('button', { style: styles.button, onClick: load }, '刷新'),
        ),
        error ? h('div', { style: styles.hint }, '⚠ ' + error) : null,

        // 累计总量
        data
          ? h(
              'div',
              { style: styles.card },
              h('div', { style: styles.title }, '累计总量'),
              h(
                'div',
                { style: styles.totalsGrid },
                BUCKETS.map((b) =>
                  h(
                    'div',
                    { key: b.key, style: styles.totalCell },
                    h('span', { style: { ...styles.totalValue, color: b.color } }, fmtTokens(data.totals[b.key] || 0)),
                    h('span', { style: styles.totalLabel }, b.label),
                  ),
                ),
                h(
                  'div',
                  { style: styles.totalCell },
                  h('span', { style: styles.totalValue }, fmtTokens(data.totalTokens || 0)),
                  h('span', { style: styles.totalLabel }, '总计'),
                ),
              ),
              h('div', { style: styles.hint }, `覆盖 ${data.sessionCount ?? 0} 个会话 · 日志 ${fmtTokens(data.logBytes || 0)} 字节 · v${data.pluginVersion || '?'}`),
            )
          : h('div', { style: styles.hint }, '加载中…'),

        // 热力网格
        data
          ? h(
              'div',
              { style: styles.card },
              h('div', { style: styles.title }, '每日用量热力图'),
              h('div', { style: styles.row },
                h('button', { style: days === 30 ? styles.buttonActive : styles.button, onClick: () => setDays(30) }, '30 天'),
                h('button', { style: days === 90 ? styles.buttonActive : styles.button, onClick: () => setDays(90) }, '90 天'),
                h('button', { style: days === 180 ? styles.buttonActive : styles.button, onClick: () => setDays(180) }, '180 天'),
                h('button', { style: days === 365 ? styles.buttonActive : styles.button, onClick: () => setDays(365) }, '1 年'),
              ),
              h(Heatmap, { series: data.series }),
              h('div', { style: { ...styles.hint, fontSize: '11px', opacity: 0.5 } }, '颜色越深，当日 token 用量越高'),
            )
          : null,

        // 图表区（饼图 / 柱状图切换）
        data
          ? h(
              'div',
              { style: styles.card },
              h('div', { style: styles.row },
                h('div', { style: { ...styles.title, flex: 1 } }, '用量结构'),
                h('button', { style: chart === 'pie' ? styles.buttonActive : styles.button, onClick: () => setChart('pie') }, '饼图'),
                h('button', { style: chart === 'bar' ? styles.buttonActive : styles.button, onClick: () => setChart('bar') }, '柱状图'),
              ),
              chart === 'pie' ? h(PieChart, { totals: data.totals }) : h(BarChart, { totals: data.totals }),
            )
          : null,
      )
    }

    return {
      name: 'token-count-client',
      inject: ['slots'],
      apply(ctx) {
        const slots = (() => {
          try {
            if (ctx && ctx.slots && typeof ctx.slots.inject === 'function') return ctx.slots
          } catch {}
          try {
            const service = ctx && typeof ctx.get === 'function' ? ctx.get('slots') : null
            if (service && typeof service.inject === 'function') return service
          } catch {}
          return null
        })()
        if (!slots) return

        slots.inject('settings.section', () =>
          slots.register(
            {
              name: 'settings.section',
              id: 'dsh-token-count',
              order: 70,
              label: 'Token 统计',
            },
            () => h(TokenCountPage),
          ),
        )
      },
    }
  },
})
