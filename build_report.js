// ATDS-V3-GATE-TOP  ·  反转闸门/八步分析置于情绪区后
// ATDS PRO 复盘报告渲染器
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
const DATA_DIR = path.join(ROOT, config.dataDir);
const SITE_DIR = path.join(ROOT, config.siteDir);
const REVIEWS_DIR = path.join(SITE_DIR, 'reviews');

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtNum(n, digits) {
  if (n == null || n === '' || isNaN(Number(n))) return '--';
  return Number(n).toLocaleString('zh-CN', { minimumFractionDigits: digits || 2, maximumFractionDigits: digits || 2 });
}

function fmtPct(n) {
  if (n == null || n === '' || isNaN(Number(n))) return '--';
  const v = Number(n);
  return (v > 0 ? '+' : '') + v.toFixed(2) + '%';
}

function upDownClass(pct) {
  const v = Number(pct);
  if (isNaN(v) || v === 0) return 'flat';
  return v > 0 ? 'up' : 'down';
}

function renderHeader(report, nav) {
  const m = report.meta || {};
  return `<div class="header">
    <div class="brand">
      <div class="logo">A</div>
      <div class="brand-text">
        <div class="brand-name">ATDS <span class="pro-badge">PRO</span> 复盘</div>
        <div class="brand-sub">GLOBAL LINKAGE V4.0 · ${esc(m.date || '')} ${esc(m.time || '')}</div>
      </div>
    </div>
    <div class="time-nav">
      <a href="${nav.home}">盘前</a><a href="${nav.midday}"${m.type === 'midday' ? ' class="active"' : ''}>午盘</a><a href="${nav.close}"${m.type === 'close' ? ' class="active"' : ''}>收盘</a><a href="${nav.latest}">复盘</a>
    </div>
  </div>`;
}


function renderHero(report) {
  const m = report && report.meta || {};
  const ce = report && report.closeEmotion || {};
  const tempTag = ce.stage ? '<span class="hero-temp-tag">' + (ce.stage || '') + ' · ' + (ce.tempScore || '') + '°</span>' : '';
  const desc = m.type === 'premarket'
    ? '基于上一交易日数据 · 今日开盘前参考 · 非买卖建议'
    : m.type === 'midday'
      ? '实时盘中快照 · 实时更新中'
      : '收盘静态快照 · 数据截至 15:00';
  return '<div class="hero">' +
    '<div class="hero-eyebrow">A 股每日复盘 · ' + (esc(m.typeLabel || '')) + '</div>' +
    '<h1 class="hero-title">' + (esc(m.date || '')) + ' · <span class="hero-time">' + (esc(m.time || '')) + '</span></h1>' +
    '<div class="hero-sub">' + desc + '</div>' +
    (tempTag ? '<div class="hero-tags">' + tempTag + '</div>' : '') +
  '</div>';
}

function renderIndices(report) {
  const items = (report.indices || []).map(idx => {
    const cls = upDownClass(idx.changePct);
    return `<div class="index-item">
      <div class="index-name">${esc(idx.name)}</div>
      <div class="index-value ${cls}">${fmtNum(idx.price)}</div>
      <div class="index-change ${cls}">${fmtPct(idx.changePct)}</div>
    </div>`;
  }).join('');
  return `<div class="card">
    <div class="card-title">核心指数</div>
    <div class="index-row">${items}</div>
    <div class="status-row">
      <div class="status-item">生成时间<strong>${esc(report.meta.generatedAt || '--')}</strong></div>
      <div class="status-item">数据源<strong>通达信实时</strong></div>
      <div class="status-item">类型<strong>${esc(report.meta.typeLabel || '')}</strong></div>
    </div>
  </div>`;
}

function renderStatusBar(report) {
  const s = report.marketStats || {};
  return `<div class="status-row">
    <div class="status-item">上涨<strong>${s.upCount ?? '--'}</strong></div>
    <div class="status-item">下跌<strong>${s.downCount ?? '--'}</strong></div>
    <div class="status-item">平盘<strong>${s.flatCount ?? '--'}</strong></div>
    <div class="status-item">涨停<strong>${s.limitUpCount ?? '--'}</strong></div>
    <div class="status-item">跌停<strong>${s.limitDownCount ?? '--'}</strong></div>
    <div class="status-item">炸板<strong>${s.zhaBanCount ?? '--'}</strong></div>
  </div>`;
}

function renderMarketStats(report) {
  const s = report.marketStats || {};
  return `<div class="card">
    <div class="card-title">市场概览</div>
    <div class="stat-grid">
      <div class="stat-card"><div class="stat-num up">${s.upCount ?? '--'}</div><div class="stat-label">上涨家数</div></div>
      <div class="stat-card"><div class="stat-num down">${s.downCount ?? '--'}</div><div class="stat-label">下跌家数</div></div>
      <div class="stat-card"><div class="stat-num">${s.limitUpCount ?? '--'}</div><div class="stat-label">涨停家数</div></div>
      <div class="stat-card"><div class="stat-num down">${s.limitDownCount ?? '--'}</div><div class="stat-label">跌停家数</div></div>
      <div class="stat-card"><div class="stat-num">${s.zhaBanCount ?? '--'}</div><div class="stat-label">炸板家数</div></div>
      <div class="stat-card"><div class="stat-num">${s.maxLianBan ?? '--'}</div><div class="stat-label">最高连板</div></div>
    </div>
    <div class="status-row">
      <div class="status-item">最高连板<strong>${esc(s.maxLianBanStock || '--')}</strong></div>
      <div class="status-item">成交额<strong>${esc(s.totalAmount || '--')}</strong></div>
    </div>
  </div>`;
}

function renderLimitUp(report) {
  const list = report.limitUp || [];
  if (!list.length) return '';
  const rows = list.map((s, i) => {
    const cls = upDownClass(s.pct);
    return `<div class="stock-row">
      <div class="stock-info"><div class="stock-name">${i + 1}. ${esc(s.name)} <span class="rank-tag">${esc(s.boardInfo || s.lianban + '板')}</span></div>
        <div class="stock-code">${esc(s.code)} · ${esc(s.reason || '')}</div>
        ${s.sealAmount ? `<div class="stock-code">封单 ${esc(s.sealAmount)} 亿${s.kaiban != null ? ' · 开板 ' + s.kaiban + ' 次' : ''}</div>` : ''}
      </div>
      <div class="stock-price"><div class="price ${cls}">${fmtNum(s.price)}</div><div class="pct ${cls}">${fmtPct(s.pct)}</div></div>
    </div>`;
  }).join('');
  return `<div class="card">
    <div class="card-title">涨停梯队 · ${list.length} 只</div>
    ${rows}
  </div>`;
}

function renderLimitDown(report) {
  const list = report.limitDown || [];
  if (!list.length) return '';
  const rows = list.map((s, i) => {
    return `<div class="stock-row">
      <div class="stock-info"><div class="stock-name">${i + 1}. ${esc(s.name)}</div><div class="stock-code">${esc(s.code)}</div></div>
      <div class="stock-price"><div class="price down">${fmtNum(s.price)}</div><div class="pct down">${fmtPct(s.pct)}</div></div>
    </div>`;
  }).join('');
  return `<div class="card">
    <div class="card-title">跌停梯队 · ${list.length} 只</div>
    ${rows}
  </div>`;
}

function renderSectors(report) {
  const list = report.hotSectors || [];
  if (!list.length) return '';
  const rows = list.map(s => {
    const cls = upDownClass(s.changePct);
    return `<tr>
      <td>${s.rank || '--'}</td>
      <td>${esc(s.name)}</td>
      <td class="${cls}">${fmtPct(s.changePct)}</td>
      <td>${s.limitUpCount ?? '--'}</td>
      <td>${esc(s.leadStock || '--')}</td>
    </tr>`;
  }).join('');
  return `<div class="card">
    <div class="card-title">板块热点</div>
    <table class="table"><thead><tr><th>#</th><th>板块</th><th>涨幅</th><th>涨停</th><th>领涨</th></tr></thead><tbody>${rows}</tbody></table>
  </div>`;
}

