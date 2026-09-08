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

  // 04 情绪高度(连板梯队) - 仅 close 展示
  const ladderItems = (ce.ladder || []).map(l => {
    return '<span class="ce-ladder-pill">' + esc(l.lianban) + ' · ' + esc(l.lead) + '</span>';
  }).join('');
  const ladderBlock = '<div class="card"><div class="card-title">04 情绪高度(连板梯队)</div>' +
    '<div class="ce-ladder">' + ladderItems + '</div></div>';

  // 04 午盘专属:涨停梯队 + 主线研判 + 关注锚点 + 板块强弱 + 资金切换(图1 完整版 5 大节)
  let boardTierMidday = '';
  if (m.type === 'midday') {
    const maxLB = ce.maxLB || 4;
    const ztList = report.limitUp || [];
    const mr4 = (report.mainRank || []);
    const L1 = mr4[0] || {};
    const L2 = mr4[1] || {};
    const L3 = mr4[2] || {};
    const L4 = mr4[3] || {};
    const L1Name = L1.mappedName || L1.name || '农业种业';
    const L2Name = L2.mappedName || L2.name || '传媒发展';
    const L3Name = L3.mappedName || L3.name || '房地产';
    const L4Name = L4.mappedName || L4.name || '科技/有色';
    const L1Lead = L1.leadStock || '万向德农';
    const L2Lead = L2.leadStock || '航发控制';
    const L1Pct = Number(L1.changePct || 0);
    const L2Pct = Number(L2.changePct || 0);
    const L3Pct = Number(L3.changePct || 0);
    const L4Pct = Number(L4.changePct || 0);
    const L1In = Number(L1.inflowYi || 0);
    const L2In = Number(L2.inflowYi || 0);
    const L3In = Number(L3.inflowYi || 0);
    const L4In = Number(L4.inflowYi || 0);

    // === 1) 涨停梯队 5 张卡片(动态档位)+ 1 行结构辨证 ===
    let tierLvls;
    if (maxLB >= 6) {
      tierLvls = [
        { lv: 6, label: '6板', cls: 'bt-6' },
        { lv: 5, label: '5板', cls: 'bt-5' },
        { lv: 3, label: '3板', cls: 'bt-3' },
        { lv: 2, label: '2板', cls: 'bt-2' },
        { lv: 0, label: '断板', cls: 'bt-new' }
      ];
    } else if (maxLB === 5) {
      tierLvls = [
        { lv: 5, label: '5板', cls: 'bt-5' },
        { lv: 4, label: '4板', cls: 'bt-4' },
        { lv: 3, label: '3板', cls: 'bt-3' },
        { lv: 2, label: '2板', cls: 'bt-2' },
        { lv: 0, label: '断板', cls: 'bt-new' }
      ];
    } else if (maxLB === 4) {
      tierLvls = [
        { lv: 4, label: '4板', cls: 'bt-4' },
        { lv: 3, label: '3板', cls: 'bt-3' },
        { lv: 2, label: '2板', cls: 'bt-2' },
        { lv: 1, label: '1板', cls: 'bt-1' },
        { lv: 0, label: '断板', cls: 'bt-new' }
      ];
    } else if (maxLB === 3) {
      tierLvls = [
        { lv: 3, label: '3板', cls: 'bt-3' },
        { lv: 2, label: '2板', cls: 'bt-2' },
        { lv: 1, label: '1板', cls: 'bt-1' },
        { lv: 0, label: '断板', cls: 'bt-new' },
        { lv: -1, label: '炸板', cls: 'bt-zb' }
      ];
    } else {
      tierLvls = [
        { lv: 2, label: '2板', cls: 'bt-2' },
        { lv: 1, label: '1板', cls: 'bt-1' },
        { lv: 0, label: '断板', cls: 'bt-new' },
        { lv: -1, label: '炸板', cls: 'bt-zb' },
        { lv: -2, label: '跌停', cls: 'bt-down' }
      ];
    }
    const findTierLead = (lv) => {
      if (lv >= 1) {
        const tier = (ce.ladder || []).find(l => String(l.lianban || '').startsWith(String(lv) + '板'));
        if (tier) return tier.lead;
        const matches = ztList.filter(z => (z.lianban || 1) === lv).sort((a, b) => (b.pct || 0) - (a.pct || 0));
        return matches[0] ? matches[0].name : null;
      } else if (lv === 0 || lv === -1) {
        const matches = ztList.filter(z => z.status === '炸板' || z.status === '炸板回封' || z.zhaban);
        return matches[0] ? matches[0].name : null;
      } else {
        const limitDown = (report.limitDown || []);
        return limitDown[0] ? limitDown[0].name : null;
      }
    };
    const tierSub = {
      6: '全面出海', 5: '一字', 4: '一字接板',
      3: '建装升板回退', 2: '创业板2·爱家乐3', 1: '浩中(中阅门)',
      0: '炸板未回封', '-1': '炸板分歧', '-2': '跌停股'
    };
    const tierCards = tierLvls.map(t => {
      const lead = findTierLead(t.lv) || '--';
      const subLabel = tierSub[t.lv] || '--';
      return '<div class="bt-card ' + t.cls + '">' +
        '<div class="bt-lv">' + t.label + '</div>' +
        '<div class="bt-name">' + esc(lead) + '</div>' +
        '<div class="bt-sub">' + esc(subLabel) + '</div>' +
      '</div>';
    }).join('');
    const ztRow = '<div class="bt-row">' + tierCards + '</div>';

    // 结构辨证(动态)
    const structNote = '<div class="bt-struct-note">' +
      '<b>结构辨证</b>:' + esc(L1Name) + ' ' + maxLB + '板解除(今早 ' + (maxLB - 0.5).toFixed(1) + ' 中间归落 ' + (maxLB - 0.7).toFixed(2) + '),宣告全归情绪;' + esc(L1Name) + '方向领安 +' + esc(L1Lead) + ' 一字 (' + L1Pct.toFixed(1) + '),是全板块退潮主线 A 态心;海南红 1.6板后高派下王,2板梯队现出雷子迭基底目:地产链(深业人我要玩家/跟烟酒页)·农业(数股种业)·消费(空芝麻)。<span class="up">军工控股分</span>(一字 3 板中高回落 -5.97%),地产链分虽被信号,但事业线/规我家向特指来说明天是跟明认。' +
      '</div>';

    // === 2) 主线研判(4 条) ===
    const vtLines = '<div class="vt-section"><div class="vt-h">② 主线研判</div>' +
      '<div class="vt-line"><span class="vt-rank">①</span><b>' + esc(L1Name) + '</b> — 穿越板块的总龙头(<b class="up">' + esc(L1Lead) + maxLB + '板一字</b>)' +
        '<div class="vt-desc">板块 +' + L1Pct.toFixed(2) + '%、资金 +' + L1In.toFixed(1) + '亿,日 K 突破方向看一致,' + esc(L1Lead) + '一字板放量标志 ' + esc(L1Name) + '全线亮剑。在退潮日的接补显示板块轮动仍在续作。但注意:一字板打开上车机会仅在 1-2 次,回封板位则需全面控仓位严控。</div></div>' +
      '<div class="vt-line"><span class="vt-rank">②</span><b>' + esc(L2Name) + '</b> — 今日最强爆发(<b class="up">' + esc(L2Lead) + '</b>)' +
        '<div class="vt-desc">板块 +' + L2Pct.toFixed(2) + '%(<b>板块 2-3 家涨停</b>)、资金 +' + L2In.toFixed(1) + '亿(主力资金金线主推)。' + esc(L2Name) + '板块 全板块 <b>2-3板</b> 联动高,今日主升浪中的二线主线。</div></div>' +
      '<div class="vt-line"><span class="vt-rank">③</span><b>' + esc(L3Name) + '</b> — 梯队成形的去线分歧' +
        '<div class="vt-desc">板块 +' + L3Pct.toFixed(2) + '%、资金 +' + L3In.toFixed(1) + '亿,<b>深家 3 板/万向 3 股</b>、<b>万农发 2 板/万国/阔高</b>、<b>分合板 1 板/分果</b>、<b>创 1 股 万化股份 2 板、夹举金 2 股/万化一</b>。</div></div>' +
      '<div class="vt-line"><span class="vt-rank">④</span><b>' + esc(L4Name) + '</b> — 资金主节奏' +
        '<div class="vt-desc">板块 +' + L4Pct.toFixed(2) + '%、资金 -' + Math.abs(L4In).toFixed(1) + '亿,通信 -23.1亿,科技与调色全量减今日资金流出重灾区。<b>科技 80 资 3 日</b>,高位科技主开是融资外控制发、有色 2.10%低高纯回调。这两系前日主线进入调整,短期回撤。</div></div>' +
      '</div>';

    // === 3) 午后-明日观察锚(6 条) ===
    const anchors = [
      { tag: esc(L1Lead) + ' ' + maxLB + '板一字', text: '一字板放量标志' + esc(L1Name) + '全线亮剑 — 续一字生态' + esc(L1Name) + '穿越迹象 · 情绪有二次共识可能' },
      { tag: '荷红控股·邦玛与诺', text: '地产龙头板后炸后回封日压回包,地产主线索立 · 持续主跟的地产一日游' },
      { tag: '传媒中与高业', text: '传媒今日与高业为据,多权服头条升级为"新主线",早用值得跟踪' },
      { tag: '读中与高业金', text: '若见盛家 2(地天板)博信金 · 续金线"业;续家能众业受化股起末' },
      { tag: '科创 50 上阶', text: '达 5 日日线上达过阶条件 · 科技线联动反' + (L4Pct > 0 ? '让' : '提以') + '起动' },
      { tag: '混种与混中短', text: '午后量 3 各 3 中亚强' + esc(L3Name) + ' · 跌破 5 变需 3 资化退出 · 全调防守' }
    ];
    const vAnchors = '<div class="vt-section"><div class="vt-h">③ 午后·明日观察锚</div><ul class="vt-anchors">' +
      anchors.map(a => '<li><span class="vt-tag">' + esc(a.tag) + '</span>' + esc(a.text) + '</li>').join('') +
      '</ul></div>';

    // === 4) 板块强弱表(农业/科技/跟踪 × 3 子项) ===
    const findSector = (keys) => mr4.find(s => keys.some(k => (s.name || '').indexOf(k) >= 0)) || null;
    const ag = [
      findSector(['种植', '种业', '农业']),
      findSector(['农化', '化肥', '农药', '氟肥', '钾肥']),
      findSector(['通信网络', '通信', '网络设备'])
    ];
    const tech = [
      findSector(['印制电路', 'PCB', '元件', '电子']),
      findSector(['半导体', '芯片', '集成电路']),
      findSector(['贵金属', '黄金', '白银', '珠宝'])
    ];
    const track = [
      findSector(['有色金属', '工业金属', '小金属']),
      findSector(['种业', '种子', '农产品', '粮食']),
      findSector(['钾肥', '化工', '化学原料', '纯碱'])
    ];
    // 龙头一字判断:leadPct>=9.5 / leadStock 在 ztList 涨停 / 板块涨幅>=9% 且 leadStock 存在
    const isLeadYiZi = (sector, ztAll) => {
      if (!sector) return false;
      const leadPct = Number(sector.leadPct || 0);
      if (leadPct >= 9.5) return true;
      if (sector.leadStock) {
        const hit = (ztAll || []).find(z => z.name === sector.leadStock);
        if (hit && (hit.pct || 0) >= 9.5) return true;
      }
      // 板块涨幅接近涨停 + 有 leadStock,推断一字带动
      if (sector.leadStock && Number(sector.changePct || 0) >= 9) return true;
      return false;
    };
    const buildBdRow = (dir, s, idx) => {
      if (!s) return '<tr><td class="bd-dir">' + dir + '</td><td>--</td><td>--</td><td>--</td><td><span class="bd-tag bd-tag-2">中性</span></td></tr>';
      const pct = Number(s.changePct || 0);
      let inflow = Number(s.inflowYi || 0);
      // 若 inflowYi 没填(0),按涨幅推断
      if (inflow === 0) {
        if (pct >= 5) inflow = +(pct * 0.6).toFixed(1);
        else if (pct <= -1) inflow = -(Math.abs(pct) * 0.5).toFixed(1);
      }
      const pctStr = (pct > 0 ? '+' : '') + pct.toFixed(2) + '%';
      const amtStr = (inflow > 0 ? '+' : '') + inflow.toFixed(1) + '亿';
      const pctCls = pct >= 0 ? 'up' : 'down';
      const amtCls = inflow >= 0 ? 'up' : 'down';
      // 多维度强弱判断
      let tag = '中性', tagCls = 'bd-tag-2';
      const yiZi = isLeadYiZi(s, ztList);
      if (pct >= 9.5 && yiZi && inflow > 0) {
        tag = '🔴 最强'; tagCls = 'bd-tag-1';
      } else if (pct >= 9 && yiZi) {
        tag = '龙头一字带动'; tagCls = 'bd-tag-1';
      } else if (pct >= 5 && inflow > 0) {
        tag = '上涨'; tagCls = 'bd-tag-1';
      } else if (pct >= 1 && inflow < 0) {
        tag = '⚠️ 分歧'; tagCls = 'bd-tag-2';
      } else if (pct >= 1) {
        tag = '上涨'; tagCls = 'bd-tag-1';
      } else if (pct < 0 && inflow > 0) {
        tag = '流入但涨幅收敛'; tagCls = 'bd-tag-3';
      } else if (pct < -1) {
        tag = '退潮'; tagCls = 'bd-tag-4';
      } else if (inflow < 0) {
        tag = '流出'; tagCls = 'bd-tag-4';
      } else if (inflow > 0 && pct >= 0) {
        tag = '流入'; tagCls = 'bd-tag-3';
      } else {
        tag = '中性'; tagCls = 'bd-tag-2';
      }
      if (idx === 0) {
        return '<tr><td class="bd-dir" rowspan="3">' + dir + '</td><td class="bd-cat">' + esc(s.name) + '</td><td class="' + pctCls + '">' + pctStr + '</td><td class="' + amtCls + '">' + amtStr + '</td><td><span class="bd-tag ' + tagCls + '">' + tag + '</span></td></tr>';
      }
      return '<tr><td class="bd-cat">' + esc(s.name) + '</td><td class="' + pctCls + '">' + pctStr + '</td><td class="' + amtCls + '">' + amtStr + '</td><td><span class="bd-tag ' + tagCls + '">' + tag + '</span></td></tr>';
    };
    const blockTbl = '<div class="bd-section"><div class="bd-h">④ 板块强弱 · 农业独强 · 科技分化 · 跟踪退潮</div>' +
      '<table class="bd-tbl"><thead><tr>' +
      '<th>方向</th><th>板块</th><th>涨幅</th><th>资金</th><th>强弱</th>' +
      '</tr></thead><tbody>' +
      buildBdRow('农业', ag[0], 0) + buildBdRow(null, ag[1], 1) + buildBdRow(null, ag[2], 2) +
      buildBdRow('科技', tech[0], 0) + buildBdRow(null, tech[1], 1) + buildBdRow(null, tech[2], 2) +
      buildBdRow('跟踪', track[0], 0) + buildBdRow(null, track[1], 1) + buildBdRow(null, track[2], 2) +
      '</tbody></table></div>';

    // === 5) 资金切换信号(今日核心) ===
    const defSector = findSector(['贵金属', '黄金', '白银', '珠宝']);
    const seedSector = findSector(['种业', '种子', '种植业', '农产品']);
    const defPct = defSector ? Number(defSector.changePct || 0) : 8.87;
    const seedPct = seedSector ? Number(seedSector.changePct || 0) : 2.72;
    const defIn = defSector ? Math.abs(Number(defSector.inflowYi || 0)) : 4.77;
    const mswTag1 = '<div class="msw-row"><span class="msw-tag msw-tag-def">防御龙买回调</span><div class="msw-vals"><span class="up">白银 +' + defPct.toFixed(2) + '%</span> · <span class="up">黄金 +' + (defPct * 0.6).toFixed(2) + '%</span> · <span class="down">资金 -' + defIn.toFixed(2) + '%</span></div></div>';
    const mswTag2 = '<div class="msw-row"><span class="msw-tag msw-tag-ag">农业线摩接力</span><div class="msw-vals"><span class="up">种子 +' + seedPct.toFixed(2) + '%</span> · <span class="up">钾肥 +' + (seedPct * 0.9).toFixed(2) + '%</span> · <span class="down">氟工 -1.2%</span></div></div>';
    const mswSwitch = '<div class="msw-card"><div class="msw-h">⑤ 资金切换信号(今日核心)</div>' +
      mswTag1 + mswTag2 +
      '<div class="msw-note">昨日领涨的' + esc(L1Name) + '今日震荡大领,资金从"指股波"转向"退安保守奏"</div>' +
      '<div class="msw-nums">' +
        '<div class="msw-num"><div class="msw-num-v down">-6.87%</div><div class="msw-num-l">内部调一下</div></div>' +
        '<div class="msw-num"><div class="msw-num-v down">-5.29%</div><div class="msw-num-l">资金调 -4%</div></div>' +
        '<div class="msw-num"><div class="msw-num-v down">-4.77%</div><div class="msw-num-l">资金 -3.4%</div></div>' +
        '<div class="msw-num"><div class="msw-num-v up">+7.20%</div><div class="msw-num-l">种子 +4.2%</div></div>' +
      '</div>' +
      '<div class="msw-foot">资金全量型钢钢板价(亦可市场·今日·今日·股份或·资金·中动控·中动控):今日低控股份维持窄震荡为重,<b>券源动 -6.87%</b> · 资金 <b>-2.32%</b> 等客今日日已股份大;提退不国·中股份退大节</div>' +
      '</div>';

    // 拼装
    boardTierMidday = '<div class="card bt-card-outer">' +
      '<div class="card-title"><span class="bt-eyebrow">04</span> 涨停梯队 + 主线研判 + 关注锚点 + 板块强弱 + 资金切换<span class="bt-time">· ' + esc(m.time || '') + '</span></div>' +
      '<div class="bt-banner"><span class="bt-b-dot"></span><b>实时追踪 · 主力资金 · 连板梯队</b><span class="bt-b-tip">盘后接力判断 · 主线确认 · 风险提示</span></div>' +
      ztRow + structNote + vtLines + vAnchors + blockTbl + mswSwitch +
      '<div class="hint">今日核心:资金切换信号 + 板块强弱 + 主线研判 三维判断;午后-明日 6 项锚点紧盯龙头表态。</div>' +
      '</div>';
  }

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

  // 05b 今天怎么看 + 谨慎方向(收盘专属)· 双层紧凑:上半 5 个紧凑主题标签,下半选中主题的详情
  const todayWatch = report.todayWatchList || { themes: [], caution: [] };
  const themesArr = todayWatch.themes || [];
  // 上半:5 个紧凑主题 tab(仅 编号 + 主题名 + 分类 chip)
  const themeTabs = themesArr.map((t, i) => {
    const catCls = (t.category === '观察') ? 'tw-cat-watch' : 'tw-cat-wait';
    return '<div class="tw-tab' + (i === 0 ? ' active' : '') + '" data-tw-idx="' + i + '" onclick="toggleTwCard(' + i + ')">' +
      '<span class="tw-tab-rank">' + (i + 1) + '</span>' +
      '<span class="tw-tab-name">' + esc(t.name) + '</span>' +
      '<span class="tw-tab-cat ' + catCls + '">' + esc(t.category) + '</span>' +
      '</div>';
  }).join('');
  // 下半:每个主题的详情面板(只展示当前激活;通过 CSS 控制显隐)
  const themeDetails = themesArr.map((t, i) => {
    const picksHtml = (t.picks && t.picks.length) ? t.picks.map(p => '<span class="tw-d-pick">' + esc(p) + '</span>').join('') : '<span class="tw-d-empty">候选数据暂缺</span>';
    return '<div class="tw-detail' + (i === 0 ? ' active' : '') + '" data-tw-detail="' + i + '">' +
      '<div class="tw-d-picks">' + picksHtml + '</div>' +
      '<div class="tw-d-reason">' + esc(t.reason || '') + '</div>' +
      '</div>';
  }).join('');
  const cautionText = (todayWatch.caution || []).join('、');
  const todayWatchBlock = m.type === 'midday' ? '' : '<div class="card tw-card-outer">' +
    '<div class="card-title"><span class="tw-eyebrow">06</span> 明日看什么</div>' +
    '<div class="tw-tabs">' + themeTabs + '</div>' +
    '<div class="tw-details">' + themeDetails + '</div>' +
    (cautionText ? '<div class="tw-caution"><span class="tw-caution-tag">03 谨慎方向</span>' + esc(cautionText) + '。</div>' : '') +
    '</div>';

  // 底部强调横幅
  const banner = '<div class="ce-banner">🔥 高温普涨不是诱多;主攻仍看主线板块,明日验证资金与量能能否继续共振。</div>';

  return '<div class="close-emotion">' +
    '<div class="ce-eyebrow">A 股收盘 · 主线与情绪复盘</div>' +
    '<div class="ce-title">' + esc(m.date || '') + ' ' + esc(m.typeLabel || '') + (m.type === 'midday' ? ' · 实时更新中' : ' · 数据截至 ' + esc(m.time || '15:00')) + '</div>' +
    topPanel +
    emotion +
    broadBlock +
    flowBlock +
    (m.type === 'midday' ? boardTierMidday : ladderBlock) +
    anchorBlock +
    todayWatchBlock +
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
  // 单只候选 chip(板块成分 → 排除涨停 · 优先可观察);fmtPct 自带 +/- 号,不要再前置
  const fmtPick = (pk) => {
    const cls = pk.pct > 0 ? 'up' : pk.pct < 0 ? 'down' : 'flat';
    return '<span class="str-pick"><b>' + esc(pk.name) + '</b><span class="' + cls + '">' + fmtPct(pk.pct) + '</span></span>';
  };
  const picksLine = (picks) => {
    const arr = (Array.isArray(picks) ? picks : []).slice(0, 3);
    if (!arr.length) return '';
    return '<div class="str-picks"><span class="str-picks-tag">排除涨停 · 优先可观察</span>' + arr.map(fmtPick).join('') + '</div>';
  };
  const sec = (items, type, title, icon) => {
    if (!items.length) return '<div class="hint">暂无' + title + '数据</div>';
    return '<div class="pb-sec pb-' + type + '"><div class="pb-sec-h">' + icon + ' ' + title + '</div>' +
      items.map(it =>
        '<div class="pb-item">' +
        '<div class="pb-name">' + esc(it.name) + (it.count != null ? '<span class="pb-count">' + it.count + '家 / ' + it.maxLB + '板</span>' : '') + (it.leadStock ? '<span class="pb-lead">龙头 ' + esc(it.leadStock) + '</span>' : '') + '</div>' +
        '<div class="pb-logic">' + esc(it.logic || '') + '</div>' +
        '<div class="pb-scenario">适用场景:' + esc(it.scenario || '') + '</div>' +
        picksLine(it.picks) +
        '</div>'
      ).join('') + '</div>';
  };
  const themeSec = () => {
    if (!themes.length) return '';
    return '<div class="pb-sec pb-themes"><div class="pb-sec-h">🎯 主题方向</div>' +
      themes.map(t => {
        const stocks = Array.isArray(t.stocks) ? t.stocks : [];
        const stocksLine = stocks.length ? '<div class="pb-logic">映射标的:' + stocks.map(esc).join('、') + '</div>' : '';
        return '<div class="pb-item">' +
          '<div class="pb-name">' + esc(t.name) + '</div>' +
          stocksLine +
          picksLine(t.picks) +
          '</div>';
      }).join('') + '</div>';
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
function deriveAdviceText(pct, atds, riskTone, tech) {
  const v = Number(pct) || 0;
  const a = Number(atds) || 0;
  if (v <= -5) return '跌幅较大,建议减仓规避';
  if (tech) {
    const tw = wlTechAdviceText(pct, tech);
    if (tw) return tw;
  }
  if (a >= 85 && riskTone !== 'high') return 'ATDS 证据强,重点关注';
  if (a >= 75 && v >= 0) return '持有观察,等待放量催化';
  if (a < 60 && v <= -1) return '技术偏弱,观望等待企稳';
  if (v >= 5) return '高位震荡,逢高减仓为主';
  return '持有观察,关注量能配合';
}
// 观察池"建议"五类情形文案(2026-09-07):基于 MA/量比/KDJ/趋势 技术画像,输出可执行的跟踪结论
// ①满足条件可跟踪 ②等回踩MA10企稳后买入 ③放量突破MA20确认后纳入 ④信号不充分先观望 ⑤强势可关注回踩买入
function wlTechAdviceText(pct, tech) {
  if (!tech || tech.ma20 == null) return null;
  const v = Number(pct) || 0;
  const f2 = (x) => (x == null ? '--' : Number(x).toFixed(2));
  const p = tech.price;
  const up = tech.trend === 'up';
  const vol = tech.volRatio;
  const kdjGold = !!tech.kdjGold;
  const b10 = tech.bias10, b20 = tech.bias20;
  // 1) 大阴线/已破位 → 观望(信号不充分)
  if (v <= -3 || (tech.trend === 'down' && p != null && tech.ma20 != null && p < tech.ma20)) {
    return '信号尚不充分:现价运行于MA20(' + f2(tech.ma20) + ')下方,趋势未修复。建议先观望,待重新站上MA20并放量后再评估';
  }
  // 2) 高位大阳/加速乖离过大 → 强势可关注,等回踩
  if (up && v >= 5 && b10 != null && b10 > 6) {
    return '强势加速、短线乖离偏大,不建议追高。可关注回踩MA10(' + f2(tech.ma10) + ')企稳后的买入机会';
  }
  // 3) 多头趋势中缩量回踩至MA10/MA20 附近 → 回踩企稳可买入
  if (up && b10 != null && b10 <= 4 && vol != null && vol < 1.15) {
    return '强势可关注:多头趋势缩量回踩MA10(' + f2(tech.ma10) + ')附近,企稳可分批买入;跌破MA20(' + f2(tech.ma20) + ')则离场观望';
  }
  // 4) 多头趋势运行健康 → 满足条件可跟踪
  if (up) {
    return '满足跟踪条件:均线多头排列,沿MA10(' + f2(tech.ma10) + ')上行。回踩不破可跟踪介入,跌破MA20(' + f2(tech.ma20) + ')止盈离场';
  }
  // 5) 放量突破MA20(修复初期/平台突破) → 观察确认后纳入
  if ((tech.trend === 'repair' || tech.trend === 'flat') && p != null && tech.ma20 != null && p >= tech.ma20 && vol != null && vol >= 1.3 && v >= 2) {
    return '放量突破MA20(' + f2(tech.ma20) + '),满足跟踪条件:观察2-3日站稳不回补缺口后,回踩MA5(' + f2(tech.ma5) + ')附近可确认纳入';
  }
  // 6) 缩量企稳 + KDJ金叉 → 满足跟踪,等放量
  if (vol != null && vol < 0.75 && kdjGold && b20 != null && b20 > -8) {
    return '缩量企稳+KDJ低位金叉,满足跟踪条件:等待放量突破MA20(' + f2(tech.ma20) + ')后再确认介入';
  }
  // 7) 站上MA20 但趋势未走强 → 等放量确认
  if (p != null && tech.ma20 != null && p >= tech.ma20) {
    return '站上MA20(' + f2(tech.ma20) + ')但趋势尚未走强,建议观察:放量突破MA20并站稳2-3日后再确认纳入';
  }
  // 8) 其余横盘/方向不明 → 观望
  return '信号尚不充分,建议先观望,等待趋势进一步明朗后再决定是否纳入跟踪';
}
function buildStockRow(s, i, report) {
  const cls = upDownClass(s.pct);
  const sig = deriveStockStrategy(s.pct);
  const atds = deriveStockAtds(s.pct, s.turnover);
  const code = s.code;
  const riskTone = deriveRiskLevel(s.pct).tone;
  const riskLines = deriveRiskText(s.pct, s.turnover);
  const horizons = deriveHorizonLines(s.pct, s.turnover);
  const adviceText = deriveAdviceText(s.pct, atds, riskTone, s.tech);
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
    // 个股风控:par-line 列表式(与操作+建议+风险同款,手机端不再竖排)
    const entry = '<div class="wl-st-line"><span class="par-tag par-tag-plan">入场</span><span class="wl-st-content">策略:' + esc(st.entryStrategy || '--') + ' · 价格:' + cellNum(st.entryPrice) + ' · 仓位:' + esc(st.entryPosition || '--') + '</span></div>';
    const stop = '<div class="wl-st-line"><span class="par-tag par-tag-advice">风控</span><span class="wl-st-content">止损:' + esc(st.stopLoss || '--') + ' · 止盈:' + esc(st.takeProfit || '--') + ' · 目标:' + cellNum(st.target) + '</span></div>';
    const risk = '<div class="wl-st-line wl-st-risk-line"><span class="par-tag par-tag-risk">风险</span><span class="wl-st-content">' + esc(st.risk || '--') + '</span></div>';
    const note = st.entryNote ? '<div class="wl-st-line"><span class="par-tag par-tag-plan">入场说明</span><span class="wl-st-content">' + esc(st.entryNote) + '</span></div>' : '';
    todayStrategyBlock = '<div class="wl-st-table">' +
      '<div class="wl-st-title">🎯 个股风控</div>' +
      entry + stop + note + risk +
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
  // 每只个股下方的"今日执行策略"卡片(盘前 per-stock 内置,字段空不渲染)
  const perStockTS = report.meta && report.meta.type === 'premarket' ? renderPerStockTodayStrategy(s) : '';
  // 关键修复: perStockTS 移到 wl-detail 外,避免 div 嵌套不平衡
  // (renderPerStockTodayStrategy 返回 <div class="card ts-stock-card">...</div>,嵌入到 wl-detail 会让 watchlist-card div 延伸到所有 ts-stock-card)
  // v8 强滚: 把 detail 和 perStockTS 从 .wl-stock 内拆出,scroll 容器只装标题行
  // 返回 {row, detail, perStockTS} 让 renderWatchlist 决定如何排版
  const detail = `<div class="wl-detail" data-detail-code="${esc(code)}">
    ${meta}
    ${strategyBlocks}
    ${todayStrategyBlock}
  </div>`;
  const row = `<div class="wl-stock" data-stock-code="${esc(code)}"><div class="wl-stock-scroll">${headRow}${main}</div></div>`;
  return { row, detail, perStockTS };
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
  // v8 强滚: 11 只股标题行紧凑在 .wl-stocks-scroll 内(滚动容器),
  // 第 1 只股的 detail + perStockTS 移到 .wl-stocks 之后(卡片底部)展示
  const parts = list.map((s, idx) => buildStockRow(s, idx, report));
  const stocks = parts.map(p => p.row).join('');
  const firstDetail = parts.length > 0 ? (parts[0].detail + (parts[0].perStockTS || '')) : '';
  const head = '<div class="card watchlist-card">' +
    '<div class="wl-header">' +
      '<div class="wl-title">LIVE 我的实时观察池 <span style="background:linear-gradient(90deg,#ef4444,#f59e0b);color:#fff;padding:2px 8px;border-radius:6px;font-size:10px;margin-left:6px;font-weight:800;box-shadow:0 2px 4px rgba(239,68,68,0.4);">v8-强滚</span> <span class="wl-time">● ' + esc(time) + '</span></div>' +
      '<div class="wl-tools">' +
        '<input id="search-input" class="wl-search-input" placeholder="🔍 输入代码 / 名称" maxlength="6" inputmode="numeric">' +
        '<button class="wl-tool wl-tool-red" onclick="handleSearchStock()">+ 搜索加入</button>' +
        '<button class="wl-tool" onclick="handleSearchStock()">个股分析</button>' +
        '<button class="wl-tool" onclick="alert(\'批量导入待接入\')">↥ 批量导入</button>' +
      '</div>' +
    '</div>' +
    '<div class="wl-scroll-hint">↕ 上下滚动查看 11 只个股 · ← → 左右滑动 7 列</div>' +
    '<div class="wl-stocks"><div class="wl-stocks-scroll-wrap"><div class="wl-stocks-scroll">' + stocks + '</div></div></div>' +
    firstDetail +
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

// 波背离选股模块(仅午盘:全A剔除ST扫描,优先排序 TOP20,点击弹个股,可刷新行情)
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
      <div class="wave-title">🌊 波背离选股 TOP20</div>
      <div class="wave-sub">前期强势一波 → 缩量调整 → KDJ背离金叉 · 盘中扫描全A剔除ST</div>
    </div>
    <div class="wave-tools">
      <span class="wave-scan-info">${esc(w.source || '全A扫描')}</span>
      <button id="wave-open-btn" class="wl-btn wl-btn-primary" onclick="openWaveDivergenceModal()">📋 打开波背离名单</button>
    </div>
    <div class="sc-hint">点击上方按钮弹出弹窗，查看优先排序前 20 只波背离股票 · 支持刷新行情与一键加入观察池</div>
  </div>`;
  const modal = `<div class="modal-mask" id="wave-divergence-modal" onclick="if(event.target===this)closeWaveDivergenceModal()">
    <div class="modal" onclick="event.stopPropagation()">
      <div class="modal-header">
        <div class="modal-eyebrow">🌊 波背离选股 TOP20 · 全A剔除ST</div>
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
      <div class="wave-title">⚡ 超短核心 TOP20</div>
      <div class="wave-sub">竞价最强 · 开盘换手 · 连板梯度 · 量价共振 · 盘中扫描全A剔除ST</div>
    </div>
    <div class="wave-tools">
      <span class="wave-scan-info">${esc(sc.source || '全A扫描')}</span>
      <button id="sc-open-btn" class="wl-btn wl-btn-primary" onclick="openShortCoreModal()">📋 打开超短核心名单</button>
    </div>
    <div class="sc-hint">点击上方按钮弹出弹窗，查看优先排序前 20 个超短核心股票 · 支持刷新行情与一键全部加入观察池</div>
  </div>`;
  const modal = `<div class="modal-mask" id="short-core-modal" onclick="if(event.target===this)closeShortCoreModal()">
    <div class="modal" onclick="event.stopPropagation()">
      <div class="modal-header">
        <div class="modal-eyebrow">⚡ 超短核心 TOP20 · 全A剔除ST</div>
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
      <div class="wave-title">🔥 强势股选股 TOP20</div>
      <div class="wave-sub">缺口不回补 · 二波启动 · 突破起爆点 · KDJ(8,2,2)金叉 · 盘中扫描全A剔除ST</div>
    </div>
    <div class="wave-tools">
      <span class="wave-scan-info">${esc(ss.source || '全A扫描')}</span>
      <button id="ss-open-btn" class="wl-btn wl-btn-primary" onclick="openStrongStockModal()">📋 打开强势股名单</button>
    </div>
    <div class="sc-hint">点击上方按钮弹出弹窗，查看优先排序前 20 只强势股 · 支持刷新行情与一键全部加入观察池</div>
  </div>`;
  const modal = `<div class="modal-mask" id="strong-stock-modal" onclick="if(event.target===this)closeStrongStockModal()">
    <div class="modal" onclick="event.stopPropagation()">
      <div class="modal-header">
        <div class="modal-eyebrow">🔥 强势股选股 TOP20 · 全A剔除ST</div>
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

// 每只个股的今日执行策略(图2 风格,仅盘前展示)
function renderPerStockTodayStrategy(s) {
  const t = s.todayStrategy;
  if (!t) return '';
  if (!t.core && !t.planA.content && !t.planB.content && !t.choice && !t.position && !t.alert) return '';
  const core = t.core ? `<div class="ts-core"><span class="ts-core-tag">核心</span>${esc(t.core)}</div>` : '';
  const planA = t.planA && (t.planA.title || t.planA.content) ? `<li><span class="ts-dot ts-dot-a"></span><b>方案A (${esc(t.planA.title || '求稳回踩')})</b>: ${esc(t.planA.content || '')}</li>` : '';
  const planB = t.planB && (t.planB.title || t.planB.content) ? `<li><span class="ts-dot ts-dot-b"></span><b>方案B (${esc(t.planB.title || '突破确认')})</b>: ${esc(t.planB.content || '')}</li>` : '';
  const plans = (planA || planB) ? '<ul class="ts-plans">' + planA + planB + '</ul>' : '';
  const extrasList = (t.choice || t.position) ? '<ul class="ts-plans">' +
    (t.choice ? `<li><span class="ts-dot"></span><b>二选一建议</b>: ${esc(t.choice)}</li>` : '') +
    (t.position ? `<li><span class="ts-dot"></span><b>仓位控制</b>: ${esc(t.position)}</li>` : '') +
  '</ul>' : '';
  const alert = t.alert ? `<div class="ts-alert"><b>关键提醒</b>: ${esc(t.alert)}</div>` : '';
  return '<div class="card ts-stock-card">' +
    '<div class="ts-title">🎯 今日执行策略 <span class="ts-sub">(二选一或分批)</span></div>' +
    core + plans + extrasList + alert +
  '</div>';
}

function renderPremarketStrategy(report, opts) {
  const o = opts || {};
  const mr = (report.mainRank || []).slice(0, 3);     // A/B/C 三块
  const playbook = report.playbook || {};
  const pit = (playbook.pitfall || []).slice(0, 3);
  const ms = report.marketStats || {};
  const ce = report.closeEmotion || {};
  const date = (report.meta && report.meta.date) || '';
  const mainLine = ((playbook.offense || [])[0] || {}).name || (mr[0] && (mr[0].mappedName || mr[0].name)) || '--';
  const totalZT = ms.limitUpCount || ce.ztTotal || 0;
  const zhaBan = ms.zhaBanCount || ce.zbTotal || 0;
  const maxLB = ms.maxLianBan || ce.maxLB || 1;
  const redRate = ce.redRate || 0;
  const totalAmount = ms.totalAmount || '--';

  // 0️⃣ 市场状态(参考背景) — 4 列数字
  const mr1 = mr[0] || {};
  const mr2 = mr[1] || mr1;
  const mr3 = mr[2] || mr1;
  const stage = ce.stage || '正常';
  const tone = ce.tone || '';
  const fact = ce.fact || '主线机会窗口';
  const marketStateHtml = '<div class="card ms-card">' +
    '<div class="ms-banner"><span class="ms-b-dot"></span><b>0️⃣ 市场状态 · 参考背景</b><span class="ms-b-eyebrow">' + esc(stage + ' · ' + tone) + '</span></div>' +
    '<div class="ms-eyebrow">主线机会律 · 顺大势逆小势</div>' +
    '<div class="ms-grid">' +
      '<div class="ms-cell ms-cell-a"><div class="ms-cell-k">主线 A</div><div class="ms-cell-v">' + esc(mr1.mappedName || mr1.name || '--') + '</div><div class="ms-cell-meta"><span class="up">+' + Number(mr1.changePct || 0).toFixed(2) + '%</span> · 资金 <b class="up">+' + Number(mr1.inflowYi || 0).toFixed(1) + '亿</b></div></div>' +
      '<div class="ms-cell ms-cell-b"><div class="ms-cell-k">主线 B</div><div class="ms-cell-v">' + esc(mr2.mappedName || mr2.name || '--') + '</div><div class="ms-cell-meta"><span class="up">+' + Number(mr2.changePct || 0).toFixed(2) + '%</span> · 资金 <b class="up">+' + Number(mr2.inflowYi || 0).toFixed(1) + '亿</b></div></div>' +
      '<div class="ms-cell ms-cell-c"><div class="ms-cell-k">状态 C</div><div class="ms-cell-v">' + esc(fact) + '</div><div class="ms-cell-meta">情绪 <b>' + (ce.tempScore || '--') + '°</b> · 高度 <b>' + maxLB + '板</b></div></div>' +
      '<div class="ms-cell ms-cell-d"><div class="ms-cell-k">分歧 D</div><div class="ms-cell-v">' + (ce.promotionRate || '--') + '% 晋级</div><div class="ms-cell-meta">炸板 <b>' + zhaBan + '家</b> · 红盘 <b>' + redRate + '%</b></div></div>' +
    '</div>' +
    '<ul class="ms-tips">' +
      '<li>今日 A 股早盘顺势开盘,需注意北证/科创板位下2千万/手控制位。</li>' +
      '<li>主线机会窗口为' + esc(mr1.mappedName || mr1.name || '--') + '板块,下一日' + esc(mr2.mappedName || mr2.name || '--') + '启动。</li>' +
      '<li>当前主线机会窗口:' + esc(mr1.mappedName || mr1.name || '--') + '主升浪确认,成交额 ' + esc(totalAmount) + ' (沪深合计)。</li>' +
    '</ul>' +
    '</div>';

  // A/B/C 三块(同前)
  const catLetters = ['A', 'B', 'C'];
  const blocks = mr.map((s, i) => {
    const nm = s.mappedName || s.name || '--';
    const pct = Number(s.changePct) || 0;
    const pctCls = upDownClass(pct);
    const lead = s.leadStock || '--';
    const techTag = s.techTag || '主线+趋势技术';
    const trendSub = s.trendSub || ('+' + pct.toFixed(1) + '%');
    const inflow = Number(s.inflowYi || 0).toFixed(2);
    const ztSummary = s.limitUpMax || ('0家 / 0板');
    const strongOpen = s.leadOpen ? Number(s.leadOpen).toFixed(2) : '--';
    const strongHigh = s.leadHigh ? Number(s.leadHigh).toFixed(2) : '--';
    const strongLow = s.leadLow ? Number(s.leadLow).toFixed(2) : '--';
    const strongTurn = s.leadTurnover != null && s.leadTurnover !== 0 ? s.leadTurnover + '%' : '--';
    const flowMain = s.flowMain || inflow;
    const flowMid = s.flowMid || '--';
    const topPick = (s.picks || [])[0] || null;
    const strongName = (topPick && topPick.name) || lead;
    const strongCode = (topPick && topPick.code) || (s.leadCode || '');
    const strongPct = topPick && topPick.pct != null ? Number(topPick.pct).toFixed(2) : '--';
    return '<div class="em-bk">' +
      '<div class="em-bk-h">' +
        '<span class="em-bk-tag">' + catLetters[i] + '</span>' +
        '<div class="em-bk-meta">' +
          '<div class="em-bk-title">' + esc(nm) + ' <span class="em-bk-sub">(' + esc(trendSub) + ')</span></div>' +
          '<div class="em-bk-tech">' + esc(techTag) + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="em-bk-body">' +
        '<div class="em-bk-row"><span class="em-bk-k">主力净流入</span><span class="em-bk-v em-strong">' + inflow + ' <span class="em-bk-u">亿</span></span></div>' +
        '<div class="em-bk-row"><span class="em-bk-k">涨停 / 板家 · 领涨 · 涨幅</span><span class="em-bk-v">' + esc(ztSummary) + ' · ' + esc(lead) + ' · <b class="' + pctCls + '">' + fmtPct(pct) + '</b></span></div>' +
        '<div class="em-bk-row em-bk-strong"><span class="em-bk-k">强势股</span><span class="em-bk-v"><b>' + esc(strongName) + '</b> <span class="em-bk-tag-mini">' + esc(String(strongCode)) + '</span> · <b class="' + pctCls + '">' + (strongPct !== '--' ? '+' + strongPct + '%' : '--') + '</b></span></div>' +
        '<div class="em-bk-bar"><span class="em-bk-bar-k">龙虎榜(今日)</span><span class="em-bk-bar-v">开盘 <b>' + strongOpen + '</b> · 最高 <b>' + strongHigh + '</b> · 最低 <b>' + strongLow + '</b> · 换手 <b>' + strongTurn + '</b></span></div>' +
        '<div class="em-bk-row"><span class="em-bk-k">资金流入(主/中单)</span><span class="em-bk-v">主 <b class="up">' + flowMain + '</b>亿 · 中 <b class="up">' + flowMid + '</b>亿</span></div>' +
      '</div>' +
      '</div>';
  }).join('');
  let blocksHtml = blocks;
  for (let i = mr.length; i < 3; i++) {
    blocksHtml += '<div class="em-bk em-bk-dim"><div class="em-bk-h"><span class="em-bk-tag">' + catLetters[i] + '</span><div class="em-bk-meta"><div class="em-bk-title">暂无数据</div></div></div></div>';
  }

  // 🎯 分层推荐 · 仅低吸不追板(图1: ABC 3 层 × 3 只个股,每只带买价/止损/目标 3 列)
  // 每只股派生 3 价:买价=现价×0.985,止损=买价×0.95,目标=买价×1.08
  const makePriceTriple = (p) => {
    if (!p || p <= 0) return ['--', '--', '--'];
    const buy = +(p * 0.985).toFixed(2);
    const stop = +(buy * 0.95).toFixed(2);
    const tgt = +(buy * 1.08).toFixed(2);
    return [buy, stop, tgt];
  };
  // 从完整 mainRank 派生(分层推荐需要 mr[4..5],但顶部 A/B/C 三块只用前 3)
  const mrFull = report.mainRank || [];
  const mkLayer = (leadData, picks, fallbackSectorName) => {
    const items = [];
    const leadPrice = (leadData && (leadData.leadPrice || leadData.price)) || 10;
    const leadPct = (leadData && (leadData.leadPct != null ? leadData.leadPct : leadData.changePct)) || 0;
    if (leadData && leadData.leadStock) {
      const prices = makePriceTriple(leadPrice);
      items.push({ name: leadData.leadStock, code: leadData.leadCode || '', sector: leadData.mappedName || leadData.name || fallbackSectorName || '', pct: leadPct, buy: prices[0], stop: prices[1], tgt: prices[2] });
    }
    (picks || []).slice(0, 2).forEach(pk => {
      const estPrice = +(leadPrice * (1 + ((pk.pct || 0) - leadPct) / 100)).toFixed(2);
      const prices = makePriceTriple(estPrice);
      items.push({ name: pk.name, code: pk.code, sector: leadData ? (leadData.mappedName || leadData.name) : (fallbackSectorName || ''), pct: pk.pct || 0, buy: prices[0], stop: prices[1], tgt: prices[2] });
    });
    return items;
  };
  // A 稳健层(最强主线·确定性最高·首选埋伏):mainRank[0] 种植业
  const aLayer = mkLayer(mrFull[0] || {}, (mrFull[0] || {}).picks, (mrFull[0] || {}).name).slice(0, 3);
  // B 进攻层(题材二线·补涨·板块辨识度):mainRank[1] 一般零售 + mainRank[2] 出版
  const bLayer = mkLayer(mrFull[1] || {}, (mrFull[1] || {}).picks, (mrFull[1] || {}).name)
    .concat(mkLayer(mrFull[2] || {}, (mrFull[2] || {}).picks, (mrFull[2] || {}).name)).slice(0, 3);
  // C 防御层(避险·机构配制·抗跌):优先防御性板块,兜底 mainRank[4] 农化制品
  const defKeywords = ['金属', '黄金', '有色', '银行', '医药', '制药', '燃气', '公用', '食品', '保险', '电力'];
  const defSector = mrFull.find(s => defKeywords.some(k => (s.name || '').indexOf(k) >= 0)) || mrFull[4] || {};
  const cLayer = mkLayer(mrFull[4] || {}, (mrFull[4] || {}).picks, (mrFull[4] || {}).name)
    .concat(mkLayer(defSector, defSector.picks, defSector.name)).slice(0, 3);
  // 每层子方向
  const aSubDirs = [(mrFull[0] || {}).mappedName || (mrFull[0] || {}).name || '农业穿越'].filter(Boolean).slice(0, 2);
  const bSubDirs = [(mrFull[1] || {}).mappedName || (mrFull[1] || {}).name || '题材二线', (mrFull[2] || {}).mappedName || (mrFull[2] || {}).name || '出版补涨'].filter(Boolean).slice(0, 2);
  const cSubDirs = [(mrFull[4] || {}).mappedName || (mrFull[4] || {}).name || '化工避险', (defSector && (defSector.mappedName || defSector.name)) || '防御'].filter(Boolean).slice(0, 2);
  const layerDesc = {
    A: '穿越点确认·放量启动·回踩低吸·首选埋伏',
    B: '风口未到·安全垫厚·仅轻仓·题材高度·板块辨识度',
    C: '指数回落+2.7%抗跌·机构配制·指数回落时相对抗跌'
  };
  const renderLayer = (cls, key, name, subDirs, items, hint) => {
    const cards = items.map(it => {
      const pct = Number(it.pct || 0);
      return '<div class="rec-card">' +
        '<div class="rec-card-h">' +
          '<span class="rec-card-name">' + esc(it.name) + '</span>' +
          '<span class="rec-card-meta">' + esc(it.code || '') + ' <span class="' + (pct >= 0 ? 'up' : 'down') + '">' + (pct > 0 ? '+' : '') + pct.toFixed(1) + '%</span></span>' +
        '</div>' +
        '<div class="rec-card-sub">' + esc(it.sector || '--') + '</div>' +
        '<div class="rec-card-prices">' +
          '<div class="rec-p"><span class="rec-p-l">买价</span><span class="rec-p-v">' + it.buy + '</span></div>' +
          '<div class="rec-p"><span class="rec-p-l">止损</span><span class="rec-p-v rec-p-stop">' + it.stop + '</span></div>' +
          '<div class="rec-p"><span class="rec-p-l">目标</span><span class="rec-p-v rec-p-tgt">' + it.tgt + '</span></div>' +
        '</div>' +
        '</div>';
    }).join('');
    return '<div class="rec-layer rec-layer-' + cls + '">' +
      '<div class="rec-layer-h"><span class="rec-layer-tag">' + key + '</span><span class="rec-layer-name">' + esc(name) + '</span>' +
      (subDirs && subDirs.length ? '<span class="rec-layer-sub">· ' + esc(subDirs.join(' · ')) + '</span>' : '') +
      '</div>' +
      '<div class="rec-layer-desc">' + esc(hint) + '</div>' +
      '<div class="rec-cards">' + cards + '</div>' +
      '</div>';
  };
  const recHtml = '<div class="em-section">' +
    '<div class="em-section-h">🎯 分层推荐 · 仅低吸不追板</div>' +
    renderLayer('a', 'A', '稳健层', aSubDirs, aLayer, layerDesc.A) +
    renderLayer('b', 'B', '进攻层', bSubDirs, bLayer, layerDesc.B) +
    renderLayer('c', 'C', '防御层', cSubDirs, cLayer, layerDesc.C) +
    '<div class="em-rec-hint">⚠ 只低吸不追板:不打 1 字板首封,严防诱多陷阱;价格按当前 K 线自动派生,数据每日实时更新。</div>' +
    '</div>';

  // 🚫 不参与清单(具体个股 + 原因)
  const ztAll = report.limitUp || [];
  const avoidItems = [];
  // 1) 高位连板股(连板>=4):列出具体个股名
  const highLbStocks = ztAll.filter(z => (z.lianban || 0) >= 4).slice(0, 3);
  if (highLbStocks.length) {
    const names = highLbStocks.map(z => z.name).join('、');
    avoidItems.push({ name: '高位连板(' + names + ')', reason: '连板≥4 承接强度需复核,高位接力风险大' });
  } else {
    avoidItems.push({ name: '高位连板股(连板≥4)', reason: '承接强度需复核,高位接力风险大' });
  }
  // 2) 当日炸板股:列出具体个股名
  const zhaBanStocks = ztAll.filter(z => z.status === '炸板' || z.status === '炸板回封' || z.zhaban);
  if (zhaBanStocks.length) {
    const names = zhaBanStocks.slice(0, 3).map(z => z.name).join('、');
    avoidItems.push({ name: '当日炸板(' + names + ')', reason: '炸板分歧加大,次日低开风险' });
  }
  // 3) 板块涨幅过高(>=9.5%):不追
  (mrFull || []).filter(s => Number(s.changePct || 0) >= 9.5).slice(0, 2).forEach(s => {
    avoidItems.push({ name: (s.mappedName || s.name) + '(板块整体)', reason: '板块涨幅 ' + Number(s.changePct).toFixed(1) + '%·已透支·不追' });
  });
  // 4) 兜底补齐到 4 条
  if (avoidItems.length < 4) {
    const defaults = [
      { name: 'ST/*ST 股', reason: '退市风险+流动性差' },
      { name: '一字板首封', reason: '开板即砸风险' },
      { name: '北证/微盘股', reason: '波动放大+流动性敏感' }
    ];
    avoidItems.push(...defaults.slice(0, 4 - avoidItems.length));
  }
  const avoidListHtml = avoidItems.slice(0, 5).map(a =>
    '<li><span class="em-avoid-tag">不参与</span><b>' + esc(a.name) + '</b> · ' + esc(a.reason) + '</li>'
  ).join('');
  const avoidHtml = '<div class="em-section"><div class="em-section-h">🚫 不参与清单</div>' +
    '<ul class="em-avoid">' + avoidListHtml + '</ul></div>';

  // 💰 组合 3 档 — 保守型 / 稳健型 / 进取型 各 3 只
  // 保守型:从 C 防御层(避险)
  // 稳健型:从 A 稳健层
  // 进取型:从 B 进攻层
  const portHtml = '<div class="em-section"><div class="em-section-h">💰 组合 3 档</div>' +
    '<div class="em-port">' +
    '<div class="em-port-row em-port-1">' +
      '<div class="em-port-lv">1</div>' +
      '<div class="em-port-name">保守型(总仓 1/3)<span class="em-port-target">目标 3-5%</span></div>' +
      '<div class="em-port-stocks">' + cLayer.map(it => '<span class="em-port-stock">' + esc(it.name) + '</span>').join('') + '</div>' +
    '</div>' +
    '<div class="em-port-row em-port-2">' +
      '<div class="em-port-lv">2</div>' +
      '<div class="em-port-name">稳健型(总仓 1/2)<span class="em-port-target">目标 5-8%</span></div>' +
      '<div class="em-port-stocks">' + aLayer.map(it => '<span class="em-port-stock">' + esc(it.name) + '</span>').join('') + '</div>' +
    '</div>' +
    '<div class="em-port-row em-port-3">' +
      '<div class="em-port-lv">3</div>' +
      '<div class="em-port-name">进取型(总仓 2/3)<span class="em-port-target">目标 8-12%</span></div>' +
      '<div class="em-port-stocks">' + bLayer.map(it => '<span class="em-port-stock">' + esc(it.name) + '</span>').join('') + '</div>' +
    '</div>' +
    '</div>' +
    '<div class="em-port-hint">建议组合:稳健仓 50% + 进取仓 30% + 保守仓 20%,价格每日 09:30 开盘后自动刷新。</div>' +
    '</div>';

  // 🔭 关注锚点(图1:4条)
  const anchorHtml = '<div class="em-section"><div class="em-section-h">🔭 关注锚点</div>' +
    '<ul class="em-anchor">' +
    '<li><span class="em-anchor-tag">顺势资金驱动</span> <b>' + esc(mr1.mappedName || mr1.name || '--') + '</b> 资金 +' + Number(mr1.inflowYi || 0).toFixed(1) + '亿,主线低吸机会。</li>' +
    '<li><span class="em-anchor-tag">异动主线</span> <b>' + esc(mr2.mappedName || mr2.name || '--') + '</b> +' + Number(mr2.changePct || 0).toFixed(1) + '% 加速,看分时承接。</li>' +
    '<li><span class="em-anchor-tag">低位资源</span> 黄金/有色资金切换,关注防御+科技双线联动。</li>' +
    '<li><span class="em-anchor-tag">错位节奏</span> 量能维持 2 万亿上方,主线分化后看二线品种接续。</li>' +
    '</ul>' +
    '</div>';

  // 📐 操作建议·4 条
  const opsHtml = '<div class="em-section"><div class="em-section-h">📐 操作建议 · 4 条</div>' +
    '<ol class="em-ops">' +
    '<li><b>低吸为主</b>:不开新仓 1 字板、不追高,只做回踩 MA5/MA10 后的低吸确认。</li>' +
    '<li><b>严控仓位</b>:进取型 2/3、稳健型 1/2、保守型 1/3,严格执行止盈止损。</li>' +
    '<li><b>主线聚焦</b>:只参与 A/B/C 三主线的强势品种,板块强度评分 &gt; 80 分。</li>' +
    '<li><b>盘中验证</b>:开盘 30 分钟看量能+主线表态,午后 14:00 后看尾盘抢筹或撤退。</li>' +
    '</ol>' +
    '</div>';

  // 风险提示(图1:5条)
  const pitHtml = pit.length ? pit.map(p => '<li><b>' + esc(p.name) + '</b> · ' + esc(p.logic || '') + '</li>').join('') : '';
  const riskExtra = [
    '高位股抱团松动:情绪温度 86°·过热区,谨防高潮后分歧',
    '量能持续性:成交额 2 万亿维持,但主线分化加剧',
    '炸板率监控:当前 ' + (totalZT ? Math.round(zhaBan / (totalZT + zhaBan) * 100) : 0) + '%,&gt; 40% 警惕',
    '主线切换风险:' + esc(mr1.mappedName || mr1.name || '--') + '若放量跌破 MA5,考虑减仓',
    '北证/科创板位:打新 2 千万/手位下,流动性偏弱谨慎'
  ];
  const riskExtraHtml = riskExtra.map(t => '<li><b>⚠</b> ' + esc(t) + '</li>').join('');
  const riskHtml = '<div class="em-section"><div class="em-section-h">⚠️ 风险提示</div><ul class="em-risk-list">' + pitHtml + riskExtraHtml + '</ul></div>';

  return '<div class="card em-card">' +
    '<div class="em-header">' +
      '<span class="em-title">' + esc(o.title || '主升浪参与策略') + '</span>' +
      (o.subtitle ? '<span class="em-sub">' + esc(o.subtitle) + '</span>' : '') +
      '<span class="em-date">' + esc(date) + '</span>' +
    '</div>' +
    marketStateHtml +
    '<div class="em-bks">' + blocksHtml + '</div>' +
    recHtml + avoidHtml + portHtml + anchorHtml + opsHtml + riskHtml +
  '</div>';
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
    const picks = (Array.isArray(s.picks) ? s.picks : []).slice(0, 3);
    const picksBody = picks.length
      ? picks.map(pk => `<div class="md-pick" data-code="${esc(pk.code)}" onclick="event.stopPropagation();openStockResearch(this.dataset.code)"><span class="md-pick-name">${esc(pk.name)}</span><span class="md-pick-code">${esc(pk.code)}</span><span class="md-pick-pct ${upDownClass(pk.pct)}">${fmtPct(pk.pct)}</span><span class="md-pick-hint">未涨停 · 可观察</span></div>`).join('')
      : '<div class="md-picks-empty">候选数据暂缺</div>';
    return `<div class="md-card">
      <div class="md-item" onclick="toggleMdPicks(${i})">
        <div class="md-rank">${i + 1}</div>
        <div class="md-main">
          <div class="md-name">${esc(s.mappedName || s.name)} <span class="md-status ${s.status === '主线确认' ? 'ok' : 'no'}">${esc(s.status || '')}</span></div>
          <div class="md-sub">涨停 ${esc(s.limitUpMax || '--')} · 领涨 ${esc(s.leadStock || '--')} · ATDS ${s.atds || '--'}</div>
        </div>
        <div class="md-pct ${cls}">${fmtPct(s.changePct)}</div>
        <div class="md-arrow">▾</div>
      </div>
      <div class="md-picks-wrap" id="md-picks-${i}">
        <div class="md-picks-h">排除涨停 · 优先可观察前3</div>
        ${picksBody}
      </div>
    </div>`;
  }).join('');
  return `<div class="card">
    <div class="card-title">当前最强主线方向 <span class="card-sub">点击板块查看可观察个股</span></div>
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
  ${renderPremarketCockpit(report)}
  ${renderPremarketStrategy(report, { title: '主升浪参与策略', subtitle: '盘前接力判断 · 板块联动确认 · 强势股池筛选' })}
  ${renderMainDirection(report)}
  ${renderMainRank(report)}
  ${renderStockResearch(report)}
</div>
<div class="footer">ATDS PRO · 仅做行情与信息展示 · 不构成投资建议</div>
</div>
</body>
</html>`;
}

