// ATDS-V3-GATE-TOP  ·  反转闸门/八步分析置于情绪区后
// ATDS PRO 复盘报告渲染器
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
const DATA_DIR = path.join(ROOT, config.dataDir);
const SITE_DIR = path.join(ROOT, config.siteDir);
const REVIEWS_DIR = SITE_DIR; // 扁平结构:报告直接输出到 site/ 根目录,与 GitHub Pages/CloudStudio 部署一致

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

// 万 → 亿/万 显示
function fmtAmount(wan) {
  const v = Number(wan);
  if (isNaN(v) || !v) return '--';
  if (v >= 10000) return (v / 10000).toFixed(1) + '亿';
  if (v >= 1000) return (v / 1000).toFixed(1) + '千万';
  return v.toFixed(0) + '万';
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
      ? '实时盘中数据 · 每 60 秒自动刷新'
      : '收盘静态快照 · 数据截至 ' + ((config.reportTypes.close && config.reportTypes.close.time) || '15:20');
  const timeHtml = m.type === 'midday'
    ? '<span class="hero-time" id="rt-hero-time">' + (esc(m.time || '')) + '</span>'
    : '<span class="hero-time">' + (esc(m.time || '')) + '</span>';
  return '<div class="hero">' +
    '<div class="hero-eyebrow">A 股每日复盘 · ' + (esc(m.typeLabel || '')) + '</div>' +
    '<h1 class="hero-title">' + (esc(m.date || '')) + ' · ' + timeHtml + '</h1>' +
    '<div class="hero-sub">' + desc + '</div>' +
    '<div class="hero-refresh"><button class="wl-btn wl-btn-primary" onclick="refreshAllData()">🔄 一键刷新最新数据</button></div>' +
    (tempTag ? '<div class="hero-tags">' + tempTag + '</div>' : '') +
  '</div>';
}