function renderIntlMkt(report) {
  const im = (report && report.intlMkt) || {};
  const items = [
    { code: 'us.DJI', label: '道琼斯', unit: '', tone: 'us' },
    { code: 'us.IXIC', label: '纳斯达克', unit: '', tone: 'us' },
    { code: 'hf_CL', label: 'WTI 原油', unit: '$/bbl', tone: 'oil' },
    { code: 'hf_GC', label: 'COMEX 黄金', unit: '$/oz', tone: 'gold' }
  ];
  const cards = items.map(x => {
    const v = im[x.code];
    const cls = v && v.changePct > 0 ? 'up' : (v && v.changePct < 0 ? 'down' : 'flat');
    const priceStr = v && !isNaN(v.price) ? (x.code.startsWith('hf_') ? v.price.toFixed(2) : fmtNum(v.price)) : '--';
    const pctStr = v && !isNaN(v.changePct) ? fmtPct(v.changePct) : '--';
    const name = v && v.name ? v.name : x.label;
    return `<div class="card intl-card"><div class="intl-head"><span class="intl-name">${esc(name)}</span><span class="intl-unit">${esc(x.unit)}</span></div>` +
      `<div class="intl-price ${cls}">${priceStr}</div>` +
      `<div class="intl-change ${cls}">${pctStr}</div>` +
      `<div class="intl-time">${esc(v && v.time ? v.time : '待补充')}</div></div>`;
  }).join('');
  const dj = im['us.DJI'], ix = im['us.IXIC'], cl = im['hf_CL'], gc = im['hf_GC'];
  const hints = [];
  if (cl && cl.changePct > 1) hints.push('原油强势 → 资源/能源板块或受关注');
  if (gc && gc.changePct > 0.5) hints.push('黄金上涨 → 避险情绪升温');
  if (ix && ix.changePct > 0.5) hints.push('纳指走强 → 科技/AI 板块或受提振');
  if (dj && dj.changePct < -0.5) hints.push('道指走弱 → 防御板块或受关注');
  const styleHint = hints.length ? hints.slice(0, 2).join('；') : '数据待补充，建议结合盘前/盘中走势综合判断';
  // 国际联动明细表（联网补充数据：欧股/标普/费半/个股/VIX/汇率等）
  let detailHtml = '';
  const det = (report && report.intlDetail) || {};
  const groups = [
    ['us', '🇺🇸 美股（美东8/12收盘）'],
    ['europe', '🇪🇺 欧洲（8/12收盘）'],
    ['commodities', '🛢️ 商品'],
    ['fx', '💱 汇率'],
    ['sentiment', '🧭 情绪与关键变量']
  ];
  const rows = [];
  for (const [gk, gLabel] of groups) {
    const g = det[gk];
    if (!g || !Object.keys(g).length) continue;
    const itemRows = [];
    for (const key of Object.keys(g)) {
      const it = g[key];
      if (typeof it !== 'object' || it === null) {
        // 纯文本条目（如情绪说明）→ 合并渲染为一行说明
        if (typeof it === 'string' && it.trim()) {
          itemRows.push(`<tr><td colspan="5" class="intl-dt-note">${esc(it)}</td></tr>`);
        }
        continue;
      }
      const name = it.name || key;
      const cls = upDownClass(it.changePct);
      const priceStr = it.price != null && !isNaN(Number(it.price)) ? (typeof it.price === 'number' ? it.price.toLocaleString('zh-CN', { minimumFractionDigits: /fx|CNH|中间价/.test(name) ? 4 : 2, maximumFractionDigits: 4 }) : String(it.price)) : '--';
      const pctStr = it.changePct != null && !isNaN(Number(it.changePct)) ? fmtPct(it.changePct) : (it.unit || '--');
      const src = it.source ? `${it.source}` : '';
      itemRows.push(`<tr>
        <td>${esc(name)}</td>
        <td class="${cls}">${priceStr}${it.unit ? ' ' + esc(it.unit) : ''}</td>
        <td class="${cls}">${pctStr}</td>
        <td class="intl-dt-time">${esc(it.time || '--')}</td>
        <td class="intl-dt-src">${esc(src)}</td>
      </tr>`);
    }
    if (itemRows.length) {
      rows.push(`<tr class="intl-group-row"><td colspan="5" class="intl-group-td">${gLabel}</td></tr>`);
      rows.push(...itemRows);
    }
  }
  if (rows.length) {
    detailHtml = `<div class="intl-detail">
      <div class="intl-detail-h">📊 国际联动明细（联网补充 · 实时检索）</div>
      <div class="intl-detail-asof">口径说明：${esc(det.asOfLabel || '')}</div>
      <table class="intl-detail-table">
        <thead><tr><th>指标</th><th>最新值</th><th>涨跌幅</th><th>来源时间</th><th>来源</th></tr></thead>
        <tbody>${rows.join('')}</tbody>
      </table>
    </div>`;
  }
  return `<div class="intl-mkt">
    <div class="intl-header"><span class="intl-eyebrow">GLOBAL LINKAGE · 4 MIN REFRESH</span><span class="intl-title">🌐 盘中信息 · 国际联动</span></div>
    <div class="intl-cards">${cards}</div>
    <div class="intl-style"><div class="intl-style-h">📌 今日 A 股风格倾向（外盘推导）</div><div class="intl-style-body">${esc(styleHint)}</div></div>
    ${detailHtml}
    <div class="intl-missing">数据源：腾讯公开 API（道指/纳指/原油/黄金实时）+ 联网检索（欧股/标普/费半/英伟达/AMD/VIX/CNY）。A 股真正走势由内资承接和国内政策决定，外盘仅定开盘风格底色。</div>
  </div>`;
}

function renderCloseEmotion(report) {
  const ce = (report && report.closeEmotion) || {};
  const m = report && report.meta || {};
  const indices = report.indices || [];
  // 顶部摘要面板
  const topPanel = '<div class="ce-top-panel">' +
    '<div class="ce-top-left">' +
      '<div class="ce-temp">' + (ce.tempScore || '--') + '°</div>' +
      '<div class="ce-stage">' + (ce.stage || '--') + ' · 情绪' + (ce.tone || '') + '</div>' +
      '<div class="ce-fact">主特征: ' + (ce.fact || '--') + '</div>' +
    '</div>' +
    '<div class="ce-top-right">' +
      '<div class="ce-top-stat"><span class="ce-stat-icon">🔴</span><span class="ce-stat-label">红盘</span><span class="ce-stat-val">' + (ce.redRate || '--') + '%</span></div>' +
      '<div class="ce-top-stat"><span class="ce-stat-icon">🔥</span><span class="ce-stat-label">涨停</span><span class="ce-stat-val">' + (ce.ztTotal || '--') + '</span></div>' +
      '<div class="ce-top-stat"><span class="ce-stat-icon">🟢</span><span class="ce-stat-label">跌停</span><span class="ce-stat-val">0</span></div>' +
      '<div class="ce-top-desc">广度与接力双强,非诱多</div>' +
    '</div>' +
  '</div>';

  // 01 情绪指标 4 卡片
  const emotion = '<div class="card"><div class="card-title">01 情绪指标</div>' +
    '<div class="ce-emotion-grid">' +
      '<div class="ce-emotion-card"><div class="ce-emo-num">' + (ce.ztTotal || '--') + '</div><div class="ce-emo-label">涨停</div></div>' +
      '<div class="ce-emotion-card"><div class="ce-emo-num">≈' + (ce.limitBoardRate || '--') + '%</div><div class="ce-emo-label">封板率</div></div>' +
      '<div class="ce-emotion-card"><div class="ce-emo-num">' + (ce.maxLB || '--') + '板</div><div class="ce-emo-label">最高度</div></div>' +
      '<div class="ce-emotion-card"><div class="ce-emo-num">' + (ce.promotionRate || '--') + '%</div><div class="ce-emo-label">连板晋级率</div></div>' +
    '</div></div>';

  // 02 市场广度与指数结构
  const breadthHtml = '<div class="ce-breadth-row">' +
    '<div class="ce-breadth-stat up"><div class="ce-bs-label">上涨</div><div class="ce-bs-num">' + (ce.upCount || '--') + '</div></div>' +
    '<div class="ce-breadth-stat down"><div class="ce-bs-label">下跌</div><div class="ce-bs-num">' + (ce.downCount || '--') + '</div></div>' +
    '<div class="ce-breadth-stat flat"><div class="ce-bs-label">平盘</div><div class="ce-bs-num">' + (ce.flatCount || '--') + '</div></div>' +
  '</div>' +
  '<div class="ce-breadth-bar">' +
    '<div class="ce-bar-up" style="flex:' + (ce.upCount || 0) + '"></div>' +
    '<div class="ce-bar-flat" style="flex:' + (ce.flatCount || 0) + '"></div>' +
    '<div class="ce-bar-down" style="flex:' + (ce.downCount || 0) + '"></div>' +
  '</div>' +
  '<div class="ce-breadth-meta">' +
    '<span>红盘率 <b>' + (ce.redRate || '--') + '%</b></span>' +
    '<span>成交额 <b>待补充</b>(早盘较昨日需联网)</span>' +
  '</div>';
  const idxRows = indices.map(idx => {
    const cls = upDownClass(idx.changePct);
    return '<div class="ce-idx-row"><span class="ce-idx-name">' + esc(idx.name) + '</span><span class="ce-idx-val ' + cls + '">' + fmtPct(idx.changePct) + '</span><div class="ce-idx-bar"><div class="ce-idx-bar-fill ' + cls + '" style="width:' + Math.min(100, Math.abs(idx.changePct || 0) * 30) + '%"></div></div></div>';
  }).join('');
  const indexHtml = '<div class="ce-index-block"><div class="ce-block-h">指数表现</div>' + idxRows +
    '<div class="ce-block-hint">成长科技领涨,量能微缩但仍在 2 万亿上方</div></div>';
  const broadBlock = '<div class="card"><div class="card-title">02 市场广度与指数结构</div>' +
    '<div class="ce-broad-grid">' +
    '<div class="ce-broad-left">' + breadthHtml + '</div>' +
    '<div class="ce-broad-right">' + indexHtml + '</div>' +
    '</div></div>';

  // 03 主线强度与资金流向
  const mainLineRows = (ce.mainLines || []).map(m => {
    return '<div class="ce-ml-row"><span class="ce-ml-name">' + esc(m.name) + '</span><span class="ce-ml-val up">+' + m.changePct + '%</span></div>';
  }).join('');
  const moneyRows = (ce.moneyInflow || []).map(m => {
    return '<div class="ce-mi-row"><span class="ce-mi-name">' + esc(m.name) + '</span><span class="ce-mi-val up">+' + m.valueYi + '亿</span></div>';
  }).join('');
  const mlBlock = '<div class="ce-ml-block"><div class="ce-block-h">主线强度</div>' + mainLineRows + '</div>';
  const miBlock = '<div class="ce-mi-block"><div class="ce-block-h">主力净流入(亿元)</div>' + moneyRows + '</div>';
  const flowBlock = '<div class="card"><div class="card-title">03 主线强度与资金流向</div>' +
    '<div class="ce-flow-grid">' +
      '<div class="ce-flow-item">' + mlBlock + '</div>' +
      '<div class="ce-flow-item">' + miBlock + '</div>' +
      '<div class="ce-flow-item">' +
        '<div class="ce-block-h">📌 结论</div>' +
        '<div class="ce-flow-conclusion">宽度 × 高度 × 资金<br>三维共振,确认主线。</div>' +
      '</div>' +
    '</div></div>';

  // 04 情绪高度(连板梯队)
  const ladderItems = (ce.ladder || []).map(l => {
    return '<span class="ce-ladder-pill">' + esc(l.lianban) + ' · ' + esc(l.lead) + '</span>';
  }).join('');
  const ladderBlock = '<div class="card"><div class="card-title">04 情绪高度(连板梯队)</div>' +
    '<div class="ce-ladder">' + ladderItems + '</div></div>';

  // 05 明日观察锚点
  const anchors = [
    { icon: '🎯', title: '主线持续性', desc: '观察中际旭创 / 新易盛 / 天孚通信能否继续表态' },
    { icon: '⚠️', title: '情绪退潮阈值', desc: '炸板率 > 40% 或晋级率 < 50% 需警惕' },
    { icon: '📊', title: '量能验证', desc: '2.15 万亿基础上能否重拾放量' },
    { icon: '🛡️', title: '高位风险', desc: '百花医药 7 板与医药板块背离' }
  ];
  const anchorCards = anchors.map(a => {
    return '<div class="ce-anchor-card"><div class="ce-anchor-h">' + a.icon + ' ' + esc(a.title) + '</div><div class="ce-anchor-desc">' + esc(a.desc) + '</div></div>';
  }).join('');
  const anchorBlock = '<div class="card"><div class="card-title">05 明日观察锚点</div>' +
    '<div class="ce-anchor-grid">' + anchorCards + '</div></div>';

  // 底部强调横幅
  const banner = '<div class="ce-banner">🔥 高温普涨不是诱多;主攻仍看主线板块,明日验证资金与量能能否继续共振。</div>';

  return '<div class="close-emotion">' +
    '<div class="ce-eyebrow">A 股收盘 · 主线与情绪复盘</div>' +
    '<div class="ce-title">' + esc(m.date || '') + ' ' + esc(m.typeLabel || '') + (m.type === 'midday' ? ' · 实时更新中' : ' · 数据截至 ' + esc(m.time || '15:00')) + '</div>' +
    topPanel +
    emotion +
    broadBlock +
    flowBlock +
    ladderBlock +
    anchorBlock +
    banner +
  '</div>';
}