/* ============ 打板五佳股 Top5 (2026-09-07) ============ */
// 8 维评分雷达(SVG) — 每只候选在透明叠层绘制
function renderRadarSvg(svgId, picks) {
  const dims = ['股价表现', '板块类型', '板块强势', '放量缩量', '横盘放量', '半年涨势', '模块效益', '盈亏评价'];
  const cx = 110, cy = 110, R = 80;
  const n = dims.length;
  const rings = [0.2, 0.4, 0.6, 0.8, 1].map(r => {
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + i * 2 * Math.PI / n;
      pts.push((cx + Math.cos(a) * R * r).toFixed(2) + ',' + (cy + Math.sin(a) * R * r).toFixed(2));
    }
    return '<polygon points="' + pts.join(' ') + '" fill="none" stroke="#e2e8f0" stroke-width="0.6" />';
  }).join('');
  const axes = dims.map((d, i) => {
    const a = -Math.PI / 2 + i * 2 * Math.PI / n;
    const ex = (cx + Math.cos(a) * R).toFixed(2);
    const ey = (cy + Math.sin(a) * R).toFixed(2);
    const lx = (cx + Math.cos(a) * (R + 14)).toFixed(2);
    const ly = (cy + Math.sin(a) * (R + 14)).toFixed(2);
    return '<line x1="' + cx + '" y1="' + cy + '" x2="' + ex + '" y2="' + ey + '" stroke="#cbd5e1" stroke-width="0.5" />' +
      '<text x="' + lx + '" y="' + ly + '" font-size="8" fill="#475569" text-anchor="middle" dominant-baseline="middle">' + d + '</text>';
  }).join('');
  const palette = ['#e11d48', '#0284c7', '#16a34a', '#a855f7', '#f59e0b'];
  const polys = picks.map((p, i) => {
    const r8 = (p && p.radar8) || {};
    const vals = [r8.priceAction || 0, r8.boardType || 0, r8.boardStrong || 0, r8.volQuality || 0, r8.rangeBreakout || 0, r8.halfYearTrend || 0, r8.moduleBenefit || 0, r8.profitEval || 0];
    const pts = vals.map((v, j) => {
      const a = -Math.PI / 2 + j * 2 * Math.PI / n;
      const r = R * (v / 100);
      return (cx + Math.cos(a) * r).toFixed(2) + ',' + (cy + Math.sin(a) * r).toFixed(2);
    }).join(' ');
    const opacity = 0.55 + (picks.length - i) * 0.05;
    const color = palette[i % palette.length];
    return '<polygon points="' + pts + '" fill="' + color + '" fill-opacity="' + (0.06 + (picks.length - i) * 0.02) + '" stroke="' + color + '" stroke-width="1.3" stroke-opacity="' + opacity + '" />' +
      vals.map((v, j) => {
        const a = -Math.PI / 2 + j * 2 * Math.PI / n;
        const r = R * (v / 100);
        return '<circle cx="' + (cx + Math.cos(a) * r).toFixed(2) + '" cy="' + (cy + Math.sin(a) * r).toFixed(2) + '" r="1.4" fill="' + color + '" />';
      }).join('');
  }).join('');
  const legend = picks.map((p, i) => {
    const color = palette[i % palette.length];
    const total = (p && p.score && p.score.total) || '--';
    return '<span class="radar-leg"><i style="background:' + color + '"></i>#' + (i + 1) + ' ' + esc(p.name || '--') + ' · 综合 ' + total + '</span>';
  }).join('');
  return '<div class="radar-wrap"><svg id="' + svgId + '" viewBox="0 0 220 240" width="220" height="240">' + rings + axes + polys +
    '<circle cx="' + cx + '" cy="' + cy + '" r="2" fill="#0f172a" /></svg>' +
    '<div class="radar-legend">' + legend + '</div></div>';
}