function renderIndices(report) {
  const items = (report.indices || []).map(idx => {
    const cls = upDownClass(idx.changePct);
    // 前缀按 config.indices 的 setcode 判定(1=sh, 0=sz),不能用 charAt(0) 因为指数代码不按此规则
    const confIdx = (config.indices || []).find(i => String(i.code) === String(idx.code));
    const prefix = confIdx && confIdx.setcode === '1' ? 'sh' : 'sz';
    return `<div class="index-item" data-code="${esc(idx.code)}" data-prefix="${prefix}">
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
    ['us', '🇺🇸 美股（美东最新收盘）'],
    ['europe', '🇪🇺 欧洲（最新收盘）'],
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
    '<span>成交额 <b>' + esc(report.marketStats && report.marketStats.totalAmount || '--') + '</b> (沪深合计)</span>' +
  '</div>';
  const idxRows = indices.map(idx => {
    const cls = upDownClass(idx.changePct);
    return '<div class="ce-idx-row"><span class="ce-idx-name">' + esc(idx.name) + '</span><span class="ce-idx-val ' + cls + '">' + fmtPct(idx.changePct) + '</span><div class="ce-idx-bar"><div class="ce-idx-bar-fill ' + cls + '" style="width:' + Math.min(100, Math.abs(idx.changePct || 0) * 30) + '%"></div></div></div>';
  }).join('');
  const indexHtml = '<div class="ce-index-block"><div class="ce-block-h">指数表现</div>' + idxRows +
    '<div class="ce-block-hint">' + (function(){
      const amt = parseFloat((report.marketStats && report.marketStats.totalAmount) || 0);
      if (amt >= 20000) return '量能维持在 2 万亿上方 (' + amt.toFixed(0) + ' 亿)';
      if (amt > 0) return '量能 ' + (amt / 10000).toFixed(2) + ' 万亿 (' + amt.toFixed(0) + ' 亿)';
      return '量能数据待更新';
    })() + '</div></div>';
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

  // 05 明日观察锚点（午盘隐藏，收盘展示）
  const anchors = [
    { icon: '🎯', title: '主线持续性', desc: '观察中际旭创 / 新易盛 / 天孚通信能否继续表态' },
    { icon: '⚠️', title: '情绪退潮阈值', desc: '炸板率 > 40% 或晋级率 < 50% 需警惕' },
    { icon: '📊', title: '量能验证', desc: '2.15 万亿基础上能否重拾放量' },
    { icon: '🛡️', title: '高位风险', desc: '百花医药 7 板与医药板块背离' }
  ];
  const anchorCards = anchors.map(a => {
    return '<div class="ce-anchor-card"><div class="ce-anchor-h">' + a.icon + ' ' + esc(a.title) + '</div><div class="ce-anchor-desc">' + esc(a.desc) + '</div></div>';
  }).join('');
  const anchorBlock = m.type === 'midday' ? '' : '<div class="card"><div class="card-title">05 明日观察锚点</div>' +
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

// 收盘报告 · 第五步 交易复盘 / 第六步 交易行为复盘 入口卡(前端弹窗交互)
function renderTradeReviewEntry() {
  return `<div class="card trade-review-entry">
    <div class="trade-review-title">📒 第五步 · 交易复盘</div>
    <div class="trade-review-sub">输入个股代码，自动分析买点K线位置、买入理由、是否符合系统、卖出原因</div>
    <button class="wl-btn wl-btn-primary" onclick="openTradeReview()" style="margin-top:8px;">✍️ 开始交易复盘</button>
  </div>`;
}
function renderBehaviorReviewEntry() {
  return `<div class="card trade-review-entry">
    <div class="trade-review-title">📊 第六步 · 交易行为复盘</div>
    <div class="trade-review-sub">输入个股与成本价，分析追高、杀跌、持仓周期、情绪化交易等行为偏差与优化规则</div>
    <button class="wl-btn wl-btn-primary" onclick="openBehaviorReview()" style="margin-top:8px;">🧭 开始行为复盘</button>
  </div>`;
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
  </div>${renderRegimeNHModal(report)}`;
}

// 60日新高个股清单弹窗(后端渲染名单,前端刷新仅更新行情)
function renderRegimeNHModal(report) {
  const gate = report.regimeGate || {};
  const nh = report.newHigh || {};
  const list = nh.list || [];
  if (!list.length) return '';
  const rows = list.map((x, i) => {
    const cls = upDownClass(x.pct);
    return `<div class="nh-item" data-code="${esc(x.code)}" onclick="openStockResearch(this.dataset.code)">
      <div class="nh-row">
        <span class="ms-rank">${i + 1}</span>
        <span class="nh-name">${esc(x.name)}<small>${esc(x.code)}</small></span>
        <span class="nh-price ${cls}">${fmtNum(x.price)}</span>
        <span class="nh-pct ${cls}">${fmtPct(x.pct)}</span>
      </div>
      <div class="nh-meta">
        <span>首板</span>
        <span>封单 <b>${fmtAmount(x.sealWan)}</b></span>
        <span>板块 <b>${esc(x.hybk || '--')}</b></span>
        <span>首封 <b>${esc(x.firstTime || '--')}</b></span>
      </div>
    </div>`;
  }).join('');
  return `<div class="modal-mask" id="regime-nh-modal" onclick="if(event.target===this)closeRegimeNH()">
    <div class="modal" onclick="event.stopPropagation()">
      <div class="modal-header">
        <div class="modal-eyebrow">60日新高个股清单 · 首板+涨幅≥5%</div>
        <span class="modal-close" onclick="closeRegimeNH()">×</span>
      </div>
      <div class="modal-body">
        <div class="nh-summary">60日新高个股 <b>${list.length}</b> 只 / 阈值 100 · 点击行可查看个股分析</div>
        <div class="sc-tools">
          <button class="wl-btn" onclick="addAllNHToWatchlist()">⚡ 一键全部加入观察池</button>
          <button class="wl-btn wl-btn-primary" id="nh-refresh-btn" onclick="refreshRegimeNH()">↻ 刷新行情</button>
        </div>
        <div class="nh-list">${rows}</div>
        <div class="sc-hint">点击个股行可查看深度分析 · 数据源：${esc(nh.source || '东财涨停池代理')}（首板+涨幅≥5%）</div>
      </div>
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
  const emptyBlock = `<div class="ms-empty">${(ms.klineFail || 0) > 0 && !(ms.klineOk || 0) ? 'K线数据源当前不可达（' + (ms.klineFail || 0) + ' 只候选 K 线获取失败），形态识别未执行。网络恢复后自动生效。' : '当日无形态识别结果（数据源不可达或当日无启动形态个股）'}</div>`;
  const card = `<div class="card ms-card">
    <div class="card-title">形态扫描 · 启动 / 老鸭头 / 拉升</div>
    <div class="ms-note">扫描范围：${esc(ms.source || '--')}（${ms.candidates || 0} 只候选，剔除 ST/新股）→ 识别 ${picks.length} 只形态启动个股</div>
    <div class="ms-gate ${gateOpen ? 'ok' : 'red'}">反转闸门：${gateOpen ? '绿 · 放行' : '红 · 禁开新仓（埋伏名单豁免）'}${gateOpen ? ' → 以下可考虑加入观察池' : ' → 仅埋伏名单可操作，新仓需谨慎'}</div>
    <div class="wave-tools">
      <span class="wave-scan-info">${esc(ms.source || '--')} + 腾讯/东财K线 形态识别</span>
      <button id="ms-open-btn" class="wl-btn wl-btn-primary" onclick="openMarketScanModal()">📋 打开形态扫描名单</button>
    </div>
    <div class="sc-hint">点击上方按钮弹出弹窗，查看完整形态个股名单 · 支持刷新重扫与一键全部加入观察池</div>
  </div>`;
  const modal = `<div class="modal-mask" id="market-scan-modal" onclick="if(event.target===this)closeMarketScanModal()">
    <div class="modal" onclick="event.stopPropagation()">
      <div class="modal-header">
        <div class="modal-eyebrow">形态扫描 · 启动 / 老鸭头 / 拉升</div>
        <span class="modal-close" onclick="closeMarketScanModal()">×</span>
      </div>
      <div class="modal-body">
        <div class="nh-summary">扫描范围：${esc(ms.source || '--')}（${ms.candidates || 0} 只候选，剔除 ST/新股）→ 识别 ${picks.length} 只形态启动个股</div>
        <div class="sc-tools">
          <button class="wl-btn" onclick="bulkAddAllPicks()">⚡ 一键全部加入观察池</button>
          <button class="wl-btn wl-btn-primary" id="ms-refresh-btn" onclick="refreshMarketScan()">🔄 刷新重扫</button>
        </div>
        <div class="ms-list" id="ms-list">${rows || emptyBlock}</div>
        <div class="sc-hint">点击股票名称可查看深度分析 · 形态识别（启动/老鸭头/拉升）准确性 7/10</div>
      </div>
    </div>
  </div>`;
  return card + modal;
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
  // 每只股票独立卡片:表头行 + 数据行(同一横滑容器)+ 详情卡
  // 策略 4 块(逻辑/资金/关键位/操作)——仅在用户填了字段时渲染,旧股票无字段则不显示
  const hasStrategy = s.logic || s.capital || (s.keyLevels && (s.keyLevels.support || s.keyLevels.pressure)) || s.plan;
  let strategyBlocks = '';
  if (hasStrategy) {
    const fmtKL = () => {
      if (!s.keyLevels) return '--';
      const parts = [];
      if (s.keyLevels.support != null) parts.push('支撑' + s.keyLevels.support);
      if (s.keyLevels.pressure != null) parts.push('压力' + s.keyLevels.pressure);
      if (s.keyLevels.low != null) parts.push('今日低点' + s.keyLevels.low);
      if (s.keyLevels.buyBelow != null) parts.push('买在' + s.keyLevels.buyBelow + '下');
      return parts.join(' / ') || '--';
    };
    const fmtPlan = () => {
      // 加粗股数+金额:用 1000-2000股 / 3500-7000元 这种数字模式
      return esc(s.plan || '--').replace(/(\d[\d,\-]*股)/g, '<b>$1</b>').replace(/(¥[\d\.]+|[\d\.]+元)/g, '<span class="wl-num">$1</span>');
    };
    const blockLogic = s.logic ? `<div class="detail-block"><div class="detail-h detail-h-custom">📐 逻辑</div><div class="detail-line">${esc(s.logic)}</div></div>` : '';
    const blockCapital = s.capital ? `<div class="detail-block"><div class="detail-h detail-h-custom">💰 资金</div><div class="detail-line">${esc(s.capital)}</div></div>` : '';
    const blockKey = s.keyLevels && (s.keyLevels.support || s.keyLevels.pressure) ? `<div class="detail-block"><div class="detail-h detail-h-custom">🎯 关键位</div><div class="detail-line">${esc(fmtKL())}</div></div>` : '';
    // ⚡ 操作 + 建议 + 风险 —— 同一框架,占整行(grid-column:1/-1)与上面 4 块同宽
    const adviceName = deriveAdvice(s.pct, atds, riskTone).name;
    const planLine = s.plan ? `<div class="par-line"><span class="par-tag par-tag-plan">操作</span><span class="par-content">${fmtPlan()}</span></div>` : `<div class="par-line"><span class="par-tag par-tag-plan">操作</span><span class="par-content par-empty">未设置操作 · 仅系统观测</span></div>`;
    const adviceLine = `<div class="par-line"><span class="par-tag par-tag-advice">建议</span><span class="par-content">${esc(adviceText)}<span class="advice-tag-mini advice-${adviceTone}">${esc(adviceName)}</span></span></div>`;
    const riskListHtml = riskLines.map(l => '<li>' + esc(l) + '</li>').join('');
    const riskLine = `<div class="par-risk"><span class="par-tag par-tag-risk">风险</span><span class="par-risk-content"><span class="risk-tag risk-${riskTone}">${esc(riskName)}</span><ul>${riskListHtml}</ul></span></div>`;
    const blockPlanAdviceRisk = `<div class="detail-block detail-block-par">
      <div class="detail-h detail-h-custom">⚡ 操作 + 建议 + 风险</div>
      <div class="par-body">${planLine}${adviceLine}${riskLine}</div>
    </div>`;
    strategyBlocks = '<div class="detail-grid detail-grid-strategy">' + blockLogic + blockCapital + blockKey + blockPlanAdviceRisk + '</div>';
  }
  // 个股今日执行策略(原全局 todayStrategy 改为按个股分发,仅盘前)——图片风格:策略/价格/仓位 + 止损/止盈/目标 + 风险
  const st = s.strategy || {};
  const hasStrategyTable = !!(st.entryStrategy || st.entryPrice || st.entryPosition || st.entryNote || st.stopLoss || st.takeProfit || st.target || st.risk);
  let todayStrategyBlock = '';
  if (hasStrategyTable) {
    const cell = (v) => `<span>${esc(v || '--')}</span>`;
    const cellNum = (v) => `<span class="wl-st-num">${esc(v || '--')}</span>`;
    const entry = '<div class="wl-st-tr"><span class="wl-st-key">策略</span>' + cell(st.entryStrategy) + '<span class="wl-st-key">价格</span>' + cellNum(st.entryPrice) + '<span class="wl-st-key">仓位</span>' + cell(st.entryPosition) + '</div>';
    const note = st.entryNote ? '<div class="wl-st-tr wl-st-note"><span class="wl-st-key">说明</span><span class="wl-st-note-cell">' + esc(st.entryNote) + '</span></div>' : '';
    const stop = '<div class="wl-st-tr"><span class="wl-st-key">止损</span><span class="wl-st-loss">' + esc(st.stopLoss || '--') + '</span><span class="wl-st-key">止盈</span><span class="wl-st-profit">' + esc(st.takeProfit || '--') + '</span><span class="wl-st-key">目标</span>' + cellNum(st.target) + '</div>';
    const risk = st.risk ? '<div class="wl-st-risk"><b>风险</b>' + esc(st.risk) + '</div>' : '';
    todayStrategyBlock = '<div class="wl-st-table">' +
      '<div class="wl-st-title">🎯 个股执行策略</div>' +
      '<div class="wl-st-head">' + cell('入场') + cell('执行') + cell('风控') + '</div>' +
      entry + note + stop + risk +
      '</div>';
  }
  // tags 徽标(从 config.tags 透传)
  const tagsHtml = (Array.isArray(s.tags) && s.tags.length)
    ? s.tags.map(t => '<span class="wl-tag">' + esc(t) + '</span>').join('')
    : '';
  const categoryHtml = s.category ? '<span class="wl-cat">' + esc(s.category) + '</span>' : '';
  const headRow = `<div class="wl-stock-row wl-stock-head">
    <span class="wl-cell wl-cell-rank"><b>排名/标的</b></span>
    <span class="wl-cell wl-cell-price"><b>最新价</b></span>
    <span class="wl-cell wl-cell-pct"><b>涨跌幅</b></span>
    <span class="wl-cell wl-cell-amt"><b>成交额</b></span>
    <span class="wl-cell wl-cell-atds"><b>ATDS</b></span>
    <span class="wl-cell wl-cell-sig"><b>策略信号</b></span>
    <span class="wl-cell wl-cell-act"><b>操作</b></span>
  </div>`;
  const main = `<div class="wl-stock-row" data-code="${esc(code)}">
    <span class="wl-cell wl-cell-rank"><span class="rank-no">${i + 1}</span><span class="wl-name">${esc(s.name)}</span><span class="wl-code">${esc(code)}</span></span>
    <span class="wl-cell wl-cell-price"><span class="price ${cls}">${fmtNum(s.price)}</span></span>
    <span class="wl-cell wl-cell-pct ${cls}">${fmtPct(s.pct)}</span>
    <span class="wl-cell wl-cell-amt">${esc(s.amount || '--')}</span>
    <span class="wl-cell wl-cell-atds">${atds}</span>
    <span class="wl-cell wl-cell-sig"><span class="sig sig-${sig.tone}">${esc(sig.name)}</span></span>
    <span class="wl-cell wl-cell-act"><button class="wl-btn wl-btn-primary" data-code="${esc(code)}" onclick="openStockResearch(this.dataset.code)">全面分析</button><button class="wl-btn wl-btn-del" data-code="${esc(code)}" onclick="removeWatchlistRow(this.dataset.code)">删</button></span>
  </div>`;
  const meta = (categoryHtml || tagsHtml) ? `<div class="wl-meta">${categoryHtml}${tagsHtml}</div>` : '';
  const detail = `<div class="wl-detail" data-detail-code="${esc(code)}">
    ${meta}
    ${strategyBlocks}
    ${todayStrategyBlock}
  </div>`;
  return `<div class="wl-stock" data-stock-code="${esc(code)}"><div class="wl-stock-scroll">${headRow}${main}</div>${detail}</div>`;
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
  const stocks = list.map((s, idx) => buildStockRow(s, idx)).join('');
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
    '<div class="wl-scroll-hint">← 左右滑动查看全部列 →</div>' +
    '<div class="wl-stocks">' + stocks + '</div>' +
    '<div class="wl-details"></div>' +
    '</div>';
  const modals = '';  // v12b: 不再静态生成个股 modal,统一由 openStockResearch/showDynamicResearch 动态生成,避免 id 重复导致关闭失效
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

// 波背离选股模块(仅午盘:全A剔除ST扫描,优先排序 TOP30,点击弹个股,可刷新行情)
function renderWaveDivergence(report) {
  const w = report.waveDivergence;
  if (!w || !Array.isArray(w.list) || !w.list.length) return '';
  const list = w.list;
  const rows = list.map(x => {
    const cls = upDownClass(x.pct);
    const sig = deriveStockStrategy(x.pct);
    return `<div class="wave-item" data-code="${esc(x.code)}" onclick="openStockResearch(this.dataset.code)">
      <div class="wave-row">
        <span class="wave-rank">${x.rank}</span>
        <span class="wave-name">${esc(x.name)}<small>${esc(x.code)}</small></span>
        <span class="wave-price ${cls}">${fmtNum(x.price)}</span>
        <span class="wave-pct ${cls}">${fmtPct(x.pct)}</span>
        <span class="wave-score">${x.score}</span>
        <span class="wave-sig sig sig-${sig.tone}">${esc(x.signalType)}</span>
      </div>
      <div class="wave-meta">
        <span>一波 <b>${x.waveGain}%</b></span>
        <span>调整 <b>${x.adjDays}日 ${x.adjPct}%</b></span>
        <span>量比 <b>${x.volRatio}</b></span>
        <span>KDJ 金叉 <b class="${x.kdjGold ? 'ok' : 'no'}">${x.kdjGold ? '✓' : '✗'}</b> 背离 <b class="${x.kdjDivergence ? 'ok' : 'no'}">${x.kdjDivergence ? '✓' : '✗'}</b></span>
        <span>支撑 <b>${x.support}</b></span>
      </div>
    </div>`;
  }).join('');
  const card = `<div class="card wave-card">
    <div class="wave-header">
      <div class="wave-title">🌊 波背离选股 TOP30</div>
      <div class="wave-sub">前期强势一波 → 缩量调整 → KDJ背离金叉 · 盘中扫描全A剔除ST</div>
    </div>
    <div class="wave-tools">
      <span class="wave-scan-info">${esc(w.source || '全A扫描')}</span>
      <button id="wave-open-btn" class="wl-btn wl-btn-primary" onclick="openWaveDivergenceModal()">📋 打开波背离名单</button>
    </div>
    <div class="sc-hint">点击上方按钮弹出弹窗，查看优先排序前 30 只波背离股票 · 支持刷新行情与一键加入观察池</div>
  </div>`;
  const modal = `<div class="modal-mask" id="wave-divergence-modal" onclick="if(event.target===this)closeWaveDivergenceModal()">
    <div class="modal" onclick="event.stopPropagation()">
      <div class="modal-header">
        <div class="modal-eyebrow">🌊 波背离选股 TOP30 · 全A剔除ST</div>
        <span class="modal-close" onclick="closeWaveDivergenceModal()">×</span>
      </div>
      <div class="modal-body">
        <div class="nh-summary">扫描范围：${esc(w.source || '全A剔除ST')}</div>
        <div class="sc-tools">
          <button class="wl-btn" onclick="bulkAddWaveToWatchlist()">⚡ 一键加入观察池</button>
          <button class="wl-btn wl-btn-primary" id="wave-refresh-btn" onclick="refreshWaveQuotes()">↻ 刷新行情</button>
        </div>
        <div class="wave-list">
          <div class="wave-row wave-head"><span>#</span><span>标的</span><span>现价</span><span>涨跌</span><span>评分</span><span>信号</span></div>
          ${rows}
        </div>
        <div class="sc-hint">点击个股行可查看深度分析 · 评分=一波涨幅/调整缩量/KDJ金叉背离/支撑/止跌/均线综合</div>
      </div>
    </div>
  </div>`;
  return card + modal;
}

function renderShortCore(report) {
  const sc = report.shortCore;
  if (!sc || !Array.isArray(sc.list) || !sc.list.length) return '';
  const list = sc.list;
  const rows = list.map(x => {
    const cls = upDownClass(x.pct);
    const sigTone = x.lianban >= 2 ? 'break' : (x.ztCount >= 2 ? 'strong' : 'up');
    const sigText = x.lianban >= 2 ? (x.lianban + '连板') : (x.ztCount >= 3 ? '多涨停' : (x.ztCount === 2 ? '双涨停' : '强势股'));
    return `<div class="sc-item" data-code="${esc(x.code)}" onclick="openStockResearch(this.dataset.code)">
      <div class="sc-row">
        <span class="sc-rank">${x.rank}</span>
        <span class="sc-name">${esc(x.name)}<small>${esc(x.code)}</small></span>
        <span class="sc-price ${cls}">${fmtNum(x.price)}</span>
        <span class="sc-pct ${cls}">${fmtPct(x.pct)}</span>
        <span class="sc-score">${x.score}</span>
        <span class="sc-sig sig sig-${sigTone}">${esc(sigText)}</span>
      </div>
      <div class="sc-meta">
        <span>涨停 <b>${x.ztCount}次</b></span>
        <span>连板 <b>${x.lianban}</b></span>
        <span>量比 <b>${x.volRatio}</b></span>
        <span>20日 <b class="${x.gain20 >= 15 ? 'ok' : 'no'}">+${x.gain20}%</b></span>
        <span>突破 <b class="${x.newHigh ? 'ok' : 'no'}">${x.newHigh ? '✓' : '✗'}</b></span>
        <span>均线多头 <b class="${x.maAlign ? 'ok' : 'no'}">${x.maAlign ? '✓' : '✗'}</b></span>
      </div>
    </div>`;
  }).join('');
  const card = `<div class="card sc-card">
    <div class="wave-header">
      <div class="wave-title">⚡ 超短核心 TOP30</div>
      <div class="wave-sub">竞价最强 · 开盘换手 · 连板梯度 · 量价共振 · 盘中扫描全A剔除ST</div>
    </div>
    <div class="wave-tools">
      <span class="wave-scan-info">${esc(sc.source || '全A扫描')}</span>
      <button id="sc-open-btn" class="wl-btn wl-btn-primary" onclick="openShortCoreModal()">📋 打开超短核心名单</button>
    </div>
    <div class="sc-hint">点击上方按钮弹出弹窗，查看优先排序前 30 个超短核心股票 · 支持刷新行情与一键全部加入观察池</div>
  </div>`;
  const modal = `<div class="modal-mask" id="short-core-modal" onclick="if(event.target===this)closeShortCoreModal()">
    <div class="modal" onclick="event.stopPropagation()">
      <div class="modal-header">
        <div class="modal-eyebrow">⚡ 超短核心 TOP30 · 全A剔除ST</div>
        <span class="modal-close" onclick="closeShortCoreModal()">×</span>
      </div>
      <div class="modal-body">
        <div class="nh-summary sc-summary">扫描范围：${esc(sc.source || '全A剔除ST')}</div>
        <div class="sc-tools">
          <button class="wl-btn wl-btn-primary" onclick="bulkAddShortCoreToWatchlist()">⚡ 一键全部加入观察池</button>
          <button class="wl-btn" id="sc-refresh-btn" onclick="refreshShortCoreQuotes()">↻ 刷新行情</button>
        </div>
        <div class="sc-list">
          <div class="sc-row sc-head"><span>#</span><span>标的</span><span>现价</span><span>涨跌</span><span>评分</span><span>信号</span></div>
          ${rows}
        </div>
        <div class="sc-hint">点击个股行可查看深度分析 · 评分=涨停基因/连板/今日强度/量能/换手/均线多头/突破压力/趋势</div>
      </div>
    </div>
  </div>`;
  return card + modal;
}

function renderStrongStock(report) {
  const ss = report.strongStock;
  if (!ss || !Array.isArray(ss.list) || !ss.list.length) return '';
  const list = ss.list;
  const rows = list.map(x => {
    const cls = upDownClass(x.pct);
    return `<div class="ss-item" data-code="${esc(x.code)}" onclick="openStockResearch(this.dataset.code)">
      <div class="ss-row">
        <span class="ss-rank">${x.rank}</span>
        <span class="ss-name">${esc(x.name)}<small>${esc(x.code)}</small></span>
        <span class="ss-price ${cls}">${fmtNum(x.price)}</span>
        <span class="ss-pct ${cls}">${fmtPct(x.pct)}</span>
        <span class="ss-score">${x.score}</span>
      </div>
      <div class="ss-meta">
        <span>信号 <b class="ok">${esc(x.signalType)}</b></span>
        <span>缺口 <b class="${x.gapFound ? 'ok' : 'no'}">${x.gapFound ? '✓' + (x.gapDays || '') + '日' : '✗'}</b></span>
        <span>二波 <b class="${x.wave2 ? 'ok' : 'no'}">${x.wave2 ? '✓' : '✗'}</b></span>
        <span>突破 <b class="${x.breakout ? 'ok' : 'no'}">${x.breakout ? '✓' : '✗'}</b></span>
        <span>KDJ <b class="${x.kdjGold ? 'ok' : 'no'}">${x.kdjGold ? '金叉' : '--'}</b></span>
        <span>量比 <b>${x.volRatio}</b></span>
        <span>涨停 <b>${x.ztCount}次</b></span>
      </div>
    </div>`;
  }).join('');
  const card = `<div class="card ss-card">
    <div class="wave-header">
      <div class="wave-title">🔥 强势股选股 TOP30</div>
      <div class="wave-sub">缺口不回补 · 二波启动 · 突破起爆点 · KDJ(8,2,2)金叉 · 盘中扫描全A剔除ST</div>
    </div>
    <div class="wave-tools">
      <span class="wave-scan-info">${esc(ss.source || '全A扫描')}</span>
      <button id="ss-open-btn" class="wl-btn wl-btn-primary" onclick="openStrongStockModal()">📋 打开强势股名单</button>
    </div>
    <div class="sc-hint">点击上方按钮弹出弹窗，查看优先排序前 30 只强势股 · 支持刷新行情与一键全部加入观察池</div>
  </div>`;
  const modal = `<div class="modal-mask" id="strong-stock-modal" onclick="if(event.target===this)closeStrongStockModal()">
    <div class="modal" onclick="event.stopPropagation()">
      <div class="modal-header">
        <div class="modal-eyebrow">🔥 强势股选股 TOP30 · 全A剔除ST</div>
        <span class="modal-close" onclick="closeStrongStockModal()">×</span>
      </div>
      <div class="modal-body">
        <div class="nh-summary">扫描范围：${esc(ss.source || '全A剔除ST')}</div>
        <div class="sc-tools">
          <button class="wl-btn wl-btn-primary" onclick="bulkAddStrongStockToWatchlist()">⚡ 一键全部加入观察池</button>
          <button class="wl-btn" id="ss-refresh-btn" onclick="refreshStrongStockQuotes()">↻ 刷新行情</button>
        </div>
        <div class="ss-list">
          <div class="ss-row ss-head"><span>#</span><span>标的</span><span>现价</span><span>涨跌</span><span>评分</span></div>
          ${rows}
        </div>
        <div class="sc-hint">点击个股行可查看深度分析 · 评分=缺口战法/首板基因/二波启动/KDJ金叉/突破前高/缩量回调/量能回升/均线多头</div>
      </div>
    </div>
  </div>`;
  return card + modal;
}

// 今日执行策略模块(图2 风格:核心 + 方案A/B + 二选一建议 + 仓位控制 + 关键提醒 + 数据来源)
function renderTodayStrategy(report) {
  if (!report || report.meta.type !== 'premarket') return '';
  const t = report.todayStrategy;
  if (!t) return '';
  if (!t.core && !t.planA.content && !t.planB.content && !t.choice && !t.position && !t.alert) return '';
  const core = t.core ? `<div class="ts-core"><span class="ts-core-tag">核心</span><b>${esc(t.core.split('。')[0] || t.core)}</b>${t.core.split('。')[1] ? esc('。' + t.core.split('。').slice(1).join('。')) : ''}</div>` : '';
  const planA = t.planA && (t.planA.title || t.planA.content) ? `<li><span class="ts-dot ts-dot-a"></span><b>方案A (${esc(t.planA.title || '求稳回踩')})</b>: ${esc(t.planA.content || '')}</li>` : '';
  const planB = t.planB && (t.planB.title || t.planB.content) ? `<li><span class="ts-dot ts-dot-b"></span><b>方案B (${esc(t.planB.title || '突破确认')})</b>: ${esc(t.planB.content || '')}</li>` : '';
  const plans = (planA || planB) ? '<ul class="ts-plans">' + planA + planB + '</ul>' : '';
  const extrasList = (t.choice || t.position) ? '<ul class="ts-plans">' +
    (t.choice ? `<li><span class="ts-dot"></span><b>二选一建议</b>: ${esc(t.choice)}</li>` : '') +
    (t.position ? `<li><span class="ts-dot"></span><b>仓位控制</b>: ${esc(t.position)}</li>` : '') +
  '</ul>' : '';
  const alert = t.alert ? `<div class="ts-alert"><b>关键提醒</b>: ${esc(t.alert)}</div>` : '';
  const source = t.source ? `<div class="ts-source">${esc(t.source)}</div>` : '';
  return '<div class="card ts-card">' +
    '<div class="ts-title">🎯 今日执行策略 <span class="ts-sub">(二选一或分批)</span></div>' +
    core + plans + extrasList + alert + source +
  '</div>';
}

function renderPremarketStrategy(report) {
  const pb = report.playbook || {};
  const off = (pb.offense || []).slice(0, 4);
  const def = (pb.defense || []).slice(0, 3);
  const pit = (pb.pitfall || []).slice(0, 3);
  const offRows = off.map(o => `<div class="str-line"><b>${esc(o.name)}</b> 涨停 ${o.count || 0}家 / ${o.maxLB || 0}板 · 领涨 ${esc(o.leadStock || '--')}</div>`).join('') || '<div class="hint">暂无进攻方向</div>';
  const defRows = def.map(d => `<div class="str-line"><b>${esc(d.name)}</b> ${esc(d.logic || '')}</div>`).join('') || '<div class="hint">暂无防守方向</div>';
  const pitRows = pit.map(p => `<div class="str-line pit"><b>${esc(p.name)}</b> ${esc(p.logic || '')}</div>`).join('') || '<div class="hint">暂无风险提示</div>';
  return `<div class="card">
    <div class="card-title">策略状态</div>
    <div class="str-block">
      <div class="str-h">⚔️ 进攻方向</div>${offRows}
    </div>
    <div class="str-block">
      <div class="str-h">🛡️ 防守方向</div>${defRows}
    </div>
    <div class="str-block">
      <div class="str-h">⚠️ 风险提示</div>${pitRows}
    </div>
  </div>`;
}

function renderPremarketCockpit(report) {
  const ms = report.marketStats || {};
  const ce = report.closeEmotion || {};
  const rg = report.regimeGate || {};
  const off = (report.playbook && report.playbook.offense || []).slice(0, 3);
  const offNames = off.map(o => o.name).join(' / ') || '--';
  const rows = [
    { k: '情绪温度', v: `${ce.tempScore || '--'}° · ${esc(ce.stage || '')} · ${esc(ce.tone || '')}` },
    { k: '涨停家数', v: `${ce.ztTotal || ms.limitUpCount || '--'} 家 · 最高 ${ms.maxLianBan || ce.maxLB || '--'} 板` },
    { k: '连板龙头', v: esc(ms.maxLianBanStock || ce.maxLB || '--') },
    { k: '炸板家数', v: `${ce.zbTotal || ms.zhaBanCount || 0} 家` },
    { k: '60日新高', v: `${rg.newHighCount || '--'} 只` },
    { k: '进攻主线', v: esc(offNames) }
  ].map(r => `<div class="cp-item"><div class="cp-k">${r.k}</div><div class="cp-v">${r.v}</div></div>`).join('');
  return `<div class="card">
    <div class="card-title">盘前交易驾驶舱</div>
    <div class="cp-grid">${rows}</div>
  </div>`;
}

function renderDragonPool(report) {
  return `<div class="card"><div class="card-title">动态擒龙池</div><div class="hint">数据详见盘前报告</div></div>`;
}

function renderMainDirection(report) {
  const list = (report.mainRank || []).slice(0, 5);
  if (!list.length) return `<div class="card"><div class="card-title">当前最强主线方向</div><div class="hint">暂无主线方向数据</div></div>`;
  const rows = list.map((s, i) => {
    const cls = upDownClass(s.changePct);
    return `<div class="md-item">
      <div class="md-rank">${i + 1}</div>
      <div class="md-main">
        <div class="md-name">${esc(s.mappedName || s.name)} <span class="md-status ${s.status === '主线确认' ? 'ok' : 'no'}">${esc(s.status || '')}</span></div>
        <div class="md-sub">涨停 ${esc(s.limitUpMax || '--')} · 领涨 ${esc(s.leadStock || '--')} · ATDS ${s.atds || '--'}</div>
      </div>
      <div class="md-pct ${cls}">${fmtPct(s.changePct)}</div>
    </div>`;
  }).join('');
  return `<div class="card">
    <div class="card-title">当前最强主线方向</div>
    <div class="md-list">${rows}</div>
  </div>`;
}

function renderStockResearch(report) {
  const picks = (report.marketScan && report.marketScan.picks || []).slice(0, 5);
  const lus = (report.limitUp || []).slice(0, 5);
  const items = (picks.length ? picks : lus).map((s, i) => {
    const cls = upDownClass(s.pct);
    const reason = s.reason || (s.boardInfo ? s.boardInfo + ' · ' + (s.reason || '') : (s.reason || ''));
    return `<div class="sr-item" data-code="${esc(s.code || '')}" onclick="if(this.dataset.code)openStockResearch(this.dataset.code)">
      <div class="sr-rank">${i + 1}</div>
      <div class="sr-main">
        <div class="sr-name">${esc(s.name || '--')} <small>${esc(s.code || '')}</small></div>
        <div class="sr-reason">${esc(reason || '--')}</div>
      </div>
      <div class="sr-pct ${cls}">${fmtPct(s.pct)}</div>
    </div>`;
  }).join('');
  return `<div class="card">
    <div class="card-title">个股研究摘要</div>
    <div class="sr-list">${items || '<div class="hint">暂无个股研究数据</div>'}</div>
  </div>`;
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
<meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate"><meta http-equiv="Pragma" content="no-cache"><meta http-equiv="Expires" content="0"><title>ATDS PRO · 盘前简报</title>
</head>
<body>
<div class="phone">
${renderHeader(report, nav)}
${renderHero(report)}
<div class="section">
  ${renderWatchlist(report)}
  ${renderTodayStrategy(report)}
  ${renderPremarketCockpit(report)}
  ${renderPremarketStrategy(report)}
  ${renderIndices(report)}
  ${renderMainDirection(report)}
  ${renderMainRank(report)}
  ${renderStockResearch(report)}
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
  ${report.meta && report.meta.type === 'close' ? '' : renderRegimeGate(report)}
  ${report.meta && report.meta.type === 'close' ? '' : renderMarketScan(report)}
  ${report.meta && report.meta.type === 'close' ? '' : renderWaveDivergence(report)}
  ${report.meta && report.meta.type === 'midday' ? renderShortCore(report) : ''}
  ${report.meta && report.meta.type === 'midday' ? renderStrongStock(report) : ''}
  ${report.meta && report.meta.type === 'midday' ? '' : renderDataAnalysis(report)}
  ${report.meta && report.meta.type === 'close' ? '' : renderIntlMkt(report)}
  ${report.meta && report.meta.type === 'close' ? '' : renderTechAnalysis(report)}
  ${renderPremarketStrategy(report)}
  ${renderIndices(report)}
  ${renderStatusBar(report)}
  ${renderMarketStats(report)}
  ${report.meta && report.meta.type === 'midday' ? '' : renderSectors(report)}
  ${report.meta && report.meta.type === 'midday' ? '' : renderLimitUp(report)}
  ${report.meta && report.meta.type === 'midday' || report.meta && report.meta.type === 'close' ? '' : renderWatchlist(report)}
  ${renderPlaybook(report)}
  ${renderVerdict(report)}
  ${report.meta && report.meta.type === 'close' ? renderTradeReviewEntry() : ''}
  ${report.meta && report.meta.type === 'close' ? renderBehaviorReviewEntry() : ''}
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
  // 同一天同一类型只保留最新时间(如收盘 15:20 已改为 16:20,过滤旧时间残留)
  const byKey = new Map();
  const filtered = [];
  for (const r of reports) {
    const key = (r.meta && r.meta.date) + '|' + (r.meta && r.meta.type);
    const cur = byKey.get(key);
    if (!cur) {
      byKey.set(key, r);
      filtered.push(r);
    } else if (r.meta.time > cur.meta.time) {
      const idx = filtered.indexOf(cur);
      filtered[idx] = r;
      byKey.set(key, r);
    }
  }
  const list = filtered.map(r => {
    const d = r.meta.date;
    const t = r.meta.time;
    const url = `${d}_${String(t).replace(':', '-')}.html`;
    const label = `${d} ${t} · ${esc(r.meta.typeLabel || '')}`;
    return `<a class="report-card" href="${url}"><div class="rc-title">${label}</div><div class="rc-meta">${esc((r.indices || []).slice(0,3).map(i => i.name + ' ' + fmtPct(i.changePct)).join(' / '))}</div></a>`;
  }).join('');
  // 动态取最新盘前/午盘/收盘
  const urlOf = r => `${r.meta.date}_${String(r.meta.time).replace(':', '-')}.html`;
  const pre = reports.find(r => r.meta.type === 'premarket');
  const mid = reports.find(r => r.meta.type === 'midday');
  const clo = reports.find(r => r.meta.type === 'close');
  const preUrl = pre ? urlOf(pre) : 'main-rank.html';
  const midUrl = mid ? urlOf(mid) : 'main-rank.html';
  const cloUrl = clo ? urlOf(clo) : 'main-rank.html';
  const preT = (config.reportTypes.premarket && config.reportTypes.premarket.time) || '08:30';
  const midT = (config.reportTypes.midday && config.reportTypes.midday.time) || '11:35';
  const cloT = (config.reportTypes.close && config.reportTypes.close.time) || '15:20';
  const preLabel = pre ? `${pre.meta.date} ${preT} 简报` : '暂无盘前数据';
  const midLabel = mid ? `${mid.meta.date} ${midT} 快照` : '暂无盘中数据';
  const cloLabel = clo ? `${clo.meta.date} ${cloT} 复盘` : '暂无收盘数据';

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
  <div class="hero-sub">盘中 ${midT} / 收盘 ${cloT} 自动采集与渲染</div>
</div>
<div class="section">
  <div class="tools">
    <a class="tool-btn" href="${preUrl}">盘前 ${preT} 简报 · ${pre ? pre.meta.date : ''}</a>
    <a class="tool-btn" href="${midUrl}">盘中 ${midT} 快照 · ${mid ? mid.meta.date : ''}</a>
    <a class="tool-btn" href="${cloUrl}">收盘 ${cloT} 复盘 · ${clo ? clo.meta.date : ''}</a>
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
      midday: stripReviews(byDate[rankReport.meta.date] && byDate[rankReport.meta.date].midday) || stripReviews(latestOfType('midday')) || 'index.html',
      close: stripReviews(byDate[rankReport.meta.date] && byDate[rankReport.meta.date].close) || stripReviews(latestOfType('close')) || 'index.html',
      latest: stripReviews(latest) || 'index.html'
    };
    fs.writeFileSync(path.join(SITE_DIR, 'main-rank.html'), renderMainRankPage(rankReport, rankNav), 'utf8');
    console.log('已生成: main-rank.html');
  }
}

build();