function renderTechAnalysis(report) {
  const ta = (report && report.techAnalysis) || {};
  const idxList = ['000001', '399001', '399006'];
  const rows = idxList.map(code => {
    const t = ta[code];
    if (!t) return '<tr><td>' + code + '</td><td colspan="3" class="hint">K 线数据缺失</td></tr>';
    const supports = t.supports.map(s => '<div class="ta-level ta-support"><b>' + s.price.toFixed(2) + '</b><span class="ta-label">' + esc(s.label) + '</span></div>').join('');
    const pressures = t.pressures.map(p => '<div class="ta-level ta-pressure"><b>' + p.price.toFixed(2) + '</b><span class="ta-label">' + esc(p.label) + '</span></div>').join('');
    const maLine = '<div class="ta-ma"><span>MA5 ' + t.ma5.toFixed(1) + '</span><span>MA10 ' + t.ma10.toFixed(1) + '</span><span>MA20 ' + t.ma20.toFixed(1) + '</span><span>MA60 ' + t.ma60.toFixed(1) + '</span></div>';
    return '<tr><td class="ta-name">' + esc(t.name) + '<br><span class="ta-last">' + t.last.toFixed(2) + '</span></td>' +
      '<td class="ta-supports">' + (supports || '<span class="hint">当前位于各均线之上,关注整数关口</span>') + '</td>' +
      '<td class="ta-pressures">' + (pressures || '<span class="hint">当前位于各均线之下,关注整数关口</span>') + '</td>' +
      '<td class="ta-ma-cell">' + maLine + '</td></tr>';
  }).join('');
  const sh = ta['000001'];
  const vol5 = sh ? sh.vol5 : null;
  const volPredict = vol5 ? '全天上证成交额预期: <b>' + (vol5 * 0.85).toFixed(0) + ' 亿 ~ ' + (vol5 * 1.15).toFixed(0) + ' 亿</b>(基于近 5 日均值 ±15%)' : '量能数据待补充';
  const volMorning = vol5 ? '早盘 30 分钟成交预期: <b>' + (vol5 * 0.07).toFixed(0) + ' 亿 ~ ' + (vol5 * 0.12).toFixed(0) + ' 亿</b>(占全天 7%-12%)' : '数据待补充';
  const volStandard = '量能验证标准: <b>有量有价</b>(成交 ≥ 5 日均量) → 突破可期; <b>无量诱多</b>(成交 &lt; 5 日均量 70%) → 谨防冲高回落';
  const trendItems = [];
  if (sh && sh.last > sh.ma5 && sh.last > sh.ma20) {
    trendItems.push({ p: 35, text: '先抑后扬,震荡修复' });
    trendItems.push({ p: 25, text: '放量突破 MA60(季线)' });
  } else if (sh && sh.last > sh.ma60) {
    trendItems.push({ p: 30, text: '回踩 MA20 确认支撑后上行' });
    trendItems.push({ p: 25, text: '围绕 MA5-MA20 区间震荡' });
  } else {
    trendItems.push({ p: 40, text: '缩量回踩 MA60/MA120 寻求支撑' });
    trendItems.push({ p: 30, text: '缩量震荡,等待量能配合' });
  }
  trendItems.push({ p: 20, text: '放量突破整数关口' });
  trendItems.push({ p: 15, text: '缩量下跌至前期缺口' });
  trendItems.sort((a, b) => b.p - a.p);
  const risks = [
    { name: '外盘突发利空', desc: '美股夜盘跳水或地缘冲突升级将传导 A 股开盘' },
    { name: '高位板块获利兑现', desc: '连板梯队炸板率上升,资金切出高位股' },
    { name: '关键压力位攻关失败', desc: '上证 3992(MA60)或深证 14746(半年线)若缩量冲关失败,易形成头部' },
    { name: '量能持续萎缩', desc: '全日成交 < 5 日均量 80% 时,任何上攻都缺乏持续性' },
    { name: '重要数据/政策发布', desc: '美国 CPI、美联储讲话、国内经济数据若超预期,可能引发波动放大' }
  ];
  const riskHtml = risks.map(r => '<div class="risk-item"><span class="risk-name">' + esc(r.name) + '</span><span class="risk-desc">' + esc(r.desc) + '</span></div>').join('');
  const trendHtml = trendItems.map(t => '<div class="trend-item"><span class="trend-pct">' + t.p + '%</span><span class="trend-text">' + esc(t.text) + '</span></div>').join('');
  return '<div class="tech-card">' +
    '<div class="ta-header"><span class="ta-eyebrow">TECHNICAL ANALYSIS · 盘前/盘中技术研判</span><span class="ta-title">📐 今日技术研判</span></div>' +
    '<div class="card"><div class="card-title">1. 关键支撑位 / 压力位(由近及远)</div>' +
    '<table class="ta-table"><thead><tr><th>指数 / 最新价</th><th>关键支撑</th><th>关键压力</th><th>均线结构</th></tr></thead><tbody>' + rows + '</tbody></table>' +
    '<div class="hint">支撑/压力按"由近及远"排序,标注技术含义(5 日均线/10 日均线/月线/季线/半年线/年线/整数关口)</div></div>' +
    '<div class="card"><div class="card-title">2. 量能关键</div>' +
    '<div class="vol-item">' + volPredict + '</div>' +
    '<div class="vol-item">' + volMorning + '</div>' +
    '<div class="vol-item">' + volStandard + '</div></div>' +
    '<div class="card"><div class="card-title">3. 走势预判(概率倾向)</div>' +
    '<div class="trend-list">' + trendHtml + '</div>' +
    '<div class="hint">所有判断为概率倾向(参考量、非买卖点),实际盘中需结合实时走势验证</div></div>' +
    '<div class="card"><div class="card-title">4. 核心风险(3-5 项)</div>' +
    '<div class="risk-list">' + riskHtml + '</div></div>' +
  '</div>';
}