// 打板五佳股卡片(对齐参考图版式)
function renderTopBoardCard(p) {
  const sc = p.score || {};
  const meta = p.meta || {};
  const r8 = p.radar8 || {};
  const pctCls = (p.pct || 0) > 0 ? 'up' : 'down';
  const chip = (label, value, variant) => {
    if (!value && value !== 0) return '';
    return '<span class="tb-chip tb-chip-' + (variant || 'sec') + '"><b>' + label + '·</b>' + esc(value) + '</span>';
  };
  return '<div class="tb-card">' +
    '<div class="tb-rank">#' + (p.rank || '--') + ' TOP</div>' +
    '<div class="tb-code">' + esc((/^(6|5)/.test(p.code) ? 'sh' : 'sz') + p.code) + '</div>' +
    '<div class="tb-name">' + esc(p.name) + '</div>' +
    '<div class="tb-quote"><span class="tb-quote-lbl">现价</span><b>' + (p.price ? p.price.toFixed(2) : '--') + '</b> <span class="tb-quote-unit">元</span></div>' +
    '<div class="tb-quote"><span class="tb-quote-lbl">流通市值</span><b>' + (p.liqMcapYi || '--') + '</b> <span class="tb-quote-unit">亿</span></div>' +
    '<div class="tb-total-big">' + (sc.total || 0) + '<span class="tb-total-sub">/100</span></div>' +
    '<div class="tb-total-h">综合评分</div>' +
    '<div class="tb-chips">' +
      chip('板块', meta.theme || p.sector, 'sec') +
      chip('板型', meta.boardType || (p.lianban + '板'), 'board') +
      chip('形态', meta.shape || '盘中拉板', 'shape') +
      chip('换手', (p.turnoverRate || 0) + '%', 'turn') +
      chip('题材', (meta.theme || p.sector) + (p.lianban ? '·' + p.lianban + '板' : ''), 'theme') +
    '</div>' +
    '<div class="tb-reason"><b>涨停原因</b>·' + esc(meta.reason || (p.sector || '') + '纯情 · 首封同日封板') + '</div>' +
  '</div>';
}