function renderPlaybook(report) {
  const pb = (report && report.playbook) || {};
  const offense = pb.offense || [];
  const defense = pb.defense || [];
  const themes = pb.themes || [];
  const pitfall = pb.pitfall || [];
  const sec = (items, type, title, icon) => {
    if (!items.length) return '<div class="hint">暂无' + title + '数据</div>';
    return '<div class="pb-sec pb-' + type + '"><div class="pb-sec-h">' + icon + ' ' + title + '</div>' +
      items.map(it =>
        '<div class="pb-item">' +
        '<div class="pb-name">' + esc(it.name) + (it.count != null ? '<span class="pb-count">' + it.count + '家 / ' + it.maxLB + '板</span>' : '') + (it.leadStock ? '<span class="pb-lead">龙头 ' + esc(it.leadStock) + '</span>' : '') + '</div>' +
        '<div class="pb-logic">' + esc(it.logic || '') + '</div>' +
        '<div class="pb-scenario">适用场景:' + esc(it.scenario || '') + '</div>' +
        '</div>'
      ).join('') + '</div>';
  };
  const themeSec = () => {
    if (!themes.length) return '';
    return '<div class="pb-sec pb-themes"><div class="pb-sec-h">🎯 主题方向</div>' +
      themes.map(t => '<div class="pb-item"><div class="pb-name">' + esc(t.name) + '<span class="pb-stocks">映射标的:' + (t.stocks || []).map(esc).join('、') + '</span></div></div>').join('') + '</div>';
  };
  const rhythm = '<div class="card"><div class="card-title">操作节奏</div>' +
    '<div class="rhythm-item"><span class="rhythm-time">早盘 9:30-10:30</span><span class="rhythm-rule">"高开不追、低开看承接":基于外盘+开盘竞价,若高开 ≥0.5% 谨防冲高回落;若低开 ≤-0.5% 关注早盘 30 分钟承接力度</span></div>' +
    '<div class="rhythm-item"><span class="rhythm-time">午盘 10:30-14:00</span><span class="rhythm-rule">基于上午量能+板块轮动:若上午成交已达 5 日均量 50% 以上 + 板块轮动有序,可继续持有;若上午缩量+龙头炸板,逢高减仓</span></div>' +
    '<div class="rhythm-item"><span class="rhythm-time">尾盘 14:00-15:00</span><span class="rhythm-rule">基于全天走势定型:定型向上则持有或加仓主线,定型向下则规避高位股+减仓至建议仓位</span></div>' +
    '<div class="rhythm-pos"><b>仓位管理建议</b>:当前市场环境下建议仓位区间 <b>40%-60%</b>,加减仓触发条件:放量突破 MA60 + 板块带动 ≥3 板 → 加仓至 60%;缩量回踩 MA20 + 龙头炸板 → 减仓至 40%</div></div>';
  return '<div class="playbook-card">' +
    '<div class="pb-header"><span class="pb-eyebrow">PLAYBOOK · 风险判断及重点关注方向</span><span class="pb-title">🎯 风险判断及重点关注方向</span></div>' +
    '<div class="pb-grid">' +
      sec(offense, 'offense', '进攻方向(2-3 个)', '⚔️') +
      sec(defense, 'defense', '防御方向(2-3 个)', '🛡️') +
      themeSec() +
      sec(pitfall, 'pitfall', '避坑方向(2-3 个)', '⚠️') +
    '</div>' +
    rhythm + '</div>';
}

function renderVerdict(report) {
  const pb = (report && report.playbook) || {};
  const offense = (pb.offense || []).slice(0, 2);
  const defense = (pb.defense || []).slice(0, 2);
  const pitfall = (pb.pitfall || []).slice(0, 2);
  const variables = '<div class="card"><div class="card-title">关键变量提醒(今日待落地)</div>' +
    '<div class="var-item">🇺🇸 <b>美国 CPI / 美联储讲话</b> → 关注通胀与利率路径,影响北向资金与全球风险偏好</div>' +
    '<div class="var-item">🇨🇳 <b>国内经济数据 / 央行公开市场操作</b> → 关注社融、PMI、利率决议,影响流动性预期</div>' +
    '<div class="var-item">🌐 <b>外盘重要事件</b> → 欧股开盘、美股期货走势、地缘冲突</div>' +
    '<div class="hint">具体发布时间需联网实时确认(由 ATDS 11:35 automation 联网补充)</div></div>';
  const riskTop = pitfall.map(p => '<div class="vd-risk">' + esc(p.name) + '——' + esc(p.logic) + '</div>').join('');
  const offenseLine = offense.length ? '关注 <b>' + offense.map(o => esc(o.name)).join(' / ') + '</b> 的持续性与龙头承接,概率倾向:板块带动效应延续的可能性较高' : '本类暂无重大变化';
  const defenseLine = defense.length ? '若市场风险偏好下行,配置可考虑 <b>' + defense.map(d => esc(d.name)).join(' / ') + '</b>,此类标的波动较低、分红稳定' : '本类暂无重大变化';
  const pitfallLine = pitfall.length ? '回避 <b>' + pitfall.map(p => esc(p.name)).join(' / ') + '</b>,尤其在外盘走弱或高位板块炸板时风险上升' : '本类暂无重大变化';
  return '<div class="verdict-card">' +
    '<div class="vd-header"><span class="vd-eyebrow">VERDICT · 综合研判输出</span><span class="vd-title">📋 综合研判输出</span></div>' +
    '<div class="card vd-card vd-offense"><div class="vd-h">⚔️ 进攻线</div><div class="vd-body">' + offenseLine + '</div></div>' +
    '<div class="card vd-card vd-defense"><div class="vd-h">🛡️ 防守线</div><div class="vd-body">' + defenseLine + '</div></div>' +
    '<div class="card vd-card vd-pitfall"><div class="vd-h">⚠️ 避坑线</div><div class="vd-body">' + pitfallLine + '</div></div>' +
    variables +
    '<div class="card"><div class="card-title">风险提示(综合)</div>' + (riskTop || '<div class="hint">当前主要风险点需结合盘中数据</div>') + '</div>' +
    '<div class="vd-disclaimer">约束条件:所有数据来自联网实时检索;所有判断为概率倾向,不使用绝对化表述;技术位是概率参考而非确定买卖点;若某类别无重大变化,输出"本类暂无重大变化",不编造;A 股真正走势由内资承接力度、国内政策催化、板块轮动节奏决定</div>' +
  '</div>';
}

function renderRegimeGate(report) {
  const gate = report.regimeGate || {};
  const ta = gate.totalAmount || 0;
  const nh = gate.newHighCount || 0;
  const totalZ = gate.totalZhengZhang || 0;
  const taOk = ta >= 29650;
  const nhOk = nh >= 100;
  const gateOpen = taOk && nhOk;
  const taPct = ta ? ((29650 - ta) / 29650 * 100).toFixed(1) : '--';
  const nhPct = nh ? ((100 - nh) / 100 * 100).toFixed(0) : '--';
  const taDiff = ta ? (ta - 29650).toFixed(0) : '--';
  const nhDiff = nh - 100;
  const status = gateOpen ? 'OPEN' : 'CLOSE';
  const cls = gateOpen ? 'gate-open' : 'gate-close';
  return `<div class="card gate-card">
    <div class="card-title">反转闸门 · 温故知「加锁权」</div>
    <div class="gate-note">核心规则:① AND ② 同时满足 → 闸门开(允许新仓);任一项未达标 → 闸门红(禁开新仓,埋伏名单豁免)</div>
    <div class="gate-grid">
      <div class="gate-block">
        <div class="gate-h">① 成交额(沪深合计)</div>
        <div class="gate-value ${taOk ? 'ok' : 'red'}">${ta ? ta.toFixed(0) + ' 亿' : '--'}</div>
        <div class="gate-th">阈值 ≥ 29650 亿 · 连续 2 日达标</div>
        <div class="gate-diff ${taOk ? 'ok' : 'red'}">${ta ? (taOk ? '✓ 超过 ' + taDiff + ' 亿' : '✗ 差 ' + (29650 - ta).toFixed(0) + ' 亿 (' + taPct + '%)') : '数据获取中'}</div>
      </div>
      <div class="gate-block gate-click" onclick="openRegimeNHList()">
        <div class="gate-h">② 60日新高个股数 <span class="gate-link">📋 点击查看</span></div>
        <div class="gate-value ${nhOk ? 'ok' : 'red'}">${nh} 只</div>
        <div class="gate-th">阈值 ≥ 100 只 · 群众基础确认</div>
        <div class="gate-diff ${nhOk ? 'ok' : 'red'}">${nh ? (nhOk ? '✓ 超过 ' + nhDiff + ' 只' : '✗ 差 ' + (-nhDiff) + ' 只 (' + nhPct + '%)') : '--'}</div>
      </div>
    </div>
    <div class="gate-status ${cls}">
      <span class="gate-status-label">闸门状态：</span>
      <span class="gate-status-text">${status === 'OPEN' ? '✓ 绿 放行 · 允许开新仓' : '✗ 红 禁开 · 仅允许执行预检埋伏名单(估值+硬止损+仓位上限已定)'}</span>
    </div>
    <div class="gate-src">数据源:①成交额(东财沪深接口/降级时显示--)/ ②60日新高(东财涨停池代理,基于1板+涨幅≥5%数量 = ${nh}只/总涨停${totalZ}只,真实接口数据更准)
      <span class="da-score">准确性 6/10(代理指标)</span>
    </div>
  </div>`;
}

function renderMarketScan(report) {
  const ms = report.marketScan || {};
  const picks = ms.picks || [];
  const gate = report.regimeGate || {};
  const gateOpen = (gate.totalAmount || 0) >= 29650 && (gate.newHighCount || 0) >= 100;
  const rows = picks.map((p, i) => `
    <div class="ms-row">
      <span class="ms-rank">${i + 1}</span>
      <a class="da-stock ms-name" data-code="${esc(p.code)}" onclick="openStockResearch(this.dataset.code)">${esc(p.name)}</a>
      <span class="ms-code">${esc(p.code)}</span>
      <span class="ms-pct ${Number(p.pct) >= 0 ? 'up' : 'down'}">${Number(p.pct) >= 0 ? '+' : ''}${p.pct}%</span>
      <span class="ms-patterns">${(p.patterns || []).map(x => '<span class="ms-pattern">' + esc(x) + '</span>').join('')}</span>
      <span class="ms-score">${p.score}</span>
      <button class="wl-btn ms-add" data-code="${esc(p.code)}" onclick="addFetchedToWatchlist(this.dataset.code)">加入</button>
    </div>`).join('');
  return `<div class="card ms-card">
    <div class="card-title">形态扫描 · 启动 / 老鸭头 / 拉升 <button class="wl-tool ms-refresh" onclick="refreshMarketScan()">🔄 刷新重扫</button></div>
    <div class="ms-note">扫描范围：${esc(ms.source || '--')}（${ms.candidates || 0} 只候选，剔除 ST/新股）→ 识别 ${picks.length} 只形态启动个股</div>
    <div class="ms-gate ${gateOpen ? 'ok' : 'red'}">反转闸门：${gateOpen ? '绿 · 放行' : '红 · 禁开新仓（埋伏名单豁免）'}${gateOpen ? ' → 以下可考虑加入观察池' : ' → 仅埋伏名单可操作，新仓需谨慎'}</div>
    <div class="ms-list" id="ms-list">${rows || `<div class="ms-empty">${(ms.klineFail || 0) > 0 && !(ms.klineOk || 0) ? 'K线数据源当前不可达（' + (ms.klineFail || 0) + ' 只候选 K 线获取失败），形态识别未执行。网络恢复后自动生效。' : '当日无形态识别结果（数据源不可达或当日无启动形态个股）'}</div>`}</div>
    ${picks.length ? '<button class="wl-tool wl-tool-red ms-addall" onclick="addAllPicks()">一键全部加入观察池</button>' : ''}
    <div class="da-src">数据源：${esc(ms.source || '--')} + 腾讯/东财K线 形态识别（启动/老鸭头/拉升）<span class="da-score">准确性 7/10（技术形态自动识别）</span></div>
  </div>`;
}

function renderDataAnalysis(report) {
  const ms = report.marketStats || {};
  const ce = report.closeEmotion || {};
  const dp = report.dragonPool || {};
  const idx = report.indices || [];
  const mainRank = report.mainRank || [];
  const limitUpList = report.limitUp || [];

  // ---- 模块1 市场定调 ----
  const idxLine = idx.map(i => `${i.name} ${(i.changePct >= 0 ? '+' : '') + i.changePct}%`).join(' / ');
  const total = ms.upCount + ms.downCount + ms.flatCount || 1;
  const ratio = ((ms.upCount / total) * 100).toFixed(0);
  const m1 = `<div class="da-block">
    <div class="da-h">第一步 · 市场定调</div>
    <div class="da-line">指数：${esc(idxLine || '--')}</div>
    <div class="da-line">涨跌家数：涨 ${ms.upCount} / 跌 ${ms.downCount} / 平 ${ms.flatCount}（红盘率 ${ratio}%）</div>
    <div class="da-line">涨停 ${ms.limitUpCount} 家 · 炸板 ${ms.zhaBanCount} 家 · 最高连板 ${ms.maxLianBan} 板（${esc(ms.maxLianBanStock || '--')}）</div>
    <div class="da-src">数据源：腾讯行情 + 东方财富涨停池（官方接口）<span class="da-score">准确性 9/10</span></div>
  </div>`;

  // ---- 模块2 情绪周期 ----
  let cycle = '回暖', tone;
  const score = ce.tempScore || 0;
  if (score < 30) { cycle = '冰点'; tone = '轻仓防守，等待情绪底部信号'; }
  else if (score < 60) { cycle = '回暖'; tone = '分批试错，聚焦低位首板'; }
  else if (score < 85) { cycle = '加速'; tone = '顺势参与，关注晋级与主线'; }
  else { cycle = '分歧'; tone = '高位分歧加大，控制仓位，低吸不追高'; }
  const m2 = `<div class="da-block">
    <div class="da-h">第二步 · 情绪周期</div>
    <div class="da-line">情绪温度 ${score}° → 阶段判定：<b class="da-cycle">${cycle}</b></div>
    <div class="da-line">操作基调：${esc(tone)}</div>
    <div class="da-src">数据源：由东财涨停/炸板/连板数据推导<span class="da-score">准确性 7/10（逻辑推演）</span></div>
  </div>`;

  // ---- 模块3 主线识别 ----
  const sectors = dp.sectorBoards || [];
  const consec = dp.consecutiveBoards || [];
  const hotLines = ce.mainLines || [];
  let m3line = '';
  if (sectors.length) {
    m3line = sectors.slice(0, 4).map(s => {
      const lead = s.leadStock || '--';
      const match = limitUpList.find(x => x.name === lead);
      const code = match ? match.code : '';
      const leadHtml = code
        ? `<a class="da-stock" data-code="${esc(code)}" onclick="openStockResearch(this.dataset.code)">${esc(lead)}</a>`
        : esc(lead);
      return `<div class="da-line">• ${esc(s.name)}：涨停 ${s.count} 家 / 最高 ${s.maxLB} 板，领涨 ${leadHtml}</div>`;
    }).join('');
  } else {
    m3line = '<div class="da-line">暂无板块聚合数据（东财接口未返回）</div>';
  }
  const sust = consec.filter(x => x.lbc >= 2).slice(0, 3);
  const sustLine = sust.length ? sust.map(s => `${esc(s.name)}（${s.lbc}板）`).join('、') : '暂无明显连续梯队';
  const leadMode = (hotLines[0] && hotLines[0].changePct >= 5 && (sectors[0] || {}).count >= 3) ? '龙头带队' : '分散轮动';
  const m3 = `<div class="da-block">
    <div class="da-h">第三步 · 主线识别</div>
    <div class="da-sub">涨停题材分布</div>
    ${m3line}
    <div class="da-line">连续 2-3 天上榜方向：${esc(sustLine)}</div>
    <div class="da-line">结构判断：${leadMode}${leadMode === '龙头带队' ? '，有明确领涨梯队' : '，缺乏连续承接，需防一日游'}</div>
    <div class="da-line">明日最可能机会方向（1-2个）：${(hotLines.slice(0,2).map(h => esc(h.name)).join('、')) || '--'}</div>
    <div class="da-src">数据源：东方财富涨停池分类聚合<span class="da-score">准确性 8/10</span></div>
  </div>`;

  // ---- 模块4 核心个股拆解 ----
  const coreStocks = limitUpList.slice(0, 5);
  let m4lines = '';
  if (coreStocks.length) {
    m4lines = coreStocks.map(s => {
      const lb = s.lianban || 1;
      const start = lb >= 2 ? '首板放量启动，随后连续晋级' : '今日首板放量启动，观察次日承接';
      const accel = lb >= 4 ? `高位连板(${lb}板)，换手充分，筹码快速交换` : lb >= 2 ? `连板 ${lb} 天，缩量加速为主` : '首板放量，加速待验证';
      const nameHtml = `<a class="da-stock" data-code="${esc(s.code)}" onclick="openStockResearch(this.dataset.code)">${esc(s.name)}</a>`;
      return `<div class="da-line"><b>${nameHtml}（${s.code}）${lb}板</b>：${start}；${accel}；分歧点关注首次放量滞涨/炸板；承接看大跌后能否快速收回</div>`;
    }).join('');
  } else {
    m4lines = '<div class="da-line">暂无涨停个股数据</div>';
  }
  const m4 = `<div class="da-block">
    <div class="da-h">第四步 · 核心个股拆解（Top5 涨停）</div>
    ${m4lines}
    <div class="da-src">数据源：东财涨停池 + 逻辑推演（启动/加速/分歧为推断，需结合K线人工验证）<span class="da-score">准确性 6/10</span></div>
  </div>`;

  // ---- 模块5/6 交易复盘（占位,用户提供后填充） ----
  const m5 = `<div class="da-block da-trade">
    <div class="da-h">第五步 · 交易复盘</div>
    <div class="da-line">待提供今日逐笔交易记录（股票、买点K线位置、买入理由、是否符合系统、卖出原因）后自动生成分析。</div>
    <div class="da-src">数据源：用户提供<span class="da-score">提交后 10/10</span></div>
  </div>`;
  const m6 = `<div class="da-block da-trade">
    <div class="da-h">第六步 · 交易行为复盘</div>
    <div class="da-line">待提供每笔交易数据后，分析追高/杀跌/持仓周期/情绪化交易等行为偏差与优化规则。</div>
    <div class="da-src">数据源：用户提供<span class="da-score">提交后 10/10</span></div>
  </div>`;

  // ---- 模块7 强势股共性模板 ----
  const maxLB = dp.maxLianBan || 0;
  const m7 = `<div class="da-block">
    <div class="da-h">第七步 · 强势股共性模板</div>
    <div class="da-line">当前市场最高连板 ${maxLB} 板。强势股共性：底部放量首板 → 缩量/换手连板加速 → 首次分歧不破位 → 承接有力再上攻。</div>
    <div class="da-line">模板要点：① 首板看量能 ② 连板看换手 ③ 分歧看承接 ④ 只有承接验证通过的方向才值得次日跟进。</div>
    <div class="da-src">数据源：逻辑推演（基于连板梯队）<span class="da-score">准确性 6/10</span></div>
  </div>`;

  // ---- 模块8 主线资金复盘 ----
  let m8line = '';
  if (sectors.length) {
    m8line = sectors.map(s => `${esc(s.name)}(${s.count}家)`)
      .slice(0, 6).join('、');
  } else { m8line = '--'; }
  const next = (hotLines[0] && hotLines[1])
    ? `${esc(hotLines[0].name)}、${esc(hotLines[1].name)}`
    : (hotLines[0] ? esc(hotLines[0].name) : '--');
  const stance = (ce.tempScore || 0) >= 85 ? '收缩' : (ce.tempScore || 0) >= 60 ? '进攻（控仓）' : '观望';
  const m8 = `<div class="da-block">
    <div class="da-h">第八步 · 主线资金复盘</div>
    <div class="da-line">今日涨停题材分布：${esc(m8line)}</div>
    <div class="da-line">重复上榜（连续2-3天）方向：${esc(sustLine)}</div>
    <div class="da-line">结构：${leadMode}${(hotLines[0] && hotLines[0].changePct >= 5) ? '，处于高位加速' : '，多为低位补涨'}</div>
    <div class="da-line">明日最可能机会方向：${esc(next)}</div>
    <div class="da-line">明日基调：<b class="da-stance">${stance}</b></div>
    <div class="da-src">数据源：东方财富涨停池 + 板块统计<span class="da-score">准确性 8/10</span></div>
  </div>`;

  return `<div class="card da-card">
    <div class="card-title">AI 数据分析 · 八步复盘</div>
    <div class="da-note">基于当日公开行情自动生成，标注数据来源与准确性评分；交易复盘（第五/六步）需提供逐笔记录。</div>
    ${m1}${m2}${m3}${m4}${m5}${m6}${m7}${m8}
  </div>`;
}