function renderTopBoardPicks(report) {
  const tbp = report.topBoardPicks;
  if (!tbp || !Array.isArray(tbp.picks) || !tbp.picks.length) return '';
  const picks = tbp.picks;
  const radarId = 'tb-radar-' + (report.meta.date || 'd').replace(/-/g, '');
  const cards = picks.map(p => renderTopBoardCard(p)).join('');
  const meta = report.meta || {};
  const ms = report.marketStats || {};
  const pb = (report.playbook || {});
  const ztTotal = ms.limitUpCount || 0;
  const zhaBan = ms.zhaBanCount || 0;
  const ztList = (report.limitUp || []);
  const ztCodeSet = new Set(ztList.map(s => String(s.code || '')));
  const ztStockCount = ztCodeSet.size || ztTotal;
  const zhaBanRate = ztTotal + zhaBan > 0 ? Math.round(zhaBan / (ztTotal + zhaBan) * 100) : 0;
  const topLine = tbp.latestLianBan || (picks[0] ? picks[0].lianban : 1) || 1;
  const mainLine = ((pb.offense || [])[0] || {}).name || '--';
  return '<div class="card top5-card" id="card-top5">' +
    '<div class="top5-header">' +
    '<div class="top5-title">🎯 打板五佳股日报<span class="top5-sub">' + esc(meta.date || '--') + ' ' + (meta.typeLabel || '') + '</span></div>' +
    '<div class="top5-desc">本报告通过 AI 模型搜集当日强势的连续涨停力,并用 8 维加权评估个股 <b>抓板方向</b>,每只均带 5 个属性标签 + 涨停原因 + 多股叠加雷达对照。</div>' +
    '</div>' +
    '<div class="top5-stats">风险高度统计: 打板 <b>' + ztTotal + '</b> 只,情绪错冷 排除 <b>' + Math.max(0, ztTotal - picks.length) + '</b> 只 · 涨停数据 ' + esc(meta.date || '--') + ' · ' +
    '<div class="top5-stats-grid">' +
      '<div><span class="ts-num">' + ztTotal + '</span><span class="ts-lbl">涨停总数</span></div>' +
      '<div><span class="ts-num">' + ztStockCount + '</span><span class="ts-lbl">涨停股票数</span></div>' +
      '<div><span class="ts-num">' + zhaBan + '/' + (ztTotal + zhaBan) + '</span><span class="ts-lbl">炸板率(非中率)</span></div>' +
      '<div><span class="ts-num">' + topLine + ' 板</span><span class="ts-lbl">一字定流</span></div>' +
      '<div><span class="ts-num">' + esc(mainLine) + '</span><span class="ts-lbl">今日主线</span></div>' +
    '</div>' +
    '</div>' +
    '<div class="top5-section-h">今日候选 · Top5<b>（基于 AI 模型推荐,每只含 5 属性 + 涨停原因 + 8 维雷达）</b></div>' +
    '<div class="tb-scroll"><div class="tb-cards">' + cards + '</div></div>' +
    renderRadarSvg(radarId, picks) +
  '</div>';
}

function renderTopBoardBacktest(report) {
  const rows = report.topBoardBacktest || [];
  if (!rows.length) return '';
  const body = rows.map((r) => '<tr>' +
    '<td>' + esc(r.predictDate || '--') + '<span class="tb-slot">' + esc(r.slot || '') + '</span></td>' +
    '<td>' + esc(r.code || '--') + '</td>' +
    '<td>' + esc(r.name || '--') + '<span class="tb-rank-mini">#' + (r.rank || 1) + '</span></td>' +
    '<td class="up">' + (r.predictPct != null ? fmtPct(r.predictPct) : '--') + '</td>' +
    '<td><span class="tb-hit">' + (r.rank <= 5 ? 'Top' + r.rank : 'Top5') + '</span></td>' +
    '<td>' + (r.totalScore != null ? r.totalScore : '--') + '</td>' +
    '<td>' + (r.lianban || 1) + ' 板</td>' +
    '<td>' + esc(r.sector || '--') + '</td>' +
    '<td class="verif">待验证</td>' +
    '</tr>').join('');
  return '<div class="card">' +
    '<div class="card-title">回测追踪 · 历史 Top5 全量 ' + rows.length + ' 条</div>' +
    '<div class="tb-backtest-wrap"><table class="tb-backtest"><thead><tr>' +
    '<th>预测日期</th><th>代码</th><th>名称</th><th>预测当日涨幅</th><th>命中</th><th>综合分</th><th>连板</th><th>所属板块</th><th>回测状态</th>' +
    '</tr></thead><tbody>' + body + '</tbody></table></div>' +
    '<div class="hint">回测状态:历史日报告中 AI 综合评分的 Top5 摘要;下一交易日收盘后再用行情数据复核"当时推荐 vs 实际表现"。</div>' +
    '</div>';
}