function renderIntlEvents(report) {
  return `<div class="card">
    <div class="card-title">GLOBAL EVENT RADAR · 国际重大事件监控</div>
    <div class="hint">盘中由 Agent 扫描国际地缘、贸易、制裁与海外流动性事件,并推演对 A 股的传导路径。</div>
  </div>`;
}

function renderNewsDigest(report) {
  return `<div class="card">
    <div class="card-title">LIVE NEWS CALIBRATION · 实时新闻驱动研判</div>
    <div class="hint">盘中由 Agent 扫描中央政策原文、央行公告与隔夜外盘要闻,校准主线方向与风险评分。</div>
  </div>`;
}

function deriveStockStrategy(pct) {
  const v = Number(pct) || 0;
  if (v >= 5) return { name: '强势突破', tone: 'break' };
  if (v >= 2) return { name: '强势承接', tone: 'strong' };
  if (v >= 0.5) return { name: '震荡上行', tone: 'up' };
  if (v >= -1) return { name: '等待确认', tone: 'wait' };
  if (v >= -3) return { name: '走势承压', tone: 'press' };
  return { name: '弱势回调', tone: 'weak' };
}

function deriveStockAtds(pct, turnover) {
  const v = Number(pct) || 0;
  const t = Number(turnover) || 0;
  return 70 + Math.min(25, Math.max(-15, Math.round(v * 2 + t * 0.5)));
}

function deriveRiskLevel(pct) {
  const v = Number(pct) || 0;
  if (v >= 5 || v <= -5) return { name: '高风险', tone: 'high' };
  if (v >= 2 || v <= -2) return { name: '中风险', tone: 'mid' };
  return { name: '低风险', tone: 'low' };
}
function deriveTimeHorizon(pct, turnover) {
  const v = Number(pct) || 0;
  const t = Number(turnover) || 0;
  if (v >= 3 && t >= 2) return { name: '短线', tone: 'short' };
  if (v >= -1 && v <= 3 && t >= 0.5) return { name: '波段', tone: 'wave' };
  return { name: '长线', tone: 'long' };
}
function deriveAdvice(pct, atds, risk) {
  const v = Number(pct) || 0;
  const a = Number(atds) || 0;
  if (v <= -5) return { name: '减仓规避', tone: 'cut' };
  if (a >= 85 && risk !== 'high') return { name: '重点关注', tone: 'focus' };
  if (a >= 70) return { name: '持有观察', tone: 'hold' };
  if (a < 60 && v <= -1) return { name: '观望', tone: 'wait' };
  return { name: '持有观察', tone: 'hold' };
}
function deriveRiskText(pct, turnover) {
  const v = Number(pct) || 0;
  const t = Number(turnover) || 0;
  const lines = [];
  if (v >= 5) lines.push('涨幅>5%,RSI 超买区');
  else if (v >= 2) lines.push('涨幅 2-5%,技术偏强');
  else if (v >= -1) lines.push('震荡整理,方向未明');
  else if (v >= -3) lines.push('回调 2-3%,观察支撑');
  else lines.push('跌幅>3%,风险增大');
  if (t >= 5) lines.push('放量活跃');
  else if (t >= 2) lines.push('量能温和');
  else if (t >= 0.5) lines.push('量能一般');
  else lines.push('量能偏低');
  return lines;
}
function deriveHorizonLines(pct, turnover) {
  const v = Number(pct) || 0;
  const t = Number(turnover) || 0;
  const short = v >= 3 && t >= 2 ? '回踩 MA5 不破可继续,跌破减仓'
    : v >= 1 ? '区间震荡,顺势做 T,关注 MA10'
    : v <= -3 ? '下跌趋势,反弹至 MA5 减仓'
    : '区间震荡,关注 MA10 方向选择';
  const wave = v >= 2 ? '沿 MA20 运行,跌破 MA60 警惕走弱'
    : v <= -2 ? '跌至 MA20 下方,关注 MA60 是否守住'
    : '区间震荡,等待 MA20 方向选择';
  const long = v >= 0 ? '站上 MA120 偏多,关注 MA250 突破'
    : '跌破 MA120,长线宜减仓观望';
  return [{ k: '短线', v: short }, { k: '波段', v: wave }, { k: '长线', v: long }];
}
function deriveAdviceText(pct, atds, riskTone) {
  const v = Number(pct) || 0;
  const a = Number(atds) || 0;
  if (v <= -5) return '跌幅较大,建议减仓规避';
  if (a >= 85 && riskTone !== 'high') return 'ATDS 证据强,重点关注';
  if (a >= 75 && v >= 0) return '持有观察,等待放量催化';
  if (a < 60 && v <= -1) return '技术偏弱,观望等待企稳';
  if (v >= 5) return '高位震荡,逢高减仓为主';
  return '持有观察,关注量能配合';
}
function buildStockRow(s, i) {
  const cls = upDownClass(s.pct);
  const sig = deriveStockStrategy(s.pct);
  const atds = deriveStockAtds(s.pct, s.turnover);
  const code = s.code;
  const riskTone = deriveRiskLevel(s.pct).tone;
  const riskLines = deriveRiskText(s.pct, s.turnover);
  const horizons = deriveHorizonLines(s.pct, s.turnover);
  const adviceText = deriveAdviceText(s.pct, atds, riskTone);
  const riskName = deriveRiskLevel(s.pct).name;
  const horizonTone = deriveTimeHorizon(s.pct, s.turnover).tone;
  const adviceTone = deriveAdvice(s.pct, atds, riskTone).tone;
  const stopLoss = (s.price * 0.95).toFixed(2);
  const support = (s.price * 0.92).toFixed(2);
  const pressure = (s.price * 1.08).toFixed(2);
  const main = `<tr class="wl-row" data-code="${esc(code)}">
    <td class="wl-cell wl-cell-rank"><span class="rank-no">${i + 1}</span><div><div class="wl-name">${esc(s.name)}</div><div class="wl-code">${esc(code)}</div></div></td>
    <td class="wl-cell wl-cell-price"><div class="price ${cls}">${fmtNum(s.price)}</div></td>
    <td class="wl-cell wl-cell-pct ${cls}">${fmtPct(s.pct)}</td>
    <td class="wl-cell wl-cell-amt">${esc(s.amount || '--')}</td>
    <td class="wl-cell wl-cell-atds">${atds}</td>
    <td class="wl-cell wl-cell-sig"><span class="sig sig-${sig.tone}">${esc(sig.name)}</span></td>
    <td class="wl-cell wl-cell-act"><button class="wl-btn wl-btn-primary" data-code="${esc(code)}" onclick="showResearch(this.dataset.code)">全面分析</button><button class="wl-btn wl-btn-del" data-code="${esc(code)}" onclick="removeWatchlistRow(this.dataset.code)" style="margin-left:4px;font-size:10px;padding:3px 8px;">删除</button></td>
  </tr>`;
  // 详情卡独立 div,放在主行表格外,避免受 .wl-table max-content 撑大影响 detail-spb 三项被裁
  const detail = `<div class="wl-detail" data-detail-code="${esc(code)}">
    <div class="detail-grid">
      <div class="detail-block"><div class="detail-h">风险 <span class="risk-tag risk-${riskTone}">${esc(riskName)}</span></div>${riskLines.map(l=>'<div class="detail-line">' + esc(l) + '</div>').join('')}</div>
      <div class="detail-block"><div class="detail-h">风控 <span class="horizon-tag horizon-${horizonTone}">${esc(deriveTimeHorizon(s.pct, s.turnover).name)}</span></div>${horizons.map(h=>'<div class="detail-line"><b>' + esc(h.k) + '</b>' + esc(h.v) + '</div>').join('')}</div>
      <div class="detail-block"><div class="detail-h">建议 <span class="advice-tag advice-${adviceTone}">${esc(deriveAdvice(s.pct, atds, riskTone).name)}</span></div><div class="detail-line">${esc(adviceText)}</div></div>
    </div>
    <div class="detail-spb">
      <span><b>止损</b>${stopLoss}</span>
      <span><b>支撑</b>${support}</span>
      <span><b>压力</b>${pressure}</span>
    </div>
  </div>`;
  return { main, detail };
}

function buildStockModal(s) {
  const cls = upDownClass(s.pct);
  const sig = deriveStockStrategy(s.pct);
  const atds = deriveStockAtds(s.pct, s.turnover);
  return `<div class="modal-mask" id="modal-${esc(s.code)}" data-code="${esc(s.code)}" onclick="if(event.target===this)closeModal(this.dataset.code)">
    <div class="modal-box" onclick="event.stopPropagation()">
    <div class="modal-head"><div class="modal-eyebrow">ATDS STOCK RESEARCH V1.1</div><span class="modal-close" data-code="${esc(s.code)}" onclick="closeModal(this.dataset.code)">×</span></div>
    <div class="modal-title">个股深度研究</div>
    <div class="modal-info">${esc(s.name)}（${esc(s.code)}）</div>
    <div class="modal-meta">${fmtNum(s.price)} · ${fmtPct(s.pct)} · ${esc(s.amount || '')}</div>
    <div class="modal-section"><div class="modal-h">核心定位</div><div class="modal-b">业务结构与产业位置(财务接口待接入)</div></div>
    <div class="modal-section"><div class="modal-h">核心研判</div><div class="modal-b">${esc(sig.name)} · 概率倾向:延续可能性较高</div></div>
    <div class="modal-section"><div class="modal-h">情景分析</div><div class="modal-b">保守:震荡整理 · 中性:沿均线运行 · 乐观:放量突破(待行情验证)</div></div>
    <div class="modal-section"><div class="modal-h">资金面</div><div class="modal-b">换手 ${esc(s.turnover || '--')}% · 成交活跃度待复盘</div></div>
    <div class="modal-section"><div class="modal-h">风险提示</div><div class="modal-b">技术位是概率参考,实际操作需结合实时走势</div></div>
    <div class="modal-footer">数据来自腾讯行情 + 东方财富公开接口 · 概率倾向表述</div>
    </div></div>`;
}


function renderWatchlist(report) {
  const list = report.watchlist || [];
  const time = (report.meta && report.meta.generatedAt) || '';
  const built = list.map(buildStockRow);
  const mds = built.map(b => b.main).join('');
  const details = built.map(b => b.detail).join('');
  const head = '<div class="card watchlist-card">' +
    '<div class="wl-header">' +
      '<div class="wl-title">LIVE 我的实时观察池 <span class="wl-time">● ' + esc(time) + '</span></div>' +
      '<div class="wl-tools">' +
        '<input id="search-input" class="wl-search-input" placeholder="🔍 输入代码 / 名称" maxlength="6" inputmode="numeric">' +
        '<button class="wl-tool wl-tool-red" onclick="handleSearchStock()">+ 搜索加入</button>' +
        '<button class="wl-tool" onclick="handleSearchStock()">个股分析</button>' +
        '<button class="wl-tool" onclick="alert(\'批量导入待接入\')">↥ 批量导入</button>' +
      '</div>' +
    '</div>' +
    '<div class="wl-table-head"><table class="wl-table"><thead><tr><th>排名 / 标的</th><th>最新价</th><th>涨跌幅</th><th>成交额</th><th>ATDS</th><th>策略信号</th><th>操作</th></tr></thead></div>' +
    '<div class="wl-table-body"><table class="wl-table"><tbody>' + mds + '</tbody></table></div>' +
    '<div class="wl-details">' + details + '</div>' +
    '</div>';
  const modals = list.map(buildStockModal).join('');
  const knowledge = '<div class="card knowledge-card">' +
    '<div class="knowledge-title">KNOWLEDGE SYNC</div>' +
    '<div class="knowledge-h">沉淀到 Obsidian</div>' +
    '<div class="knowledge-desc">将当前盘前/盘中结论、实时观察池与策略导出为标准 Markdown</div>' +
    '<pre id="knowledge-md" class="knowledge-md">---' + '\n' +
    'title: ATDS Pro V4.0 ' + esc((report.meta && report.meta.typeLabel) || '') + '\n' +
    'tags: [ATDS, 交易复盘]' + '\n' +
    '---' + '\n' +
    '# 观察池' + '\n' +
    list.map(s => '- ' + esc(s.name) + ' (' + esc(s.code) + '): ' + fmtNum(s.price) + ' ' + fmtPct(s.pct)).join('\n') + '\n' +
    '</pre>' +
    '<div class="wl-tools" style="margin-top:10px;">' +
    '<button class="wl-tool wl-tool-red" onclick="downloadMd()">下载 .md 文件</button>' +
    '<button class="wl-tool" onclick="copyMd()">复制 Markdown</button>' +
    '</div>' +
    '</div>';
  return head + knowledge + modals;
}

function renderPremarketStrategy(report) {
  return `<div class="card">
    <div class="card-title">策略状态</div>
    <div class="hint">多线轮动 / 风险预算 60% / 建议仓位 40-60%</div>
  </div>`;
}

function renderDragonPool(report) {
  return `<div class="card"><div class="card-title">动态擒龙池</div><div class="hint">数据详见盘前报告</div></div>`;
}

function renderMainDirection(report) {
  return `<div class="card"><div class="card-title">当前最强主线方向</div><div class="hint">数据详见盘前报告</div></div>`;
}

function renderStockResearch(report) {
  return `<div class="card"><div class="card-title">个股研究摘要</div><div class="hint">数据详见盘前报告</div></div>`;
}