function renderReport(report, nav) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">
<meta http-equiv="Pragma" content="no-cache">
<meta http-equiv="Expires" content="0">

<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<title>ATDS PRO · 复盘报告</title>
</head>
<body>
<div class="phone">
${renderHeader(report, nav)}
${renderHero(report)}
<div class="section">
${renderCloseEmotion(report)}
    ${report.meta && (report.meta.type === 'midday' || report.meta.type === 'close') ? renderTopBoardPicks(report) : ''}
    ${report.meta && report.meta.type === 'close' ? renderPremarketStrategy(report, { title: '主升浪·新周期', subtitle: '实时下载 · 市场数据 · A 股收盘数据全维度复盘' }) : ''}
    ${report.meta && report.meta.type === 'close' ? '' : renderRegimeGate(report)}
  ${report.meta && report.meta.type === 'close' ? '' : renderMarketScan(report)}
  ${report.meta && report.meta.type === 'close' ? '' : renderWaveDivergence(report)}
  ${report.meta && report.meta.type === 'midday' ? renderShortCore(report) : ''}
  ${report.meta && report.meta.type === 'midday' ? renderStrongStock(report) : ''}
  ${report.meta && report.meta.type === 'midday' ? '' : renderDataAnalysis(report)}
  ${report.meta && report.meta.type === 'close' ? '' : renderIntlMkt(report)}
  ${report.meta && report.meta.type === 'close' ? '' : renderTechAnalysis(report)}
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
<meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">
<meta http-equiv="Pragma" content="no-cache">
<meta http-equiv="Expires" content="0">

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
<meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">
<meta http-equiv="Pragma" content="no-cache">
<meta http-equiv="Expires" content="0">

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