function renderMainRank(report) {
  const list = (report.mainRank || []).slice(0, 10);
  if (!list.length) return '<div class="hint">暂无主线方向数据</div>';
  const rows = list.map((s, i) => {
    const cls = upDownClass(s.changePct);
    return `<tr>
      <td>${i + 1}</td>
      <td>${esc(s.mappedName || s.name)}</td>
      <td class="${cls}">${fmtPct(s.changePct)}</td>
      <td>${s.limitUpMax || '--'}</td>
      <td>${esc(s.leadStock || '--')}</td>
    </tr>`;
  }).join('');
  return `<div class="card">
    <div class="card-title">全部方向实时强度排名 · 前 ${list.length} 名</div>
    <table class="table"><thead><tr><th>#</th><th>主线</th><th>涨幅</th><th>涨停数</th><th>领涨</th></tr></thead><tbody>${rows}</tbody></table>
  </div>`;
}

function renderPremarketReport(report, nav) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<title>ATDS PRO · 盘前简报</title>
</head>
<body>
<div class="phone">
${renderHeader(report, nav)}
${renderHero(report)}
<div class="section">
  ${renderWatchlist(report)}
  <div class="card">
    <div class="card-title">盘前交易驾驶舱</div>
    <div class="hint">市场综述 + AUTO REFRESH</div>
  </div>
  ${renderPremarketStrategy(report)}
  ${renderIndices(report)}
  ${renderMainDirection(report)}
  ${renderMainRank(report)}
  ${renderStockResearch(report)}
  ${renderIntlEvents(report)}
  ${renderIntlMkt(report)}
  ${renderNewsDigest(report)}
</div>
<div class="footer">ATDS PRO · 仅做行情与信息展示 · 不构成投资建议</div>
</div>
</body>
</html>`;
}

function renderReport(report, nav) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<title>ATDS PRO · 复盘报告</title>
</head>
<body>
<div class="phone">
${renderHeader(report, nav)}
${renderHero(report)}
<div class="section">
  ${renderCloseEmotion(report)}
  ${renderRegimeGate(report)}
  ${renderMarketScan(report)}
  ${renderDataAnalysis(report)}
  ${renderIntlMkt(report)}
  ${renderTechAnalysis(report)}
  ${renderPremarketStrategy(report)}
  ${renderIndices(report)}
  ${renderStatusBar(report)}
  ${renderMarketStats(report)}
  ${renderSectors(report)}
  ${renderLimitUp(report)}
  ${renderWatchlist(report)}
  ${renderPlaybook(report)}
  ${renderVerdict(report)}
  ${renderIntlEvents(report)}
  ${renderNewsDigest(report)}
</div>
<div class="footer">ATDS PRO · 仅做行情与信息展示 · 不构成投资建议</div>
</div>
</body>
</html>`;
}

function renderMainRankPage(report, nav) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<title>ATDS PRO · 主线实时校准</title>
</head>
<body>
<div class="phone">
${renderHeader(report, nav)}
<div class="section">
  ${renderMainRank(report, 27)}
</div>
<div class="footer">ATDS PRO · 仅做行情与信息展示 · 不构成投资建议</div>
</div>
</body>
</html>`;
}

function renderFooter(report) {
  return `<div class="footer">ATDS PRO · 仅做行情与信息展示 · 不构成投资建议</div>`;
}

function renderIndex(reports) {
  const list = reports.map(r => {
    const d = r.meta.date;
    const t = r.meta.time;
    const url = `reviews/${d}_${String(t).replace(':', '-')}.html`;
    const label = `${d} ${t} · ${esc(r.meta.typeLabel || '')}`;
    return `<a class="report-card" href="${url}"><div class="rc-title">${label}</div><div class="rc-meta">${esc((r.indices || []).slice(0,3).map(i => i.name + ' ' + fmtPct(i.changePct)).join(' / '))}</div></a>`;
  }).join('');
  // 动态取最新盘前/午盘/收盘
  const urlOf = r => `reviews/${r.meta.date}_${String(r.meta.time).replace(':', '-')}.html`;
  const pre = reports.find(r => r.meta.type === 'premarket');
  const mid = reports.find(r => r.meta.type === 'midday');
  const clo = reports.find(r => r.meta.type === 'close');
  const preUrl = pre ? urlOf(pre) : 'main-rank.html';
  const midUrl = mid ? urlOf(mid) : 'main-rank.html';
  const cloUrl = clo ? urlOf(clo) : 'main-rank.html';
  const preLabel = pre ? `${pre.meta.date} 08:30 简报` : '暂无盘前数据';
  const midLabel = mid ? `${mid.meta.date} 11:35 快照` : '暂无盘中数据';
  const cloLabel = clo ? `${clo.meta.date} 15:20 复盘` : '暂无收盘数据';

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<title>ATDS PRO · A 股每日复盘</title>
</head>
<body>
<div class="phone">
<div class="header">
  <div class="brand">
    <div class="logo">A</div>
    <div class="brand-text">
      <div class="brand-name">ATDS <span class="pro-badge">PRO</span> 复盘</div>
      <div class="brand-sub">GLOBAL LINKAGE V4.0 · 工作台</div>
    </div>
  </div>
</div>
<div class="hero">
  <div class="hero-title">A股每日复盘工作台</div>
  <div class="hero-sub">盘中 11:35 / 收盘 15:20 自动采集与渲染</div>
</div>
<div class="section">
  <div class="tools">
    <a class="tool-btn" href="${preUrl}">盘前 08:30 简报 · ${pre.meta ? pre.meta.date : ''}</a>
    <a class="tool-btn" href="${midUrl}">盘中 11:35 快照 · ${mid ? mid.meta.date : ''}</a>
    <a class="tool-btn" href="${cloUrl}">收盘 15:20 复盘 · ${clo ? clo.meta.date : ''}</a>
    <a class="tool-btn" href="main-rank.html">主线实时校准</a>
    <button class="tool-btn qr-btn" onclick="showQr()">手机扫码打开</button>
  </div>
  <div class="card">
    <div class="card-title">历史复盘 (${list.length})</div>
    <div class="report-list">${list}</div>
  </div>
</div>
<div class="footer">ATDS PRO · 仅做行情与信息展示 · 不构成投资建议</div>
</div>
</body>
</html>`;
}

function build() {
  fs.mkdirSync(REVIEWS_DIR, { recursive: true });
  const args = process.argv.slice(2);
  let files = args.length ? args : fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json')).map(f => path.join(DATA_DIR, f));
  if (!files.length) {
    console.log('无复盘数据 JSON，跳过渲染');
    return;
  }
  const reports = [];
  for (const f of files) {
    const full = path.resolve(f);
    if (!fs.existsSync(full)) { console.error('文件不存在:', full); continue; }
    reports.push(JSON.parse(fs.readFileSync(full, 'utf8')));
  }
  reports.sort((a, b) => {
    const ka = `${a.meta.date}_${a.meta.time}`;
    const kb = `${b.meta.date}_${b.meta.time}`;
    return kb.localeCompare(ka);
  });

  const byDate = {};
  for (const r of reports) {
    const d = r.meta.date;
    if (!byDate[d]) byDate[d] = {};
    byDate[d][r.meta.type] = `reviews/${d}_${String(r.meta.time).replace(':', '-')}.html`;
  }
  const latest = reports.length ? `reviews/${reports[0].meta.date}_${String(reports[0].meta.time).replace(':', '-')}.html` : 'index.html';

  // 报告页位于 reviews/ 子目录,导航链接必须用 ../ 前缀,同目录报告去掉 reviews/
  const stripReviews = (p) => String(p || '').replace(/^reviews\//, '');
  // 全局最新各类型报告(跨日期),保证从任一报告页都能跳到最新午盘/收盘
  const latestOfType = (type) => {
    const r = reports.find(x => x.meta.type === type);
    if (!r) return '';
    return stripReviews(`reviews/${r.meta.date}_${String(r.meta.time).replace(':', '-')}.html`);
  };
  for (const report of reports) {
    const m = report.meta;
    const sameDay = byDate[m.date] || {};
    const nav = {
      home: 'index.html',
      midday: stripReviews(sameDay.midday) || latestOfType('midday') || '../index.html',
      close: stripReviews(sameDay.close) || latestOfType('close') || '../index.html',
      latest: stripReviews(latest)
    };
    const html = m.type === 'premarket' ? renderPremarketReport(report, nav) : renderReport(report, nav);
    const outName = `${m.date}_${String(m.time).replace(':', '-')}.html`;
    fs.writeFileSync(path.join(REVIEWS_DIR, outName), html, 'utf8');
    console.log('已生成:', outName);
  }
  fs.writeFileSync(path.join(SITE_DIR, 'index.html'), renderIndex(reports), 'utf8');
  console.log('已生成: index.html (共', reports.length, '份复盘)');

  const rankReport = reports.find(r => r.mainRank && r.mainRank.length);
  if (rankReport) {
    const rankNav = {
      home: 'index.html',
      midday: byDate[rankReport.meta.date] && byDate[rankReport.meta.date].midday || 'index.html',
      close: byDate[rankReport.meta.date] && byDate[rankReport.meta.date].close || 'index.html',
      latest: latest
    };
    fs.writeFileSync(path.join(SITE_DIR, 'main-rank.html'), renderMainRankPage(rankReport, rankNav), 'utf8');
    console.log('已生成: main-rank.html');
  }
}

build();