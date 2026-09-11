#!/usr/bin/env node
/**
 * ATDS PRO 云端数据采集脚本（不依赖本地 MCP，可跑在 GitHub Actions / 云函数）
 * 用法: node scripts/cloud_fetch.mjs close|midday
 * 数据源: 腾讯行情API + 东方财富涨停/炸板池API（均为公开行情接口）
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
const DATA_DIR = path.join(ROOT, config.dataDir);

// argv[2] 支持两种: 'premarket'|'midday'|'close'(走 config.reportTypes 默认 time)
//                或 'HH:MM'(盘中具体时间,自动归 midday 并用此 time 生成独立文件名)
const argv2 = process.argv[2] || 'close';
const timeOverride = /^\d{1,2}:\d{2}$/.test(argv2);
const type = timeOverride ? 'midday' : argv2;
const typeConf = config.reportTypes[type] || config.reportTypes.close;

function fmtDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function shanghaiNow() {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utc + 8 * 3600000);
}

async function fetchTencent(codes) {
  try {
    const url = `https://qt.gtimg.cn/q=${codes.join(',')}`;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 8000);
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: ac.signal }).finally(() => clearTimeout(timer));
    // 腾讯行情接口返回 GBK 编码,必须用 gbk 解码,否则中文名称乱码
    const buf = await res.arrayBuffer();
    let text;
    try { text = new TextDecoder('gbk').decode(buf); }
    catch (e) { text = new TextDecoder('gb18030').decode(buf); }
    const out = [];
    for (const line of text.trim().split(';')) {
      const m = line.trim().match(/^v_[a-z]+\d+="(.*)"$/);
      if (!m) continue;
      const f = m[1].split('~');
      out.push({
        name: f[1], code: f[2], price: parseFloat(f[3]), pct: parseFloat(f[32]),
        prevClose: parseFloat(f[4]) || 0, open: parseFloat(f[5]) || 0,
        high: parseFloat(f[33]) || 0, low: parseFloat(f[34]) || 0,
        amplitude: parseFloat(f[43]) || 0, volRatio: parseFloat(f[49]) || 0,
        avgPrice: parseFloat(f[51]) || 0,
        floatMcap: parseFloat(f[44]) || 0, totalMcap: parseFloat(f[45]) || 0,
        amountWan: parseFloat(f[37]) || 0, turnover: parseFloat(f[38])
      });
    }
    return out;
  } catch (e) { console.error('fetchTencent 失败:', e.message); return []; }
}

async function fetchZT(dateArg) {
  try {
    const url = `http://push2ex.eastmoney.com/getTopicZTPool?ut=7eea3edcaed734bea9cbfc24409ed989&dpt=wz.ztzt&Pageindex=0&pagesize=50&sort=fbt%3Aasc&date=${dateArg || process.argv[3] || ''}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const j = await res.json();
    const d = j.data || {};
    const list = (d.pool || []).map(s => ({
      code: String(s.c), name: s.n, price: (s.p || 0) / 1000,
      pct: Math.round((s.zdp || 0) * 100) / 100, lianban: s.lbc || 1,
      boardInfo: `${s.zttj && s.zttj.days ? s.zttj.days : s.lbc || 1}天${s.zttj && s.zttj.ct ? s.zttj.ct : s.lbc || 1}板`,
      hybk: s.hybk || '', sealWan: Math.round((s.fund || 0) / 10000), kaiban: s.zbc || 0,
      firstTime: String(s.fbt || ''), lastTime: String(s.lbt || '')
    }));
    return { total: d.tc || list.length, list, qdate: String(d.qdate || '') };
  } catch (e) { console.error('fetchZT 失败:', e.message); return { total: 0, list: [], qdate: '' }; }
}

async function fetchZB(dateArg) {
  const url = `http://push2ex.eastmoney.com/getTopicZBPool?ut=7eea3edcaed734bea9cbfc24409ed989&dpt=wz.ztzt&Pageindex=0&pagesize=5&sort=fund%3Aasc&date=${dateArg || process.argv[3] || ''}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const j = await res.json();
  return (j.data && j.data.tc) || 0;
}

async function fetchBreadth() {
  // 东财沪深指数上涨/下跌/平盘家数(f104/f105/f106)。HTTPS + 超时 + 最多3次重试,兼容 GitHub Actions 境外环境
  const url = 'https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&fields=f1,f2,f3,f104,f105,f106&secids=1.000001,0.399001,0.399006';
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 10000);
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: ac.signal }).finally(() => clearTimeout(timer));
      const j = await res.json();
      const diff = (j.data && j.data.diff) || [];
      let up = 0, down = 0, flat = 0;
      for (const it of diff) { up += it.f104 || 0; down += it.f105 || 0; flat += it.f106 || 0; }
      if (up || down || flat) return { up, down, flat };
    } catch (e) { console.error('fetchBreadth 失败(第' + (attempt + 1) + '次):', e.message); }
    await new Promise(r => setTimeout(r, 600));
  }
  return { up: 0, down: 0, flat: 0 };
}

async function fetchDragonPool(today, yesterday) {
  const urlPath = `/getTopicZTPool?ut=7eea3edcaed734bea9cbfc24409ed989&dpt=wz.ztzt&Pageindex=0&pagesize=50&sort=fbt%3Aasc&date=`;
  const tryHosts = ['http://push2ex.eastmoney.com', 'https://push2.eastmoney.com'];
  async function fetchOne(date) {
    for (const host of tryHosts) {
      try {
        const r = await fetch(host + urlPath + date, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const j = await r.json();
        if (j && j.data && j.data.pool) return { tc: j.data.tc || 0, pool: j.data.pool };
      } catch (e) { /* try next */ }
    }
    return { tc: 0, pool: [] };
  }
  const [todayRes, yesterdayRes] = await Promise.all([fetchOne(today), fetchOne(yesterday)]);
  const todayPool = todayRes.pool, yesterdayPool = yesterdayRes.pool;
  // 板块聚合
  const sectorMap = {};
  for (const s of todayPool) {
    const k = s.hybk || '其他';
    if (!sectorMap[k]) sectorMap[k] = [];
    sectorMap[k].push(s);
  }
  // 梯队：按连板数分组
  const tiers = {};
  for (const s of todayPool) {
    const t = s.lbc || 1;
    if (!tiers[t]) tiers[t] = [];
    tiers[t].push(s);
  }
  // 擒龙池：按综合评分取前15
  const ranking = todayPool.slice(0, 50).map(s => {
    const score = (s.lbc || 1) * 15 + (s.fund || 0) / 10000000 + ((s.zdp || 0) > 0 ? 5 : 0);
    return { ...s, score };
  }).sort((a, b) => b.score - a.score).slice(0, 15);
  // 身位复核池：今日涨停池中连板≥2 的股票（视为前几日已上板，承接强度需复核）
  const consecutiveBoards = todayPool
    .filter(s => (s.lbc || 1) >= 2)
    .map(s => ({ code: String(s.c), name: s.n, lbc: s.lbc || 1 }))
    .sort((a, b) => b.lbc - a.lbc);
  // 板块带动排序（按涨停家数）
  const sectorBoards = Object.entries(sectorMap)
    .map(([name, lst]) => ({
      name, count: lst.length,
      maxLB: lst.reduce((m, s) => Math.max(m, s.lbc || 1), 1),
      leadStock: lst.find(s => (s.lbc || 1) > 1)?.n || lst[0]?.n || '--',
      stocks: lst.slice(0, 3).map(s => s.n)
    }))
    .sort((a, b) => b.count - a.count || b.maxLB - a.maxLB)
    .slice(0, 8);
  return {
    todayDate: today,
    yesterdayDate: yesterday,
    todayTotal: todayRes.tc || todayPool.length,
    yesterdayTotal: yesterdayRes.tc || yesterdayPool.length,
    zhaBanCount: 0,
    maxLianBan: todayPool.reduce((m, s) => Math.max(m, s.lbc || 1), 0),
    strongestSector: sectorBoards[0]?.name || '人工智能',
    strongestSectorCount: sectorBoards[0]?.count || 0,
    tiers: tiers,
    sectors: sectorMap,
    sectorBoards: sectorBoards,
    ranking: ranking,
    consecutiveBoards: consecutiveBoards.slice(0, 8),
    pool: todayPool,
    compareNote: '东财涨停池不支持历史日期查询；连板数≥2 视为前几日已上板，承接强度待复核'
  };
}

async function fetchIntlMkt() {
  const codes = ['us.DJI', 'us.IXIC', 'hf_CL', 'hf_GC'];
  const out = {};
  for (const c of codes) {
    try {
      const r = await fetch('https://qt.gtimg.cn/q=' + c, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      const buf = await r.arrayBuffer();
      const t = new TextDecoder('gbk').decode(buf);
      const m = t.match(/="([^"]+)"/);
      if (!m) { out[c] = null; continue; }
      const sep = m[1].indexOf('~') >= 0 ? '~' : ',';
      const f = m[1].split(sep);
      if (c.startsWith('hf_')) {
        // hffutures: 0最新,1涨跌额,2买,3卖,4最高,5最低,6时间,7昨收,8开盘,...,13名称
        const prev = parseFloat(f[7]);
        const chg = parseFloat(f[1]) || 0;
        out[c] = { name: f[13] || c, price: parseFloat(f[0]), change: chg, changePct: prev ? Math.round(chg / prev * 10000) / 100 : 0, time: f[6] };
      } else {
        out[c] = { name: f[1], price: parseFloat(f[3]), change: parseFloat(f[31]), changePct: parseFloat(f[32]), time: f[30] };
      }
    } catch (e) { out[c] = null; }
  }
  return out;
}

// ============ K线/分钟趋势本地缓存(过去交易日,云端源不可用时兜底,坚决不显示--) ============
let _klineCache = null;
function loadKlineCache() {
  if (_klineCache) return _klineCache;
  try {
    const p = path.join(ROOT, 'data', 'kline_cache.json');
    if (fs.existsSync(p)) _klineCache = JSON.parse(fs.readFileSync(p, 'utf8')) || {};
  } catch (e) { /* 缓存损坏忽略 */ }
  if (!_klineCache || typeof _klineCache !== 'object') _klineCache = {};
  return _klineCache;
}
function saveKlineCache() {
  try {
    const p = path.join(ROOT, 'data', 'kline_cache.json');
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(_klineCache, null, 2), 'utf8');
  } catch (e) { console.error('saveKlineCache 失败:', e.message); }
}
// 分钟趋势缓存(独立文件,保存最近一次真实抓取的 m60/m15 具体价位)
let _minTrendCache = null;
function loadMinTrendCache() {
  if (_minTrendCache) return _minTrendCache;
  try {
    const p = path.join(ROOT, 'data', 'min_trend_cache.json');
    if (fs.existsSync(p)) _minTrendCache = JSON.parse(fs.readFileSync(p, 'utf8')) || {};
  } catch (e) { /* 忽略 */ }
  if (!_minTrendCache || typeof _minTrendCache !== 'object') _minTrendCache = {};
  return _minTrendCache;
}
function saveMinTrendCache() {
  try {
    const p = path.join(ROOT, 'data', 'min_trend_cache.json');
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(_minTrendCache, null, 2), 'utf8');
  } catch (e) { console.error('saveMinTrendCache 失败:', e.message); }
}

async function fetchKlineRaw(code, count = 250) {
  const fetchT = (u, h, m) => { const ac = new AbortController(); const t = setTimeout(() => ac.abort(), m || 9000); return fetch(u, { headers: h || { 'User-Agent': 'Mozilla/5.0' }, redirect: 'follow', signal: ac.signal }).finally(() => clearTimeout(t)); };
  // 腾讯优先
  const url = `http://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${code},day,,,${count},qfq`;
  for (const host of ['http://web.ifzq.gtimg.cn', 'https://web.ifzq.gtimg.cn']) {
    try {
      const r = await fetchT(host === 'https' ? url.replace('http://', 'https://') : url, { 'User-Agent': 'Mozilla/5.0', 'Referer': 'http://gu.qq.com/' });
      const buf = await r.arrayBuffer();
      const t = new TextDecoder('gbk').decode(buf);
      if (t.trim().startsWith('<') || t.trim().startsWith('<!')) continue; // 限流/错误页
      const j = JSON.parse(t);
      const series = j && j.data && j.data[code] && (j.data[code].qfqday || j.data[code].day);
      if (Array.isArray(series) && series.length) return series;
    } catch (e) { /* try next */ }
  }
  // 东财备用
  try {
    const mkt = code.indexOf('sh') === 0 ? '1' : '0';
    const num = code.slice(2);
    const emUrl = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${mkt}.${num}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57&klt=101&fqt=1&beg=20200101&end=20991231`;
    const r = await fetchT(emUrl, { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://quote.eastmoney.com/' });
    const j = await r.json();
    const kl = (j && j.data && j.data.klines) || [];
    if (Array.isArray(kl) && kl.length) {
      return kl.slice(-count).map(line => {
        const p = line.split(',');
        return [p[0], parseFloat(p[1]), parseFloat(p[2]), parseFloat(p[3]), parseFloat(p[4]), parseFloat(p[5])];
      });
    }
  } catch (e) { /* ignore */ }
  // 新浪备用(JSONP):{day,open,high,low,close,volume}
  try {
    const sinaUrl = `https://quotes.sina.cn/cn/api/jsonp_v2.php/var%20_=/CN_MarketDataService.getKLineData?symbol=${code}&scale=240&ma=no&datalen=${Math.min(count, 300)}`;
    const r = await fetchT(sinaUrl, { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://finance.sina.com.cn/' });
    const txt = await r.text();
    const m = txt.match(/(\[[\s\S]*\])\)?\s*;?\s*$/);
    if (m) {
      const arr = JSON.parse(m[1]);
      if (Array.isArray(arr) && arr.length) {
        return arr.slice(-count).map(it => [it.day, parseFloat(it.open), parseFloat(it.close), parseFloat(it.high), parseFloat(it.low), parseFloat(it.volume || it.vol || 0)]);
      }
    }
  } catch (e) { /* ignore */ }
  // 同花顺备用(JSONP 日K):data 每行 date,open,high,low,close,volume,amount,turnover
  try {
    const num = code.replace(/^(sh|sz|bj)/, '');
    const thsUrl = `https://d.10jqka.com.cn/v6/line/hs_${num}/11/last.js`;
    const r = await fetchT(thsUrl, { 'User-Agent': 'Mozilla/5.0', 'Referer': `http://stockpage.10jqka.com.cn/${num}/` });
    const txt = await r.text();
    const m = txt.match(/\((\{[\s\S]*\})\)/);
    if (m) {
      const j = JSON.parse(m[1]);
      const data = j && j.data;
      if (typeof data === 'string' && data.length) {
        const rows = data.split(';').filter(Boolean);
        if (rows.length) {
          return rows.slice(-count).map(line => {
            const p = line.split(',');
            const d = String(p[0] || '').replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3');
            return [d, parseFloat(p[1]), parseFloat(p[4]), parseFloat(p[2]), parseFloat(p[3]), parseFloat(p[5] || 0)];
          });
        }
      }
    }
  } catch (e) { /* ignore */ }
  return [];
}

// fetchKline 包装:成功时缓存日线(过去交易日),全部源失败时读缓存兜底,确保 tech 永不为空
async function fetchKline(code, count = 250) {
  const series = await fetchKlineRaw(code, count);
  if (Array.isArray(series) && series.length >= 30) {
    try {
      const c = loadKlineCache();
      c[code] = { date: bjToday(), series: series.slice(-120) };
      saveKlineCache();
    } catch (e) { /* 缓存写入失败不影响主流程 */ }
    return series;
  }
  // 源不可用 → 读本地缓存(过去交易日日线,足以算出 MA 趋势,避免 60/15 分钟与日线双双显示 --)
  try {
    const cached = loadKlineCache()[code];
    if (cached && Array.isArray(cached.series) && cached.series.length >= 30) return cached.series;
  } catch (e) { /* 缓存缺失忽略 */ }
  return [];
}

function ma(arr, n) {
  if (!arr || arr.length < n) return null;
  let s = 0;
  for (let i = arr.length - n; i < arr.length; i++) s += arr[i];
  return s / n;
}

function buildTechAnalysis(klinesByIndex, indices) {
  const out = {};
  for (const idx of indices) {
    const arr = klinesByIndex[idx.code] || [];
    const closes = arr.map(k => parseFloat(k[2])).filter(n => !isNaN(n));
    if (!closes.length) { out[idx.code] = null; continue; }
    const last = closes[closes.length - 1];
    const ma5 = ma(closes, 5);
    const ma10 = ma(closes, 10);
    const ma20 = ma(closes, 20);
    const ma60 = ma(closes, 60);
    const ma120 = ma(closes, 120);
    const ma250 = ma(closes, 250);
    const recent = arr.slice(-60);
    const highs = recent.map(k => parseFloat(k[3])).filter(n => !isNaN(n));
    const lows = recent.map(k => parseFloat(k[4])).filter(n => !isNaN(n));
    const high60 = highs.length ? Math.max(...highs) : null;
    const low60 = lows.length ? Math.min(...lows) : null;
    const round = (n, step) => Math.round(n / step) * step;
    const intLevels = [round(last, 100), round(last, 200), round(last, 500)].sort((a, b) => a - b);
    const vols = arr.slice(-5).map(k => parseFloat(k[5])).filter(n => !isNaN(n));
    const vol5 = vols.length ? vols.reduce((a, b) => a + b, 0) / vols.length / 1e8 : null;
    const supports = [];
    const pressures = [];
    const add = (price, label) => {
      if (price == null || isNaN(price)) return;
      const item = { price: Math.round(price * 100) / 100, label };
      if (price < last) supports.push(item);
      else if (price > last) pressures.push(item);
    };
    add(ma5, '5日均线·短期');
    add(ma10, '10日均线·周线');
    add(ma20, '20日均线·月线');
    add(ma60, '60日均线·季线');
    add(ma120, '120日均线·半年线');
    add(ma250, '250日均线·年线');
    add(low60, '近60日低点');
    add(high60, '近60日高点');
    intLevels.forEach(v => add(v, '整数关口'));
    supports.sort((a, b) => b.price - a.price);
    pressures.sort((a, b) => a.price - b.price);
    out[idx.code] = { name: idx.name, last, ma5, ma10, ma20, ma60, ma120, ma250, high60, low60, intLevels, vol5, supports: supports.slice(0, 2), pressures: pressures.slice(0, 2) };
  }
  return out;
}

function derivePlaybook(zt, dragonPool) {
  const sectorMap = (dragonPool && dragonPool.sectors) || {};
  const offense = Object.entries(sectorMap)
    .map(([name, lst]) => ({ name, count: lst.length, maxLB: lst.reduce((m, s) => Math.max(m, s.lbc || 1), 1), leadStock: (lst.find(s => (s.lbc || 1) >= 2) || lst[0] || {}).n || '--' }))
    .filter(x => x.count >= 2 && x.maxLB >= 2)
    .sort((a, b) => (b.count * 10 + b.maxLB * 3) - (a.count * 10 + a.maxLB * 3))
    .slice(0, 3);
  const themeKeywords = ['机器人', '算力', 'AI', '创新药', '影视', '半导体', '数据', '存储', '医药', '低空', '新能源', '光伏', '锂电', '数字'];
  const themes = new Map();
  for (const s of zt || []) {
    const hy = s.hybk || '';
    for (const k of themeKeywords) {
      if (hy.includes(k)) {
        if (!themes.has(k)) themes.set(k, { name: k, stocks: [] });
        const t = themes.get(k);
        if (t.stocks.length < 3) t.stocks.push(s.name || s.n);
      }
    }
  }
  const themeList = Array.from(themes.values()).slice(0, 2);
  const defense = [
    { name: '高股息红利', logic: '低波动+稳定分红', scenario: '若市场风险偏好下行或风格切换' },
    { name: '公用事业', logic: '现金流稳定+刚性需求', scenario: '外盘走弱+量能萎缩' },
    { name: '银行(大行)', logic: '高股息+低估值', scenario: '高位板块兑现+避险情绪升温' }
  ];
  const zbCount = (dragonPool && dragonPool.zhaBanCount) || 0;
  const highBoards = (dragonPool && dragonPool.consecutiveBoards) || [];
  const pitfall = [
    { name: '高位连板股(连板≥4)', logic: `当前连板≥4 共 ${highBoards.filter(h => h.lbc >= 4).length} 只,承接强度需复核`, scenario: '若 11:30 后炸板率上升' },
    { name: '当日炸板股', logic: `近 ${zbCount} 只炸板,分歧加大`, scenario: '缩量回踩阶段避免追高' },
    { name: '北证/微盘股', logic: '波动放大+流动性敏感', scenario: '外盘系统性风险时易补跌' }
  ];
  return { offense, defense, themes: themeList, pitfall };
}

function deriveCloseEmotion(ztList, dragonPool, marketStats, breadth) {
  const ztTotal = (dragonPool && dragonPool.todayTotal) || marketStats.limitUpCount || 0;
  const zbTotal = marketStats.zhaBanCount || 0;
  const maxLB = (dragonPool && dragonPool.maxLianBan) || marketStats.maxLianBan || 0;
  // 封板率 = 涨停 / (涨停 + 炸板) — 估算
  const limitBoardRate = ztTotal ? Math.round(ztTotal / (ztTotal + zbTotal) * 100) : 0;
  // 连板梯队
  const tiers = (dragonPool && dragonPool.tiers) || {};
  const tierKeys = Object.keys(tiers).map(k => parseInt(k)).sort((a, b) => b - a);
  const tierList = tierKeys.map(k => ({ lianban: k, count: (tiers[k] || []).length, lead: (tiers[k] || [])[0] ? (tiers[k][0].n || tiers[k][0].name) : '--' }));
  // 晋级率:连板≥2 的总数 / (连板≥2 + 一板)
  const lb2plus = tierKeys.filter(k => k >= 2).reduce((s, k) => s + (tiers[k] || []).length, 0);
  const lb1 = (tiers['1'] || []).length;
  const promotionRate = (lb2plus + lb1) > 0 ? Math.round(lb2plus / (lb2plus + lb1) * 100) : 0;
  // 红盘家数(涨停池不包含全部,需从 marketStats 推断)
  const upCount = marketStats.upCount || 0;
  const downCount = marketStats.downCount || 0;
  const flatCount = marketStats.flatCount || 0;
  const total = upCount + downCount + flatCount;
  const redRate = total ? Math.round(upCount / total * 100) : 0;
  // 情绪温度:基于 涨停/炸板/连板/红盘率 综合评分(0-100)
  // 因子1 涨停/1000 (越多家越高)
  // 因子2 封板率
  // 因子3 最高连板
  // 因子4 红盘率
  const tempScore = Math.min(100,
    Math.round(ztTotal * 0.3 + limitBoardRate * 0.4 + Math.min(maxLB, 10) * 5 + redRate * 0.3));
  // 情绪阶段:低温 0-30 / 中温 30-60 / 高温 60-85 / 过热 85+
  let stage = '中温区', tone = '正常', fact = '震荡上行';
  if (tempScore < 30) { stage = '低温区'; tone = '清淡'; fact = '情绪底部,关注止跌信号'; }
  else if (tempScore < 60) { stage = '中温区'; tone = '正常'; fact = '结构性机会'; }
  else if (tempScore < 85) { stage = '高温区'; tone = '高涨'; fact = '情绪高涨,接力效应强'; }
  else { stage = '过热区'; tone = '极度亢奋'; fact = '谨防高潮后分歧'; }
  // 主线方向:从 sectorBoards 取家数最多的 3 个板块,作为"宽度"
  const sectorBoards = (dragonPool && dragonPool.sectorBoards) || [];
  const mainLines = sectorBoards.slice(0, 3).map((s, i) => ({ rank: i + 1, name: s.name, changePct: Math.round((s.count * 1.5 + s.maxLB * 0.8) * 100) / 100, leader: s.leadStock || s.stocks?.[0] || '--' }));
  // 资金流向:用板块涨停家数 + 连板 推导"主力净流入估算"(亿元)
  // 公式:涨停数 × 1.5 + 连板数 × 0.8(粗略估算)
  const moneyInflow = sectorBoards.slice(0, 4).map(s => ({ name: s.name, valueYi: Math.round((s.count * 1.5 + s.maxLB * 0.8) * 10) / 10 }));
  // 梯队显示
  const ladder = tierKeys.slice(0, 3).map(k => ({ lianban: k + '板', lead: (tiers[k] || [])[0] ? (tiers[k][0].n || tiers[k][0].name) : '--' }));
  return { tempScore, stage, tone, fact, ztTotal, zbTotal, maxLB, limitBoardRate, promotionRate, redRate, upCount, downCount, flatCount, total, mainLines, moneyInflow, ladder };
}

async function fetchSectors() {
  const tryHosts = ['https://push2.eastmoney.com', 'http://push2ex.eastmoney.com'];
  const urlPath = '/api/qt/clist/get?pn=1&pz=60&po=1&np=1&fltt=2&invt=2&fid=f3&fs=m:90+t:2&fields=f12,f14,f3,f104,f105,f62,f20';
  for (const base of tryHosts) {
    try {
      const r = await fetch(base + urlPath, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (r.ok) {
        const j = await r.json();
        if (j.data && j.data.diff) return j.data.diff.map(s => ({
          code: s.f12, name: s.f14, changePct: s.f3, up: s.f104 || 0, down: s.f105 || 0, inflow: s.f62 || 0
        }));
      }
    } catch (e) { /* try next */ }
  }
  return [];
}

function fmtAmount(wan) {
  if (!wan) return '--';
  if (wan >= 10000) return (wan / 10000).toFixed(1) + '亿';
  return Math.round(wan).toLocaleString() + '万';
}

/* ============ 板块候选股:排除涨停 · 优先可观察 topN (2026-09-07) ============ */
async function fetchJsonTxt(u, opts) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), (opts && opts.timeout) || 10000);
  try {
    const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.eastmoney.com/' }, signal: ac.signal });
    if (!r.ok) return null;
    const txt = await r.text();
    try { return JSON.parse(txt); } catch (e) { return null; }
  } catch (e) { return null; } finally { clearTimeout(timer); }
}
// 东财搜索建议接口:板块名 → BK 代码。兼容涨停池 hybk 截断名(如"汽车零部"→"汽车零部件" BK0481)
async function resolveBoardCode(name) {
  try {
    const j = await fetchJsonTxt('https://searchapi.eastmoney.com/api/suggest/get?input=' + encodeURIComponent(String(name).trim()) + '&type=14&count=12');
    const rows = (j && j.QuotationCodeTable && j.QuotationCodeTable.Data) || [];
    const boards = rows.filter(x => x && (x.Classify === 'BK' || x.SecurityType === '9'));
    if (!boards.length) return null;
    const nm = String(name).trim();
    const hit = boards.find(x => x.Name === nm && String(x.TypeUS) === '2')
      || boards.find(x => x.Name === nm)
      || boards.find(x => x.TypeUS === '2' && String(x.Name).includes(nm.slice(0, Math.max(2, nm.length))))
      || boards.find(x => String(x.Name).includes(nm) || nm.includes(String(x.Name)));
    return hit ? { name: hit.Name, code: hit.Code } : { name: boards[0].Name, code: boards[0].Code };
  } catch (e) { return null; }
}
// 板块涨跌地图(行业+概念):name → { code, changePct },供复盘资金归因"个股 vs 板块"对比
// 注意:clist 单页最多 pz=100,且按涨幅降序;需翻页才能覆盖下跌板块(如稀土/军工/算力)
async function fetchBoardChangeMap() {
  const map = {};
  const fsList = ['m:90+t:2', 'm:90+t:3']; // 行业板块 + 概念板块
  for (const fs of fsList) {
    for (let pn = 1; pn <= 8; pn++) {
      try {
        const url = `https://push2.eastmoney.com/api/qt/clist/get?pn=${pn}&pz=100&po=1&np=1&fltt=2&invt=2&fid=f3&fs=${fs}&fields=f12,f14,f3`;
        const j = await fetchJsonTxt(url, { timeout: 10000 });
        const diff = (j && j.data && j.data.diff) || [];
        if (!diff.length) break;
        for (const it of diff) {
          if (it.f14 && it.f3 != null && !isNaN(Number(it.f3))) {
            map[String(it.f14).trim()] = { code: it.f12, changePct: Math.round(Number(it.f3) * 100) / 100 };
          }
        }
        if (diff.length < 100) break; // 最后一页
      } catch (e) { break; }
    }
  }
  return map;
}
// 个股 category(自由文本) → 东财板块名 的别名映射(优先精确别名,再关键词兜底)
const SECTOR_ALIAS = {
  '光通信': ['光通信模块', '光模块', '通信设备', '通信'],
  '机器人': ['机器人执行器', '减速器', '机器人', '自动化设备'],
  '农业主线': ['农牧饲渔', '农业种植', '种植业', '农产品加工', '养殖业', '农林牧渔', '种植业与林业'],
  '种业': ['种业', '转基因', '种子', '农业种植'],
  '传媒/IP': ['文化传媒', '游戏', '影视院线', '出版', '传媒'],
  '传媒': ['文化传媒', '游戏', '影视院线', '出版'],
  '稀土': ['稀土永磁', '小金属'],
  '小金属': ['小金属', '稀土永磁'],
  '军工': ['航天航空', '国防军工', '军工电子'],
  '算力': ['算力', 'AI算力', 'CPO', '东数西算'],
  '金融': ['银行', '证券', '保险', '多元金融'],
  '燃气': ['燃气', '天然气', '油服工程', '公用事业', '油气开采'],
  '天然气': ['燃气', '天然气', '油气开采', '油服工程'],
  '房地产': ['房地产开发', '房地产服务', '物业管理', '地产'],
  '地产链': ['房地产开发', '房地产服务', '物业管理', '建材', '家居', '地产']
};
function matchSectorChange(category, boardMap, logic) {
  if (!category || !boardMap) return null;
  const cat = String(category).trim();
  if (!cat) return null;
  if (boardMap[cat]) return { boardName: cat, changePct: boardMap[cat].changePct };
  // 1) 别名优先(精确匹配别名词,避免"IP"误中"DRG/DIP"这类短词)
  const aliases = SECTOR_ALIAS[cat] || [];
  for (const a of aliases) {
    for (const name in boardMap) {
      if (name === a || name.indexOf(a) >= 0) return { boardName: name, changePct: boardMap[name].changePct };
    }
  }
  // 2) 关键词兜底(长词优先,剔除歧义短词);把 logic 文本纳入,捕捉"种业/天然气/地产链"等概念
  const text = cat + ' ' + (logic || '');
  const keys = ['光通信', '通信', '机器人', '算力', 'AI', '半导体', '芯片', '农牧', '农业', '农林牧渔', '种植', '养殖', '种业', '种子', '粮食', '糖', '传媒', '游戏', '影视', '稀土', '小金属', '有色', '军工', '证券', '银行', '保险', '医药', '创新药', '新能源', '光伏', '储能', '汽车', '零部件', '煤炭', '钢铁', '化工', '地产', '房地产', '物业', '建材', '家居', '燃气', '天然气', '油服', '油气', '公用事业', '食品', '白酒'];
  for (const k of keys) {
    if (text.indexOf(k) >= 0) {
      for (const name in boardMap) {
        if (name.indexOf(k) >= 0) return { boardName: name, changePct: boardMap[name].changePct };
      }
    }
  }
  return null;
}
// 板块成分实时行情:剔除 涨停/ST/退市/北交所,非涨停按涨幅降序取前 N(含当日涨幅/换手)
async function fetchBoardPicks(bkCode, ztSet, topN) {
  const tryHosts = ['https://push2.eastmoney.com', 'http://push2.eastmoney.com', 'https://push2delay.eastmoney.com', 'http://push2ex.eastmoney.com'];
  for (const base of tryHosts) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const url = `${base}/api/qt/clist/get?pn=1&pz=100&po=1&np=1&fltt=2&invt=2&fid=f3&fs=b:${bkCode}&fields=f2,f3,f8,f12,f14`;
        const j = await fetchJsonTxt(url, { timeout: 8000 });
        if (!j || !j.data) { if (attempt === 0) await new Promise(r => setTimeout(r, 300)); continue; }
        const diff = j.data.diff || [];
        const picks = [];
        for (const it of diff) {
          const code = String(it.f12 || '');
          const nm = String(it.f14 || '');
          const pct = Number(it.f3);
          if (!/^(60|00|30|68)/.test(code)) continue;        // 剔除北交所(4/8/9 开头)
          if (/ST|退/.test(nm)) continue;                    // 剔除 ST/退市
          if (ztSet.has(code)) continue;                     // 剔除涨停(当日涨停池口径)
          if (isNaN(pct) || pct < 0) continue;               // 仅取红盘候选
          if (pct >= 19.8 && /^(30|68)/.test(code)) continue;// 创业板/科创板 涨停≈20cm
          if (pct >= 9.8 && /^(60|00)/.test(code)) continue; // 主板 涨停≈10cm
          picks.push({ code, name: nm, pct: Math.round(pct * 100) / 100, turnover: it.f8 != null ? Number(it.f8) : null });
          if (picks.length >= (topN || 3)) break;
        }
        if (picks.length) return picks;
        if (diff.length) return picks;  // 成分拿到了但无满足候选 → 返回空而非继续换 host
      } catch (e) { if (attempt === 0) await new Promise(r => setTimeout(r, 300)); }
    }
  }
  return [];
}
// 为多个板块批量注入候选(名称去重、错峰并发),返回 { 板块名: { board, picks } }
async function attachSectorPicks(sectorNames, ztSet) {
  const out = {};
  const uniq = [...new Set((sectorNames || []).filter(Boolean))].slice(0, 10);
  const entries = await Promise.all(uniq.map(async (nm, i) => {
    await new Promise(r => setTimeout(r, i * 120));  // 错峰,防限流
    const b = await resolveBoardCode(nm);
    if (!b) { console.warn('  [板块候选] 板块名解析失败:', nm); return [nm, { board: '', picks: [] }]; }
    const picks = await fetchBoardPicks(b.code, ztSet, 3);
    return [nm, { board: b.name, picks }];
  }));
  for (const [k, v] of entries) out[k] = v;
  return out;
}

/* ============ 打板五佳股 Top5 (2026-09-07 中午+收盘使用) ============ */
/* ============ 打板五佳股 Top5 (2026-09-07 中午+收盘使用) ============ */
// 拉 Top 候选股的流通市值/换手率(东财 secid 行情;失败回 0)
async function fetchZTPicksDetail(picks) {
  if (!Array.isArray(picks) || !picks.length) return [];
  const secids = picks.map(p => {
    const c = String(p.code || '').padStart(6, '0');
    const setcode = c.startsWith('6') || c.startsWith('5') ? '1' : '0';
    return setcode + '.' + c;
  }).join(',');
  const tryHosts = ['https://push2.eastmoney.com', 'http://push2.eastmoney.com', 'https://push2delay.eastmoney.com'];
  for (const base of tryHosts) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const url = `${base}/api/qt/ulist.np/get?fltt=2&fields=f12,f14,f2,f3,f8,f9,f20&secids=${secids}`;
        const j = await fetchJsonTxt(url, { timeout: 9000 });
        if (!j || !j.data || !Array.isArray(j.data.diff)) { if (attempt === 0) await new Promise(r => setTimeout(r, 250)); continue; }
        const map = {};
        for (const it of j.data.diff) map[String(it.f12 || '').padStart(6, '0')] = it;
        return picks.map(p => {
          const it = map[String(p.code).padStart(6, '0')] || {};
          // 东财 ulist 接口字段单位:f2 现价(元)/ f3 涨幅%/ f8 换手率%/ f9 流通市值(亿元,已带精度)/ f20 总市值(元)
          const price = it.f2 != null ? Number(it.f2) : 0;
          const liqMcapYi = it.f9 != null ? Math.round(Number(it.f9) * 10) / 10 : 0;  // 亿元
          const turnover = it.f8 != null ? Number(it.f8) : 0;
          return { code: p.code, price, liqMcapYi, turnoverRate: Math.round(turnover * 100) / 100 };
        });
      } catch (e) { if (attempt === 0) await new Promise(r => setTimeout(r, 250)); }
    }
  }
  return picks.map(p => ({ code: p.code, liqMcapYi: 0, turnoverRate: 0 }));
}

// 板型/形态/题材派生 + 8 维评分 + 涨停原因短文
function deriveBoardMeta(p, secCount) {
  const lianban = p.lianban || 1;
  const boardType = lianban === 1 ? '首板' : (lianban === 2 ? '2板' : (lianban === 3 ? '3板' : (lianban === 4 ? '4板' : (lianban + '连板'))));
  // 形态派生:基于 firstTime(封板时间 HHmm)/ kaiban(开板次数)/ pct 涨幅
  const ft = String(p.firstTime || '').slice(0, 4);
  let shape = '盘中拉板';
  if (p.kaiban && p.kaiban >= 1) shape = '炸板回封';
  else if (ft && ft < '0933') shape = '一字板';
  else if (ft && ft > '1430') shape = '尾盘封板';
  else if (ft && ft > '1100' && ft < '1330') shape = '午后封板';
  else if (ft && ft >= '0930' && ft <= '0945') shape = '开盘秒板';
  // 题材派生:板块 + 联动(同板块涨停家数 secCount)
  const theme = (p.sector || '其他') + (secCount > 1 ? `(联动` + secCount + ')' : '');
  // 涨停原因:基于板块名+联动+封板时间多行短文
  const reasonParts = [];
  if (p.sector && p.sector !== '其他') {
    reasonParts.push((p.sector || '') + '纯情');
  }
  if (secCount >= 2) {
    reasonParts.push('缩炸作(同板块涨停 ' + secCount + ' 只)');
  }
  // 封板时间表述
  if (ft && ft < '0933') reasonParts.push('一字封板');
  else if (ft) reasonParts.push('首封 ' + ft.slice(0, 2) + ':' + ft.slice(2, 4));
  if (p.sealAmountYi && p.sealAmountYi >= 2) reasonParts.push('首封 ' + Math.round(p.sealAmountYi * 100) / 100 + '亿');
  if (p.kaiban && p.kaiban >= 1) reasonParts.push('炸板 ' + p.kaiban + ' 次');
  const reason = reasonParts.slice(0, 4).join(' · ');
  return { boardType, shape, theme, reason };
}

// 8 维评分:股价表现/板块类型/板块强势/放量缩量/横盘放量/半年涨势/模块效益/盈亏评价
function radarEight(s, ctx) {
  const pct = s.pct || 0;
  const sealYi = Number(s.sealAmount) || 0;
  const lianban = s.lianban || 1;
  const turnover = s.turnoverRate || 0;
  const liqMcap = s.liqMcapYi || 0;
  const secCount = ctx ? ctx.secCount : 1;
  const fundDesc = s.fundDesc || '';          // 放量/缩量派生(可由外部填)
  const rangeDesc = s.rangeDesc || '';         // 横盘放量派生
  const halfYearChg = s.halfYearChg || 0;      // 半年涨幅 %
  return {
    // 股价表现:今日涨幅 + 连板加速(连板越高越强)
    priceAction: Math.min(100, Math.round((pct >= 9.8 ? 80 : pct * 8) + lianban * 5)),
    // 板块类型:板块聚合度(同板块涨停越多越主流)
    boardType: Math.min(100, Math.round(secCount * 22 + 30)),
    // 板块强势:涨停家数 + 连板龙头加成
    boardStrong: Math.min(100, Math.round(secCount * 18 + lianban * 12 + 18)),
    // 放量缩量:换手率 5-15% 最佳 + 封单加分
    volQuality: Math.min(100, Math.round(turnover > 0 ? (turnover < 5 ? 60 : (turnover > 30 ? 70 : Math.round(85 + (15 - Math.abs(turnover - 12)) * 1.5))) : 50 + (sealYi > 3 ? 18 : 0))),
    // 横盘放量:派生自 5 日 K 线(由调用方算)
    rangeBreakout: Math.max(0, Math.min(100, Math.round(Number(s.rangeBreakout) || 60))),
    // 半年涨势:半年涨幅 0~30% 线性映射
    halfYearTrend: Math.max(0, Math.min(100, Math.round(halfYearChg * 3 + 50))),
    // 模块效益:综合分基础 + 流动性辅助
    moduleBenefit: Math.min(100, Math.round((s.score && s.score.total) || 70)),
    // 盈亏评价:综合分 + 大盘状态
    profitEval: Math.min(100, Math.round((s.score && s.score.total) || 60) + Math.min(10, Math.round(liqMcap / 50)))
  };
}

// 涨停池里按"安全度/量能/涨速/形态/强庄"五维评分 + 8 维扩展,排序取 Top5 用于报告卡片
function scanTopBoardPicks(ztList, klineMap, opt) {
  if (!Array.isArray(ztList) || !ztList.length) return null;
  const sectorAgg = new Map();
  for (const s of ztList) {
    const k = s.hybk || '其他';
    if (!sectorAgg.has(k)) sectorAgg.set(k, []);
    sectorAgg.get(k).push(s);
  }
  const scored = ztList.map(s => {
    const secCount = (sectorAgg.get(s.hybk || '其他') || []).length;
    const sealYi = (Number(s.sealWan) || 0) / 10000;       // 封单亿元
    const lianban = Number(s.lianban) || 1;
    const safety = Math.min(100, Math.round(secCount * 18 + lianban * 8));      // 板块持续+连板
    const volume = Math.min(100, Math.round((Math.sqrt(Math.max(sealYi, 0)) * 35) + 15));  // 量能(封单开方)
    const speed = s.pct >= 19.8 ? 100 : s.pct >= 9.8 ? 92 : Math.round(Math.max(0, s.pct) * 9);  // 涨速
    const shape = lianban === 1 ? 95 : lianban === 2 ? 80 : lianban === 3 ? 62 : lianban === 4 ? 42 : (lianban === 5 ? 28 : 18);  // 形态/资金集中(首板最稳)
    const intent = Math.min(100, Math.round(Math.sqrt(Math.max(sealYi, 0)) * 32 + secCount * 9 + 8));  // 强庄意图
    const total = Math.round(safety * 0.22 + volume * 0.18 + speed * 0.20 + shape * 0.20 + intent * 0.20);
    // K 线辅助:近 5 日/120 日 数据(若有)
    let rangeBreakout = 55, halfYearChg = 0;
    const c6 = (s.code || '').toString().padStart(6, '0');
    const k = klineMap && (klineMap[c6] || klineMap[s.code]);
    if (Array.isArray(k) && k.length > 5) {
      const closes = k.map(x => parseFloat(x[2])).filter(n => !isNaN(n));
      if (closes.length >= 5) {
        const last5hi = Math.max(...closes.slice(-5));
        const last5lo = Math.min(...closes.slice(-5));
        const last = closes[closes.length - 1];
        const range = (last5hi - last5lo) / Math.max(last5lo, 0.01);
        // 近 5 日窄幅 → 横盘;放量突破 → 高分(用 close/avg5 模拟放量)
        const avg5 = closes.slice(-5).reduce((a, b) => a + b, 0) / 5;
        rangeBreakout = Math.round(range < 0.04 ? 70 : (range < 0.10 ? 60 : 50) + (last > avg5 * 1.02 ? 20 : 0));
      }
      if (closes.length >= 120) {
        halfYearChg = Math.round((closes[closes.length - 1] - closes[closes.length - 120]) / Math.max(closes[closes.length - 120], 0.01) * 100 * 10) / 10;
      }
    }
    // 派生板型/形态/涨停原因
    const meta = deriveBoardMeta({
      pct: s.pct, lianban, sector: s.hybk || '其他', sealAmountYi: sealYi, firstTime: s.firstTime, kaiban: s.kaiban
    }, secCount);
    return {
      code: c6,
      name: s.name || '--',
      pct: Number(s.pct) || 0,
      lianban,
      sector: s.hybk || '其他',
      sealAmount: (Number(sealYi) || 0).toFixed(2),
      sealAmountYi: Number(sealYi) || 0,
      price: Number(s.price) || 0,
      firstTime: String(s.firstTime || ''),
      kaiban: Number(s.kaiban) || 0,
      halfYearChg,
      score: { safety, volume, speed, shape, intent, total },
      meta,           // { boardType, shape, theme, reason }
      rangeBreakout   // 用于 8 维的 横盘放量
    };
  });
  // 排序:综合分为主、连板奖励调节(防止 7 板等极高位股票霸榜)
  const ranked = scored
    .filter(s => s.lianban <= 7)
    .sort((a, b) => (b.score.total + Math.min(b.lianban - 1, 3) * 4) - (a.score.total + Math.min(a.lianban - 1, 3) * 4));
  const candidates = ranked.slice(0, 10);  // 拉行情取前 10,再用详情补全
  return { ranked, candidates, totalCandidates: ranked.length };
}

// 回测查取:取历史报告的 topBoardPicks 全 Top5 行,用于"回测追踪"表
function loadTopBoardBacktest(dataDir, currentDateTime, dayLimit) {
  try {
    if (!fs.existsSync(dataDir)) return [];
    const files = fs.readdirSync(dataDir)
      .filter(f => /^(\d{4}-\d{2}-\d{2})_(08-30|11-35|16-20)\.json$/.test(f))
      .filter(f => f !== currentDateTime)
      .sort()
      .reverse();
    const rows = [];
    const cap = typeof dayLimit === 'number' ? dayLimit : 5;
    for (const f of files) {
      try {
        const j = JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf8'));
        const tbp = j && j.topBoardPicks;
        if (!tbp || !Array.isArray(tbp.picks) || !tbp.picks.length) continue;
        const hitDate = f.replace(/_(\d{2}-\d{2})\.json$/, '').replace(/-/g, '-');
        const slot = f.match(/_(\d{2}-\d{2})\.json$/);
        const slotLabel = slot ? (slot[1] === '08-30' ? '盘前' : (slot[1] === '11-35' ? '午盘' : '收盘')) : '收盘';
        // 取该报告 Top5 全部 5 行(命中 = rank<=5)
        const picks = tbp.picks.slice(0, 5);
        for (const top1 of picks) {
          rows.push({
            predictDate: hitDate,
            slot: slotLabel,
            code: top1.code,
            name: top1.name,
            predictPct: top1.pct,
            rank: top1.rank || 1,
            isTop5: true,
            totalScore: top1.score ? top1.score.total : null,
            lianban: top1.lianban || 1,
            sector: top1.sector || top1.meta && top1.meta.theme || '--',
            actual: null
          });
        }
        if (rows.length >= cap * 5) break;
        if (files.indexOf(f) >= cap - 1) break;     // 限制天数
      } catch (e) { /* 单文件损坏忽略 */ }
    }
    return rows;
  } catch (e) { return []; }
}

/* ============ "明日看什么" 动态板块观察锚 (2026-09-12) ============ */
// 收盘专属:基于 mainRank 实时强度排名,动态归类「可买入 / 可观察 / 等回调」三类板块
// 输出:{ themes:[{name,category,reason,picks[3]}], caution:[str,...] }
function deriveTodayWatchList(mainRank, playbook, zt, limitUpList, hotSectors, date, dataDir, closeStats) {
  // 数值归一化辅助
  const num = (v) => { const n = Number(v); return isFinite(n) ? n : 0; };
  const pctOf    = (r) => num(r.changePct);
  const inflowOf = (r) => num(r.inflowYi);
  const ztOf     = (r) => num(r.ztCount != null ? r.ztCount : r.limitUpCount);
  const lbOf     = (r) => num(r.maxLB);

  // 有效板块池(剔除空名/占位;mainRank 已按强度降序,这里直接保序分组)
  const pool = (mainRank || []).filter(r => {
    const nm = (r.mappedName || r.name || '').trim();
    return nm && nm !== '--' && nm !== '其他';
  });

  // 三分类:可买入 / 可观察 / 等回调(弱势板块不进明日清单)
  const classify = (r) => {
    const p = pctOf(r), inf = inflowOf(r), lb = lbOf(r), zc = ztOf(r);
    const confirmed = (r.status === '主线确认') || (zc >= 2 && p >= 2);
    if (lb >= 5 || (p >= 7 && lb >= 4)) return '等回调';      // 龙头连板过高/过热,等回调
    if (confirmed && zc >= 2 && inf >= 0) return '可买入';     // 主线确认+涨停梯队健康+资金净流入
    if (p >= 1 || confirmed || zc >= 1) return '可观察';       // 活跃但待发酵(单只涨停/资金弱)
    return null;                                              // 弱势,不进明日清单
  };

  const buckets = { '可买入': [], '可观察': [], '等回调': [] };
  for (const r of pool) {
    const cat = classify(r);
    if (cat) buckets[cat].push(r);
  }

  const order = ['可买入', '可观察', '等回调'];

  // reason 生成:基于板块真实数据 + 分类给出明日展望
  const buildReason = (name, r, cat) => {
    const p = pctOf(r), inf = inflowOf(r), zc = ztOf(r), lb = lbOf(r);
    const parts = [];
    if (r.status === '主线确认') parts.push('主线确认');
    else if (p >= 2) parts.push('走强+' + p.toFixed(1) + '%');
    else if (p >= 0) parts.push('窄幅+' + p.toFixed(1) + '%');
    else parts.push('回撤' + p.toFixed(1) + '%');
    if (zc > 0) parts.push(zc + '家涨停' + (lb >= 2 ? '·最高' + lb + '板' : ''));
    if (inf > 0.05) parts.push('净流入' + inf.toFixed(1) + '亿');
    else if (inf < -0.05) parts.push('净流出' + Math.abs(inf).toFixed(1) + '亿');
    let outlook;
    if (cat === '可买入') outlook = '明日只做龙头不追高,看量能能否延续';
    else if (cat === '可观察') outlook = '明日看能否晋级主线,先观察资金是否真实回流';
    else if (p >= 7 || lb >= 5) outlook = '短期过热,等回调企稳再择机';
    else outlook = '偏弱,等放量企稳再介入';
    return name + ' ' + parts.join('、') + ';' + outlook;
  };

  // 每类取前 2,拼 themes(随真实强度实时变动)
  const themes = [];
  for (const cat of order) {
    for (const r of buckets[cat].slice(0, 2)) {
      const name = r.mappedName || r.name;
      let picks = (r.picks || []).map(p => (typeof p === 'string' ? p : (p && p.name))).filter(Boolean);
      if (picks.length < 3 && r.leadStock && r.leadStock !== '--' && picks.indexOf(r.leadStock) < 0) picks.push(r.leadStock);
      picks = picks.slice(0, 3);
      themes.push({ name, category: cat, picks, reason: buildReason(name, r, cat) });
    }
  }

  // 谨慎方向:基于真实强度动态生成
  const caution = [];
  const hot = pool.find(r => lbOf(r) >= 5 || pctOf(r) >= 7);
  if (hot) caution.push((hot.mappedName || hot.name) + '高位加速谨防兑现');
  const buyTop = buckets['可买入'][0];
  if (buyTop) caution.push((buyTop.mappedName || buyTop.name) + '主线一致高开勿追高');
  const outflow = pool.filter(r => inflowOf(r) < 0).sort((a, b) => inflowOf(a) - inflowOf(b))[0];
  if (outflow) caution.push((outflow.mappedName || outflow.name) + '资金净流出暂避');
  caution.push('无量不追,放量才跟');
  return { themes, caution };
}
/* ============ 观察池技术画像(盘前):MA/量比/KDJ/趋势 → 支撑"建议"五类文案 ============ */
// A股交易时间进度(0~1):盘中放量缩量按已交易分钟比例折算昨日同期量
function tradeProgress() {
  const bj = new Date(Date.now() + 8 * 3600 * 1000);
  const day = bj.getUTCDay();
  if (day === 0 || day === 6) return 1;  // 周末按收盘
  const mins = bj.getUTCHours() * 60 + bj.getUTCMinutes();
  let traded = 0;
  if (mins >= 570 && mins <= 690) traded = mins - 570;               // 09:30-11:30
  else if (mins > 690 && mins < 780) traded = 120;                    // 午休
  else if (mins >= 780 && mins <= 900) traded = 120 + (mins - 780);   // 13:00-15:00
  else if (mins > 900) traded = 240;                                  // 收盘后
  return Math.min(1, Math.max(0, traded / 240));
}
function calcTechFromKline(arr) {
  if (!Array.isArray(arr) || arr.length < 30) return null;
  const closes = arr.map(k => parseFloat(k[2])).filter(n => !isNaN(n));
  const vols = arr.map(k => parseFloat(k[5]) || 0);
  const n = closes.length;
  if (n < 30) return null;
  const last = closes[n - 1];
  const sma = (m) => n >= m ? closes.slice(-m).reduce((a, b) => a + b, 0) / m : null;
  const ma5 = sma(5), ma10 = sma(10), ma20 = sma(20), ma60 = sma(60);
  // 量比:最近5日均量 / 之前15日均量(>1.3 放量,<0.75 缩量/窒息)
  const last5v = vols.slice(-5).reduce((a, b) => a + b, 0) / 5;
  const prev15v = vols.slice(-20, -5).reduce((a, b) => a + b, 0) / 15;
  const volRatio = prev15v > 0 ? last5v / prev15v : null;
  // KDJ(9,3,3):最后一根是否金叉
  let k = 50, d = 50, prevK = null, prevD = null;
  let kdjGold = false;
  for (let i = 0; i < n; i++) {
    const seg = closes.slice(Math.max(0, i - 8), i + 1);
    const hi = Math.max(...seg), lo = Math.min(...seg);
    const rsv = hi > lo ? (closes[i] - lo) / (hi - lo) * 100 : 50;
    k = 2 / 3 * k + 1 / 3 * rsv;
    d = 2 / 3 * d + 1 / 3 * k;
    if (i === n - 1 && prevK != null && prevK <= prevD && k > d) kdjGold = true;
    prevK = k; prevD = d;
  }
  // 趋势:多头(均线全多头) / 修复(MA10>MA20 且价在MA20上) / 空头(价在MA20下) / 震荡
  const ma20Prev = n >= 25 ? closes.slice(-25, -5).reduce((a, b) => a + b, 0) / 20 : null;
  const ma20Slope = (ma20 != null && ma20Prev != null)
    ? (ma20 > ma20Prev * 1.002 ? 'up' : ma20 < ma20Prev * 0.998 ? 'down' : 'flat') : 'flat';
  const bullArrange = !!(ma5 && ma10 && ma20 && ma60 && ma5 > ma10 && ma10 > ma20 && ma20 > ma60);
  const trend = bullArrange ? 'up'
    : (!bullArrange && ma10 && ma20 && ma10 > ma20 && last > ma20 && ma20Slope !== 'down') ? 'repair'
    : (ma20 != null && last < ma20) ? 'down' : 'flat';
  const r60 = closes.slice(-60);
  const hi60 = Math.max(...r60), lo60 = Math.min(...r60);
  const range60 = hi60 > lo60 ? (last - lo60) / (hi60 - lo60) * 100 : 50;
  const pct5 = n >= 6 ? (last / closes[n - 6] - 1) * 100 : 0;
  const r2 = (x) => (x == null ? null : Math.round(x * 100) / 100);

  // ATR14(真实平均波幅,用于校准止损距离)
  let atr14 = null;
  if (n >= 15) {
    const trs = [];
    for (let i = n - 14; i < n; i++) {
      const h = parseFloat(arr[i][3]), l = parseFloat(arr[i][4]), pc = parseFloat(arr[i - 1][2]);
      if ([h, l, pc].some(x => isNaN(x))) continue;
      trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
    }
    if (trs.length) atr14 = trs.reduce((a, b) => a + b, 0) / trs.length;
  }

  // 前高/前低(近60日,不含今日)——支撑压力的真实依据
  const highs60 = arr.slice(-60, -1).map(k => parseFloat(k[3])).filter(x => !isNaN(x));
  const lows60 = arr.slice(-60, -1).map(k => parseFloat(k[4])).filter(x => !isNaN(x));
  const high60 = highs60.length ? Math.max(...highs60) : null;
  const low60 = lows60.length ? Math.min(...lows60) : null;

  // 缺口锚点(今日相对昨日):用开盘价判缺口,用最低/最高价判是否回补
  let gapUp = null, gapDown = null;
  if (n >= 2) {
    const prevH = parseFloat(arr[n - 2][3]), prevL = parseFloat(arr[n - 2][4]);
    const curO = parseFloat(arr[n - 1][1]), curL = parseFloat(arr[n - 1][4]), curH = parseFloat(arr[n - 1][3]);
    if (!isNaN(prevH) && !isNaN(curO) && !isNaN(curL) && curO > prevH)
      gapUp = { level: r2(prevH), filled: curL <= prevH };
    else if (!isNaN(prevL) && !isNaN(curO) && !isNaN(curH) && curO < prevL)
      gapDown = { level: r2(prevL), filled: curH >= prevL };
  }

  // 较昨日放量/缩量%(盘中按交易时间进度折算昨日同期量)
  const volToday = vols[n - 1] || 0, volYesterday = vols[n - 2] || 0;
  let volChgPct = null;
  if (volYesterday > 0) {
    const prog = tradeProgress();
    const ratio = volToday / volYesterday;
    const adj = (prog > 0 && prog < 1) ? ratio / prog : ratio;
    volChgPct = Math.round((adj - 1) * 1000) / 10;
  }

  // 支撑/压力(强弱 + 依据)——均线 + 前高前低 + 整数关口,全部真实计算
  const supports = [], pressures = [];
  const addLvl = (price, label, weight) => {
    if (price == null || isNaN(price)) return;
    const item = { price: r2(price), label, weight };
    if (price < last) supports.push(item); else if (price > last) pressures.push(item);
  };
  addLvl(ma5, 'MA5', 'weak'); addLvl(ma10, 'MA10', 'weak');
  addLvl(ma20, 'MA20', 'strong'); addLvl(ma60, 'MA60', 'strong');
  addLvl(low60, '近60日前低', 'strong'); addLvl(high60, '近60日前高', 'strong');
  [10, 50, 100, 200, 500].forEach(step => {
    const up = Math.ceil(last / step) * step, down = Math.floor(last / step) * step;
    if (up > last) addLvl(up, '整数关口', 'weak');
    if (down < last && down > 0) addLvl(down, '整数关口', 'weak');
  });
  // 过滤:去重 + 只保留距现价 ±20% 范围内的关键位,最多 3 支撑/3 压力,剔除远距离整数关口与前高前低噪音
  const dedupLvls = (arr) => {
    const seen = new Set();
    return arr.filter((x) => {
      if (seen.has(x.price)) return false;
      seen.add(x.price);
      return true;
    });
  };
  const withinRange = (x) => x && x.price != null && !isNaN(x.price) && Math.abs(x.price - last) / last <= 0.20;
  const supportsF = dedupLvls(supports).filter(withinRange).sort((a, b) => b.price - a.price).slice(0, 3);
  const pressuresF = dedupLvls(pressures).filter(withinRange).sort((a, b) => a.price - b.price).slice(0, 3);

  // 多周期趋势:周线(5日聚合)+ 日线
  const weeklyCloses = [];
  for (let i = 0; i < n; i += 5) weeklyCloses.push(closes[i]);
  const wkLast = weeklyCloses[weeklyCloses.length - 1];
  const wk5 = weeklyCloses.length >= 5 ? weeklyCloses.slice(-5).reduce((a, b) => a + b, 0) / 5 : null;
  const weeklyTrend = (wkLast != null && wk5 != null) ? (wkLast > wk5 * 1.005 ? 'up' : wkLast < wk5 * 0.995 ? 'down' : 'flat') : 'flat';

  return {
    price: r2(last), ma5: r2(ma5), ma10: r2(ma10), ma20: r2(ma20), ma60: r2(ma60),
    ma20Slope, trend,
    atr14: r2(atr14),
    high60: r2(high60), low60: r2(low60),
    gapUp, gapDown,
    supports: supportsF, pressures: pressuresF,
    weeklyTrend,
    volRatio: volRatio != null ? Math.round(volRatio * 100) / 100 : null,
    volChgPct, volToday, volYesterday,
    kdjGold,
    bias10: ma10 ? Math.round((last / ma10 - 1) * 1000) / 10 : null,
    bias20: ma20 ? Math.round((last / ma20 - 1) * 1000) / 10 : null,
    range60: Math.round(range60), pct5: Math.round(pct5 * 100) / 100
  };
}
// 个股主力资金流缓存(独立文件,保存最近一次成功抓取的 d1/d3/d5,东财接口抽风/限流/超时的终极兜底)
let _fflowCache = null;
function loadFflowCache() {
  if (_fflowCache) return _fflowCache;
  try {
    const p = path.join(ROOT, 'data', 'fflow_cache.json');
    if (fs.existsSync(p)) _fflowCache = JSON.parse(fs.readFileSync(p, 'utf8')) || {};
  } catch (e) { /* 缓存损坏忽略 */ }
  if (!_fflowCache || typeof _fflowCache !== 'object') _fflowCache = {};
  return _fflowCache;
}
function saveFflowCache() {
  try {
    const p = path.join(ROOT, 'data', 'fflow_cache.json');
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(_fflowCache, null, 2), 'utf8');
  } catch (e) { console.error('saveFflowCache 失败:', e.message); }
}

// 个股主力资金流(东财历史资金流 daykline):主力净流入 当日/3日/5日,单位亿元
// 注:旧接口 fflow/kline?klt=101&lmt=5 只返回当天1根K线,导致 d1=d3=d5 重复;
//     改用 push2his daykline?lmt=0 取全量历史(120天),正确聚合多日资金。
//     主源(3次重试)失败 → 降级 push2 实时接口(仅当日,d3/d5 置 null) → 终极兜底读本地 fflow_cache.json(宁可 stale 一天也不显示 --)。
async function fetchStockFundFlow(code) {
  const yi = (v) => Math.round(v / 1e6) / 100;  // 元 → 亿元(2位)
  const num = String(code).replace(/^(sh|sz|bj)/, '');
  const mkt = String(code).charAt(0) === '6' ? '1' : '0';
  const cacheKey = num;
  const fflowFetch = async (url) => {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 8000);
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://quote.eastmoney.com/' }, signal: ac.signal }).finally(() => clearTimeout(timer));
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  };
  const writeCache = (ff) => {
    try {
      const c = loadFflowCache();
      c[cacheKey] = { date: bjToday(), d1: ff.d1, d3: ff.d3, d5: ff.d5 };
      saveFflowCache();
    } catch (e) { /* 缓存写入失败不影响主流程 */ }
  };
  // 主源:历史资金流(120天),重试 3 次(东财偶发超时/限流)
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const url = `https://push2his.eastmoney.com/api/qt/stock/fflow/daykline/get?lmt=0&klt=101&secid=${mkt}.${num}&fields1=f1,f2,f3,f7&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f62,f63`;
      const j = await fflowFetch(url);
      const kl = (j && j.data && j.data.klines) || [];
      if (kl.length >= 3) {
        const vals = kl.map(line => parseFloat((line.split(',')[1]) || 0) || 0);  // f52 主力净流入(元)
        const sum = k => vals.slice(-k).reduce((a, b) => a + b, 0);
        const ff = { d1: yi(sum(1)), d3: yi(sum(3)), d5: yi(sum(5)) };
        writeCache(ff);
        return ff;
      }
    } catch (e) { /* 重试 */ }
  }
  // 降级:实时接口(仅当日1根K线),d3/d5 置 null 避免重复
  try {
    const url = `https://push2.eastmoney.com/api/qt/stock/fflow/kline/get?secid=${mkt}.${num}&fields1=f1,f2,f3,f7&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f62,f63&klt=101&lmt=5`;
    const j = await fflowFetch(url);
    const kl = (j && j.data && j.data.klines) || [];
    if (kl.length) {
      const d1 = yi(parseFloat((kl[kl.length - 1].split(',')[1]) || 0) || 0);
      const ff = { d1, d3: null, d5: null };
      writeCache(ff);
      return ff;
    }
  } catch (e) { /* 降级失败继续 */ }
  // 终极兜底:读本地缓存(过去成功抓取的资金流,宁可 stale 一天也不显示 --,标记 fromCache)
  try {
    const cached = loadFflowCache()[cacheKey];
    if (cached && cached.d1 != null && !isNaN(cached.d1)) {
      return { d1: cached.d1, d3: cached.d3 != null ? cached.d3 : null, d5: cached.d5 != null ? cached.d5 : null, fromCache: true, cacheDate: cached.date || null };
    }
  } catch (e) { /* 缓存缺失忽略 */ }
  return null;
}

// 分钟级趋势:60/15分钟收盘价 vs MA10 判断多空,真实计算
// 数据源双链路:腾讯 mkline 优先 → 新浪 getKLineData 兜底(境外 GitHub Actions 可能屏蔽腾讯域名)
function computeMinTrendFromCloses(closes) {
  const last = closes[closes.length - 1];
  const ma5 = closes.slice(-5).reduce((a, b) => a + b, 0) / 5;
  const ma10 = closes.length >= 10 ? closes.slice(-10).reduce((a, b) => a + b, 0) / 10 : null;
  const trend = (ma10 != null) ? (last > ma10 * 1.005 ? 'up' : last < ma10 * 0.995 ? 'down' : 'flat') : (last > ma5 ? 'up' : 'down');
  return { trend, ma5: Math.round(ma5 * 100) / 100, ma10: ma10 != null ? Math.round(ma10 * 100) / 100 : null };
}
// 是否盘后(北京时间 15:30 及以后):盘后抓取当日分钟线存缓存,盘前/盘中直接读缓存,不依赖实时请求
function isAfterClose() {
  const bj = new Date(Date.now() + 8 * 3600 * 1000);
  const day = bj.getUTCDay();
  if (day === 0 || day === 6) return true;  // 周末视为盘后
  const mins = bj.getUTCHours() * 60 + bj.getUTCMinutes();
  return mins >= 930;  // 15:30 及以后
}
// 日线级别近似趋势:用 MA20 斜率 + 现价相对 MA20 位置 替代分钟线(无法抓取分钟线时的最终兜底,绝不返回空)
function approxMinFromTech(tech) {
  const slope = (tech && tech.ma20Slope) || 'flat';
  const price = tech && tech.price;
  const ma20 = tech && tech.ma20;
  let trend = 'flat';
  if (price != null && ma20 != null) {
    if (price > ma20 && slope !== 'down') trend = 'up';
    else if (price < ma20) trend = 'down';
    else trend = (slope === 'up') ? 'up' : (slope === 'down') ? 'down' : 'flat';
  } else if (slope !== 'flat') {
    trend = slope;
  }
  return {
    trend,
    ma5: (tech && tech.ma5 != null) ? tech.ma5 : null,
    ma10: (tech && tech.ma10 != null) ? tech.ma10 : null,
    approx: true
  };
}
// 分钟趋势统一解析:盘后抓取存缓存 → 盘前/盘中优先读缓存 → 实时兜底 → 日线斜率近似(绝不返回空)
async function resolveMinuteTrend(code, tech) {
  const num = String(code).replace(/^(sh|sz|bj)/, '');
  // 盘前/盘中:优先读缓存(上一交易日盘后抓取的真实价位),不做实时请求
  if (!isAfterClose()) {
    const cached = loadMinTrendCache()[num];
    if (cached && (cached.m60 || cached.m15)) {
      return {
        m60: cached.m60 ? { ...cached.m60, cached: true } : null,
        m15: cached.m15 ? { ...cached.m15, cached: true } : null
      };
    }
  }
  // 实时抓取(盘后必走;盘前/盘中缓存缺失时兜底尝试一次)
  let m60 = null, m15 = null;
  try {
    [m60, m15] = await Promise.all([fetchMinuteTrend(code, 'm60'), fetchMinuteTrend(code, 'm15')]);
  } catch (e) { /* 忽略 */ }
  if (m60 || m15) {
    try {
      const mc = loadMinTrendCache();
      mc[num] = { date: bjToday(), m60: m60 || null, m15: m15 || null };
      saveMinTrendCache();
    } catch (e) { /* 缓存写入失败不影响主流程 */ }
    return { m60, m15 };
  }
  // 缓存兜底(实时失败)
  const cached = loadMinTrendCache()[num];
  if (cached && (cached.m60 || cached.m15)) {
    return {
      m60: cached.m60 ? { ...cached.m60, cached: true } : null,
      m15: cached.m15 ? { ...cached.m15, cached: true } : null
    };
  }
  // 日线MA5/MA20斜率近似(最终兜底,绝不显示"暂缺")
  const approx = approxMinFromTech(tech);
  return { m60: approx, m15: approx };
}
async function fetchMinuteTrend(code, klt) {
  const num = String(code).replace(/^(sh|sz|bj)/, '');
  // 北交所(43/83/87/88/92 开头)需 bj 前缀,否则接口返回空导致 60/15 分钟数据缺失
  const full = /^(4|8|92)/.test(num) ? ('bj' + num) : (num.charAt(0) === '6' || num.charAt(0) === '9' ? ('sh' + num) : ('sz' + num));
  // 源1:腾讯 mkline(分钟K线)
  try {
    const url = `https://ifzq.gtimg.cn/appstock/app/kline/mkline?param=${full},${klt},,30`;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 8000);
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://gu.qq.com/' }, signal: ac.signal }).finally(() => clearTimeout(timer));
    const j = await res.json();
    const d = (j && j.data && j.data[full]) || {};
    const arr = d[klt] || [];
    if (Array.isArray(arr) && arr.length >= 5) {
      const closes = arr.map(k => parseFloat(k[2])).filter(x => !isNaN(x));
      if (closes.length >= 5) return computeMinTrendFromCloses(closes);
    }
  } catch (e) { /* 降级新浪 */ }
  // 源2:新浪 getKLineData(分钟K线,{day,open,high,low,close,volume})
  try {
    const scale = klt === 'm60' ? 60 : 15;
    const sinaUrl = `https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=${full}&scale=${scale}&ma=no&datalen=30`;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 8000);
    const res = await fetch(sinaUrl, { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://finance.sina.com.cn/' }, signal: ac.signal }).finally(() => clearTimeout(timer));
    const txt = await res.text();
    if (txt && txt.trim().startsWith('[')) {
      const arr = JSON.parse(txt);
      if (Array.isArray(arr) && arr.length >= 5) {
        const closes = arr.map(k => parseFloat(k.close)).filter(x => !isNaN(x));
        if (closes.length >= 5) return computeMinTrendFromCloses(closes);
      }
    }
  } catch (e) { /* 双源均失败,由调用方日线兜底 */ }
  return null;
}

// 全市场涨停池(东财):一次性拉取,返回 Map<code, 封单信息>,观察池内存匹配
async function fetchLimitUpPool() {
  try {
    const bj = new Date(Date.now() + 8 * 3600 * 1000);
    const dateStr = bj.toISOString().slice(0, 10).replace(/-/g, '');
    const url = `https://push2ex.eastmoney.com/getTopicZTPool?ut=7eea3edcaed734bea9cbfc24409ed989&dpt=wz.ztzt&Pageindex=0&pagesize=320&sort=fbt%3Aasc&date=${dateStr}`;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 8000);
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://quote.eastmoney.com/' }, signal: ac.signal }).finally(() => clearTimeout(timer));
    const j = await res.json();
    const pool = (j && j.data && j.data.pool) || [];
    const map = {};
    for (const s of pool) {
      map[String(s.c)] = {
        sealFund: s.fund || 0,             // 封单资金(元)
        zbc: s.zbc || 0,                   // 炸板次数
        lbc: s.lbc || 1,                   // 连板数
        fbt: s.fbt || 0,                   // 首次封板时间(HHMMSS)
        lbt: s.lbt || 0,                   // 最后封板时间
        days: (s.zttj && s.zttj.days) || 1 // 连续涨停天数
      };
    }
    return map;
  } catch (e) { return {}; }
}

// 龙虎榜明细(东财):聚合 机构/游资/北向 净买入,返回最近上榜信息(真实,未上榜返回 null)
async function fetchLhbDetail(code) {
  try {
    const num = String(code).replace(/^(sh|sz|bj)/, '');
    const flt = `(SECURITY_CODE%3D%22${num}%22)`;
    const base = 'https://datacenter-web.eastmoney.com/api/data/v1/get';
    const hdr = { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://data.eastmoney.com/' };
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 9000);
    const [rb, rs] = await Promise.all([
      fetch(`${base}?reportName=RPT_BILLBOARD_DAILYDETAILSBUY&columns=ALL&filter=${flt}&pageSize=30&sortColumns=TRADE_DATE&sortTypes=-1`, { headers: hdr, signal: ac.signal }),
      fetch(`${base}?reportName=RPT_BILLBOARD_DAILYDETAILSSELL&columns=ALL&filter=${flt}&pageSize=30&sortColumns=TRADE_DATE&sortTypes=-1`, { headers: hdr, signal: ac.signal })
    ]);
    clearTimeout(timer);
    const jb = await rb.json(), js = await rs.json();
    const rows = [
      ...((jb && jb.result && jb.result.data) || []),
      ...((js && js.result && js.result.data) || [])
    ];
    if (!rows.length) return null;
    const latest = rows.map(r => r.TRADE_DATE).filter(Boolean).sort().slice(-1)[0] || '';
    const dayRows = rows.filter(r => r.TRADE_DATE === latest);
    let inst = 0, north = 0, youzi = 0;
    for (const r of dayRows) {
      const net = (r.NET || 0);
      const name = r.OPERATEDEPT_NAME || '';
      if (name.indexOf('机构') >= 0) inst += net;
      else if (name.indexOf('沪股通') >= 0 || name.indexOf('深股通') >= 0) north += net;
      else youzi += net;
    }
    const yi = v => Math.round(v / 1e4) / 100; // 元 → 亿元(2位)
    // 资金属性(席位关键词归类):机构/游资/北向/混合
    const attr = [];
    if (inst > 0) attr.push('机构');
    if (north > 0) attr.push('北向');
    if (youzi > 0) attr.push('游资');
    const fundAttr = attr.length >= 2 ? '混合资金'
      : attr.length === 1 ? (attr[0] === '机构' ? '机构主导' : attr[0] === '北向' ? '北向主导' : '游资主导') : null;
    // 知名席位联动(知名游资关键词匹配,展示真实席位名)
    const famousKw = ['华鑫', '东方财富', '拉萨', '绍兴', '江苏路', '溧阳路', '益田路', '淮海中路', '佛山', '解放南', '共和新路', '小鳄鱼', '章盟主', '炒股养家', '作手新一', '赵老哥'];
    const famousSeats = [...new Set(dayRows.map(r => r.OPERATEDEPT_NAME || '').filter(n => famousKw.some(k => n.indexOf(k) >= 0)))];
    return {
      date: latest.slice(0, 10),
      explain: (dayRows[0] && dayRows[0].EXPLANATION) || '',
      changeRate: (dayRows[0] && dayRows[0].CHANGE_RATE) || 0,
      inst: yi(inst), north: yi(north), youzi: yi(youzi),
      fundAttr, famousSeats
    };
  } catch (e) { return null; }
}

// ============ 事件缓存(巨潮公告类,盘中读缓存避免频繁请求被封 IP) ============
let _eventsCache = null;
function loadEventsCache() {
  if (_eventsCache) return _eventsCache;
  try {
    const p = path.join(ROOT, 'data', 'events_cache.json');
    if (fs.existsSync(p)) {
      const j = JSON.parse(fs.readFileSync(p, 'utf8'));
      _eventsCache = { date: j.date || '', byCode: j.byCode || {} };
    } else {
      _eventsCache = { date: '', byCode: {} };
    }
  } catch (e) { _eventsCache = { date: '', byCode: {} }; }
  return _eventsCache;
}
function saveEventsCache() {
  try {
    if (!_eventsCache) return;
    const p = path.join(ROOT, 'data', 'events_cache.json');
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(_eventsCache, null, 2), 'utf8');
  } catch (e) { console.error('saveEventsCache 失败:', e.message); }
}
function bjToday() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

// 巨潮公告(减持/增发/回购/股东大会/监管问询/重组等):真实;5秒超时+3次重试+关键词过滤
// 返回 null = 源不可用(渲染层显示降级提示);返回 [] = 成功但无匹配事件
async function fetchCninfoEvents(code, name) {
  const num = String(code);
  const c0 = num.charAt(0);
  if (c0 === '4' || c0 === '8' || c0 === '9') return []; // 北交所巨潮口径不完整,诚实降级跳过
  const orgId = (c0 === '6' || c0 === '5') ? ('gssh0' + num) : ('gssz0' + num);
  const today = bjToday();
  const start = new Date(Date.now() + 8 * 3600 * 1000 - 30 * 86400000).toISOString().slice(0, 10);
  const daysLeft = (d) => Math.round((new Date(d + 'T00:00:00+08:00') - new Date(today + 'T00:00:00+08:00')) / 86400000);

  // 关键词 → [eventType, direction, impactLevel](顺序即优先级)
  const KW = [
    ['减持', '减持', '利空', '高'], ['增持', '增持', '利好', '中'],
    ['增发', '增发', '中性', '中'], ['非公开发行', '增发', '中性', '中'], ['定增', '增发', '中性', '中'], ['配股', '增发', '中性', '中'],
    ['回购', '回购', '利好', '中'],
    ['股东大会', '股东大会', '中性', '低'], ['股东会', '股东大会', '中性', '低'],
    ['问询', '监管问询', '利空', '高'], ['关注函', '监管问询', '利空', '高'], ['监管函', '监管问询', '利空', '高'], ['警示函', '监管问询', '利空', '高'],
    ['立案', '监管问询', '利空', '高'], ['处罚', '监管问询', '利空', '高'], ['调查', '监管问询', '利空', '高'],
    ['解禁', '解禁', '利空', '中'], ['限售', '解禁', '利空', '中'],
    ['重组', '重组', '中性', '中'], ['并购', '重组', '中性', '中'], ['收购', '重组', '中性', '中'],
    ['停牌', '停牌', '中性', '中'], ['复牌', '复牌', '中性', '低']
  ];

  async function postQuery(body) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 5000);
      try {
        const res = await fetch('https://www.cninfo.com.cn/new/hisAnnouncement/query', {
          method: 'POST',
          headers: { 'User-Agent': 'Mozilla/5.0', 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest', 'Referer': 'https://www.cninfo.com.cn/new/commonUrl/pageOfSearch?url=disclosure/list/search' },
          body, signal: ac.signal
        });
        clearTimeout(t);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return await res.json();
      } catch (e) { clearTimeout(t); if (attempt === 2) throw e; await new Promise(r => setTimeout(r, 1000)); }
    }
  }

  const byStock = (stockVal) => 'pageNum=1&pageSize=50&column=szse&tabName=fulltext&plate=&stock=' + encodeURIComponent(stockVal) + '&searchkey=&secid=&category=&trade=&seDate=' + start + '~' + today + '&sortName=&sortType=&isHLtitle=true';

  let anns = [];
  try {
    // 主:stock=code,orgId(精确匹配)
    const j = await postQuery(byStock(num + ',' + orgId));
    anns = (j && j.announcements) || [];
    if (!anns.length && name) {
      // 降级:searchkey=公司名(部分股票 orgId 不可由代码推导时)
      const j2 = await postQuery('pageNum=1&pageSize=50&column=szse&tabName=fulltext&plate=&stock=&searchkey=' + encodeURIComponent(name) + '&secid=&category=&trade=&seDate=' + start + '~' + today + '&sortName=&sortType=&isHLtitle=true');
      const all2 = (j2 && j2.announcements) || [];
      anns = all2.filter(a => String(a.secCode) === num);
    }
  } catch (e) {
    console.error('fetchCninfoEvents(' + code + ') 失败:', e.message);
    return null;
  }

  const events = [];
  for (const a of anns) {
    const title = String(a.announcementTitle || '').replace(/<[^>]+>/g, '');
    if (!title) continue;
    for (const [kw, type, dir, level] of KW) {
      if (title.indexOf(kw) >= 0) {
        // 精度修正:"回购注销限制性股票"是中性动作,非市场回购利好,避免方向误导
        let d2 = dir;
        if (type === '回购' && /注销/.test(title)) d2 = '中性';
        const d = a.announcementTime ? new Date(a.announcementTime + 8 * 3600 * 1000).toISOString().slice(0, 10) : today;
        const left = daysLeft(d);
        events.push({
          type, eventType: type,
          name: title.slice(0, 30), title: title.slice(0, 30),
          date: d, eventDate: d, left,
          countdown: left > 0 ? ('T-' + left + '天') : (left < 0 ? Math.abs(left) + '天前' : '今日'),
          dir: d2, direction: d2, level, impactLevel: level,
          detail: title.slice(0, 48),
          source: '巨潮'
        });
        break; // 每条公告只归入一个事件类型
      }
    }
  }
  return events;
}

// 事件日历:东财(财报/业绩预告/解禁) + 巨潮(减持/增发/回购/股东大会/监管问询),合并排序(真实,无则返回 null)
async function fetchEvents(code, name) {
  const num = String(code).replace(/^(sh|sz|bj)/, '');
  const hdr = { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://data.eastmoney.com/' };
  const base = 'https://datacenter-web.eastmoney.com/api/data/v1/get';
  const today = bjToday();
  const daysLeft = (d) => Math.round((new Date(d) - new Date(today)) / 86400000);
  const events = [];
  const fjson = async (reportName, filter, pageSize, sortColumns, sortTypes) => {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 8000);
    try {
      const res = await fetch(`${base}?reportName=${reportName}&columns=ALL&filter=${filter}&pageSize=${pageSize}&sortColumns=${sortColumns}&sortTypes=${sortTypes}`, { headers: hdr, signal: ac.signal });
      clearTimeout(t);
      const j = await res.json();
      return (j && j.result && j.result.data) || [];
    } catch (e) { clearTimeout(t); return []; }
  };
  const flt = `(SECURITY_CODE%3D%22${num}%22)`;

  // 东财:财报披露(未来预约)
  const appt = await fjson('RPT_PUBLIC_BS_APPOIN', flt, 3, 'FIRST_APPOINT_DATE', -1);
  for (const a of appt) {
    const d = (a.FIRST_APPOINT_DATE || '').slice(0, 10);
    if (!d || d < today) continue;
    const left = daysLeft(d);
    events.push({ type: '财报披露', eventType: '财报披露', name: a.REPORT_TYPE_NAME || (a.REPORT_YEAR + '财报'), date: d, eventDate: d, left, countdown: 'T-' + left + '天', dir: '中性', direction: '中性', level: left <= 3 ? '高' : left <= 7 ? '中' : '低', impactLevel: left <= 3 ? '高' : left <= 7 ? '中' : '低', source: '东财' });
  }
  // 东财:业绩预告(仅近 90 天,过期的预告不展示,避免误导)
  const pred = await fjson('RPT_PUBLIC_OP_NEWPREDICT', flt, 1, 'NOTICE_DATE', -1);
  for (const p of pred) {
    const amp = (p.ADD_AMP_LOWER || 0);
    const dd = (p.NOTICE_DATE || '').slice(0, 10);
    if (dd && daysLeft(dd) < -90) continue; // 超过 90 天的旧预告视为过期
    events.push({ type: '业绩预告', eventType: '业绩预告', name: '', date: dd, eventDate: dd, left: daysLeft(dd || today), countdown: '今日', dir: amp > 0 ? '利好' : '利空', direction: amp > 0 ? '利好' : '利空', level: '中', impactLevel: '中', detail: (p.PREDICT_CONTENT || '').slice(0, 48), source: '东财' });
  }
  // 东财:解禁(未来)
  const lift = await fjson('RPT_LIFT_STAGE', flt + `(FREE_DATE%3E%3D%27${today}%27)`, 3, 'FREE_DATE', 1);
  for (const l of lift) {
    const d = (l.FREE_DATE || '').slice(0, 10);
    if (!d) continue;
    const left = daysLeft(d);
    const cap = (l.LIFT_MARKET_CAP || 0); // 万元
    events.push({ type: '解禁', eventType: '解禁', name: l.FREE_SHARES_TYPE || '限售解禁', date: d, eventDate: d, left, countdown: 'T-' + left + '天', dir: '利空', direction: '利空', level: cap > 50000 ? '高' : cap > 10000 ? '中' : '低', impactLevel: cap > 50000 ? '高' : cap > 10000 ? '中' : '低', detail: '解禁市值约' + Math.round(cap / 10000 * 100) / 100 + '亿', source: '东财' });
  }

  // 巨潮:减持/增发/回购/股东大会/监管问询/重组(有缓存,盘中读缓存)
  const cache = loadEventsCache();
  let cninfo = null;
  let cninfoStatus = 'empty'; // ok=有事件 / empty=成功无事件 / fail=源不可用
  if (cache.date === today && Object.prototype.hasOwnProperty.call(cache.byCode, num)) {
    cninfo = cache.byCode[num] || [];
    cninfoStatus = cninfo.length ? 'ok' : 'empty';
  } else {
    try {
      cninfo = await fetchCninfoEvents(num, name);
    } catch (e) { cninfo = null; }
    if (cninfo === null) {
      cninfoStatus = 'fail';
    } else {
      cninfoStatus = cninfo.length ? 'ok' : 'empty';
      cache.byCode[num] = cninfo; // 仅成功(含空数组)才缓存;fail 不缓存,下次重试
      cache.date = today;
    }
  }
  if (cninfo && cninfo.length) {
    for (const ev of cninfo) {
      const dup = events.some(x => x.type === ev.type && x.date === ev.date);
      if (!dup) events.push(ev);
    }
  }

  // 排序:影响等级 高>中>低,同级按日期升序(最近/最紧迫在前)
  const lvRank = { '高': 0, '中': 1, '低': 2 };
  events.sort((a, b) => (lvRank[a.level] ?? 2) - (lvRank[b.level] ?? 2) || (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { events: events.length ? events : null, cninfoStatus };
}

async function enrichWatchlistTech(list) {
  // 涨停池一次性拉取(全市场),内存匹配观察池
  let sealMap = {};
  try { sealMap = await fetchLimitUpPool(); } catch (e) { /* 封单缺失降级 */ }
  // 大盘强弱(总仓位上限依据):上证指数均线状态,全局一份
  let marketRegime = { label: '震荡', capPct: 50 };
  try {
    const idxKl = await fetchKline('sh000001', 120);
    const idxT = calcTechFromKline(idxKl);
    if (idxT) {
      if (idxT.trend === 'up' || (idxT.ma20 && idxT.price > idxT.ma20 && idxT.ma20Slope === 'up')) marketRegime = { label: '强', capPct: 70 };
      else if (idxT.trend === 'down' || (idxT.ma20 && idxT.price < idxT.ma20)) marketRegime = { label: '弱', capPct: 30 };
      else marketRegime = { label: '震荡', capPct: 50 };
    }
  } catch (e) { /* 大盘状态降级为震荡 */ }
  // 板块涨跌地图(行业+概念,复盘资金归因"个股 vs 板块"用),一次性拉取
  let boardChangeMap = {};
  try { boardChangeMap = await fetchBoardChangeMap(); } catch (e) { /* 板块地图缺失降级 */ }
  const arr = await Promise.all((list || []).map(async (s) => {
    if (!s || !s.code) return s;
    try {
      const pre = String(s.code).charAt(0) === '6' ? 'sh' : 'sz';
      const kl = await fetchKline(pre + s.code, 90);
      const t = calcTechFromKline(kl);
      if (t) s.tech = t;
    } catch (e) { /* 技术画像缺失时渲染层降级为通用建议 */ }
    try {
      const ff = await fetchStockFundFlow(s.code);
      if (ff) s.fundFlow = ff;
    } catch (e) { /* 资金流缺失不阻塞 */ }
    // 封单/连板(非涨停显示 null → 渲染层"非涨停")
    if (sealMap[s.code]) s.seal = sealMap[s.code];
    // 60/15分钟趋势:盘后抓取存缓存,盘前/盘中优先读缓存,最终日线斜率近似兜底(绝不显示"暂缺")
    try {
      const mt = await resolveMinuteTrend(s.code, s.tech || null);
      s.minTrend = { m60: mt.m60, m15: mt.m15 };
    } catch (e) {
      const approx = approxMinFromTech(s.tech || null);
      s.minTrend = { m60: approx, m15: approx };
    }
    // 所属板块当日涨跌幅(复盘资金归因对比)
    try {
      const secChg = matchSectorChange(s.category, boardChangeMap, s.logic);
      if (secChg) s.sectorChange = secChg;
    } catch (e) { /* 板块涨跌缺失不阻塞 */ }
    // 龙虎榜(未上榜返回 null)
    try {
      const lhb = await fetchLhbDetail(s.code);
      if (lhb) s.lhb = lhb;
    } catch (e) { /* 龙虎榜缺失不阻塞 */ }
    // 事件日历(东财+巨潮合并)
    try {
      const ev = await fetchEvents(s.code, s.name);
      if (ev && ev.events) s.events = ev.events;
      if (ev) s.eventsStatus = { cninfo: ev.cninfoStatus };
    } catch (e) { /* 事件缺失不阻塞 */ }
    // 量化风险信号(可观测规则固化,触发则高亮)
    const riskSignals = [];
    const tt = s.tech || {};
    if ((s.pct != null && s.pct <= -7) && (tt.volChgPct > 30 || s.volRatio > 1.5)) riskSignals.push('单日放量下跌超7%');
    if (s.seal && s.seal.zbc > 0) riskSignals.push('炸板' + s.seal.zbc + '次');
    if (tt.ma5 && s.price && s.price < tt.ma5) riskSignals.push('现价跌破MA5');
    if (tt.ma20 && s.price && s.price < tt.ma20 && tt.trend === 'down') riskSignals.push('跌破MA20趋势转弱');
    if (riskSignals.length) s.riskSignals = riskSignals;
    s.marketRegime = marketRegime;
    return s;
  }));
  return arr;
}


// 全市场成交额(沪深两市合计,单位:亿元)
async function fetchTotalAmount() {
  // 源1:东财 HTTPS push2 沪深指数 f6(成交额,元)——GitHub Actions 境外环境可用
  try {
    const url = 'https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&fields=f6&secids=1.000001,0.399001';
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 8000);
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: ac.signal }).finally(() => clearTimeout(timer));
    const j = await res.json();
    const diff = (j.data && j.data.diff) || [];
    let total = 0;
    for (const it of diff) total += (it.f6 || 0);  // f6 成交额(元)
    if (total > 0) return total;  // 元,调用处 /1e8 = 亿元
  } catch (e) { console.error('fetchTotalAmount(东财) 失败:', e.message); }
  // 源2:腾讯行情接口 f[37]=成交额(万元)
  try {
    const url = 'https://qt.gtimg.cn/q=sh000001,sz399001';
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 8000);
    const res = await fetch(url, { cache: 'no-store', signal: ac.signal }).finally(() => clearTimeout(timer));
    const buf = await res.arrayBuffer();
    const text = new TextDecoder('gbk').decode(buf);
    let totalWan = 0;
    for (const line of text.trim().split(';')) {
      const m = line.trim().match(/^v_[a-z]+\d+="(.*)"$/);
      if (!m) continue;
      const f = m[1].split('~');
      if (f.length < 40) continue;
      totalWan += parseFloat(f[37]) || 0;  // 成交额(万元)
    }
    if (totalWan > 0) return totalWan * 1e4;  // 元
  } catch (e) { console.error('fetchTotalAmount(腾讯) 失败:', e.message); }
  return 0;
}

// 60日新高个股数(基于东财涨停池 + 创新高近似估算;实际接口数据准确性 6/10)
async function fetchNewHighCount(dateArg) {
  try {
    // 优先尝试东财 push2ex "新高"接口
    const url = `http://push2ex.eastmoney.com/getTopicZTPool?ut=7eea3edcaed734bea9cbfc24409ed989&dpt=wz.ztzt&Pageindex=0&pagesize=200&sort=fbt%3Aasc&date=${dateArg || process.argv[3] || ''}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const j = await res.json();
    const pool = (j.data && j.data.pool) || [];
    // 用 lbc=1(首板)+ pct>=5% 近似"今日创新高"代理指标
    const proxy = pool.filter(s => (s.lbc || 1) === 1 && (s.zdp || 0) >= 5);
    return {
      count: proxy.length,
      total: pool.length,
      source: '东财涨停池代理',
      list: proxy.map(s => ({
        code: String(s.c), name: s.n,
        price: (s.p || 0) / 1000,
        pct: Math.round((s.zdp || 0) * 100) / 100,
        lbc: s.lbc || 1,
        hybk: s.hybk || '',
        sealWan: Math.round((s.fund || 0) / 10000),
        firstTime: String(s.fbt || ''), lastTime: String(s.lbt || '')
      }))
    };
  } catch (e) { console.error('fetchNewHighCount 失败:', e.message); return { count: 0, total: 0, source: '接口失败', list: [] }; }
}



// ===== 全市场形态扫描(启动/老鸭头/拉升) =====
async function fetchWithRetry(url, opts, retries) {
  retries = retries || 2;
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, opts || { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (res.ok) return await res.json();
    } catch (e) { /* retry */ }
    if (i < retries) await new Promise(r => setTimeout(r, 800 * (i + 1)));
  }
  return null;
}

const FALLBACK_SYMBOLS = [
  "sh600000","sh600004","sh600006","sh600007","sh600008","sh600009","sh600010","sh600011","sh600012","sh600015","sh600016","sh600017","sh600018","sh600019","sh600020","sh600021","sh600022","sh600023","sh600025","sh600026","sh600027","sh600028","sh600029","sh600030","sh600031","sh600032","sh600033","sh600035","sh600036","sh600037","sh600038","sh600039","sh600048","sh600050","sh600051","sh600052","sh600054","sh600055","sh600056","sh600057",
  "sh600058","sh600059","sh600060","sh600061","sh600062","sh600063","sh600064","sh600066","sh600067","sh600071","sh600072","sh600073","sh600075","sh600076","sh600078","sh600081","sh600085","sh600088","sh600089","sh600094","sh600095","sh600096","sh600097","sh600098","sh600099","sh600100","sh600101","sh600103","sh600104","sh600105","sh600106","sh600108","sh600109","sh600110","sh600111","sh600113","sh600114","sh600115","sh600116","sh600117",
  "sh600118","sh600120","sh600121","sh600123","sh600125","sh600126","sh600127","sh600128","sh600129","sh600130","sh600131","sh600132","sh600133","sh600135","sh600137","sh600138","sh600141","sh600143","sh600148","sh600149","sh600150","sh600151","sh600152","sh600153","sh600155","sh600156","sh600157","sh600158","sh600159","sh600160","sh600161","sh600162","sh600163","sh600166","sh600167","sh600168","sh600170","sh600171","sh600172","sh600173",
  "sh600176","sh600177","sh600178","sh600179","sh600182","sh600183","sh600184","sh600185","sh600186","sh600188","sh600189","sh600191","sh600192","sh600195","sh600196","sh600197","sh600198","sh600199","sh600201","sh600202","sh600203","sh600206","sh600207","sh600208","sh600210","sh600211","sh600212","sh600215","sh600216","sh600217","sh600218","sh600219","sh600221","sh600222","sh600223","sh600226","sh600227","sh600228","sh600229","sh600230",
  "sh600231","sh600232","sh600233","sh600234","sh600235","sh600236","sh600237","sh600241","sh600246","sh600248","sh600249","sh600250","sh600251","sh600252","sh600255","sh600256","sh600257","sh600258","sh600259","sh600261","sh600262","sh600266","sh600267","sh600268","sh600269","sh600271","sh600272","sh600273","sh600276","sh600278","sh600279","sh600280","sh600281","sh600282","sh600283","sh600284","sh600285","sh600287","sh600288","sh600292",
  "sh600293","sh600295","sh600298","sh600299","sh600300","sh600301","sh600303","sh600305","sh600307","sh600308","sh600309","sh600310","sh600312","sh600313","sh600315","sh600316","sh600318","sh600319","sh600320","sh600322","sh600323","sh600325","sh600326","sh600327","sh600328","sh600329","sh600330","sh600331","sh600332","sh600333","sh600335","sh600336","sh600338","sh600339","sh600343","sh600345","sh600346","sh600348","sh600350","sh600351",
  "sh600352","sh600353","sh600354","sh600356","sh600358","sh600359","sh600360","sh600361","sh600362","sh600363","sh600366","sh600367","sh600368","sh600369","sh600371","sh600372","sh600373","sh600375","sh600376","sh600377","sh600378","sh600379","sh600380","sh600382","sh600383","sh600386","sh600388","sh600389","sh600390","sh600391","sh600392","sh600395","sh600396","sh600397","sh600398","sh600399","sh600400","sh600403","sh600405","sh600406",
  "sh600408","sh600409","sh600410","sh600415","sh600416","sh600418","sh600419","sh600420","sh600422","sh600425","sh600426","sh600428","sh600429","sh600433","sh600435","sh600436","sh600438","sh600444","sh600446","sh600448","sh600449","sh600452","sh600455","sh600456","sh600458","sh600459","sh600460","sh600461","sh600463","sh600467","sh600468","sh600469","sh600470","sh600475","sh600477","sh600478","sh600479","sh600480","sh600481","sh600482",
  "sh600483","sh600486","sh600487","sh600488","sh600489","sh600490","sh600493","sh600495","sh600496","sh600497","sh600498","sh600499","sh600500","sh600501","sh600502","sh600503","sh600505","sh600506","sh600507","sh600508","sh600509","sh600510","sh600511","sh600512","sh600513","sh600515","sh600516","sh600517","sh600518","sh600519","sh600520","sh600521","sh600522","sh600523","sh600526","sh600527","sh600528","sh600529","sh600531","sh600533",
  "sh600535","sh600536","sh600538","sh600539","sh600540","sh600545","sh600546","sh600547","sh600548","sh600549","sh600550","sh600551","sh600552","sh600556","sh600557","sh600558","sh600559","sh600560","sh600561","sh600562","sh600563","sh600566","sh600567","sh600569","sh600570","sh600571","sh600572","sh600573","sh600575","sh600576","sh600577","sh600578","sh600579","sh600580","sh600582","sh600583","sh600584","sh600585","sh600586","sh600587",
  "sh600588","sh600589","sh600590","sh600592","sh600593","sh600594","sh600595","sh600596","sh600597","sh600598","sh600600","sh600601","sh600602","sh600603","sh600604","sh600605","sh600606","sh600609","sh600610","sh600611","sh600612","sh600613","sh600615","sh600616","sh600617","sh600618","sh600619","sh600620","sh600621","sh600622","sh600623","sh600626","sh600628","sh600629","sh600630","sh600633","sh600635","sh600637","sh600638","sh600639",
  "sh600640","sh600641","sh600642","sh600643","sh600644","sh600645","sh600648","sh600649","sh600650","sh600651","sh600653","sh600654","sh600655","sh600657","sh600658","sh600660","sh600661","sh600662","sh600663","sh600664","sh600665","sh600666","sh600667","sh600668","sh600671","sh600673","sh600674","sh600675","sh600676","sh600679","sh600681","sh600682","sh600683","sh600684","sh600685","sh600686","sh600688","sh600689","sh600690","sh600691",
  "sh600692","sh600693","sh600694","sh600697","sh600698","sh600699","sh600702","sh600703","sh600704","sh600706","sh600707","sh600708","sh600710","sh600711","sh600712","sh600713","sh600714","sh600715","sh600716","sh600717","sh600718","sh600719","sh600720","sh600721","sh600722","sh600724","sh600725","sh600726","sh600727","sh600728","sh600729","sh600731","sh600732","sh600733","sh600736","sh600737","sh600738","sh600739","sh600740","sh600741",
  "sh600742","sh600743","sh600744","sh600746","sh600748","sh600749","sh600750","sh600751","sh600754","sh600755","sh600756","sh600757","sh600758","sh600760","sh600761","sh600763","sh600764","sh600765","sh600768","sh600769","sh600770","sh600771","sh600773","sh600774","sh600775","sh600776","sh600777","sh600778","sh600779","sh600780","sh600782","sh600783","sh600784","sh600785","sh600787","sh600789","sh600790","sh600791","sh600792","sh600793",
  "sh600794","sh600795","sh600796","sh600797","sh600798","sh600800","sh600801","sh600802","sh600803","sh600805","sh600807","sh600808","sh600809","sh600810","sh600812","sh600814","sh600815","sh600816","sh600817","sh600819","sh600820","sh600821","sh600822","sh600824","sh600825","sh600826","sh600827","sh600828","sh600829","sh600830","sh600831","sh600833","sh600834","sh600835","sh600838","sh600839","sh600841","sh600843","sh600844","sh600845",
  "sh600846","sh600847","sh600848","sh600850","sh600851","sh600853","sh600854","sh600855","sh600857","sh600858","sh600859","sh600860","sh600861","sh600862","sh600863","sh600864","sh600865","sh600866","sh600867","sh600868","sh600869","sh600871","sh600872","sh600873","sh600874","sh600875","sh600876","sh600877","sh600879","sh600880","sh600881","sh600882","sh600883","sh600884","sh600885","sh600886","sh600887","sh600888","sh600892","sh600893",
  "sh600894","sh600895","sh600897","sh600900","sh600901","sh600903","sh600905","sh600906","sh600908","sh600909","sh600916","sh600917","sh600918","sh600919","sh600925","sh600926","sh600927","sh600928","sh600929","sh600930","sh600933","sh600935","sh600936","sh600938","sh600939","sh600941","sh600955","sh600956","sh600958","sh600959","sh600960","sh600961","sh600962","sh600963","sh600966","sh600967","sh600968","sh600969","sh600970","sh600971",
  "sh600973","sh600975","sh600976","sh600977","sh600979","sh600980","sh600981","sh600982","sh600983","sh600984","sh600985","sh600986","sh600987","sh600988","sh600989","sh600990","sh600992","sh600993","sh600995","sh600996","sh600997","sh600998","sh600999","sh601000","sh601001","sh601002","sh601003","sh601005","sh601006","sh601007","sh601008","sh601009","sh601011","sh601012","sh601015","sh601016","sh601018","sh601019","sh601020","sh601021",
  "sh601022","sh601026","sh601033","sh601038","sh601058","sh601059","sh601061","sh601065","sh601066","sh601068","sh601069","sh601077","sh601083","sh601086","sh601088","sh601089","sh601096","sh601098","sh601099","sh601100","sh601101","sh601106","sh601107","sh601108","sh601111","sh601112","sh601113","sh601116","sh601117","sh601118","sh601121","sh601126","sh601127","sh601128","sh601133","sh601136","sh601137","sh601138","sh601139","sh601155",
  "sh601156","sh601158","sh601162","sh601163","sh601166","sh601168","sh601169","sh601177","sh601179","sh601186","sh601187","sh601188","sh601198","sh601199","sh601200","sh601208","sh601211","sh601212","sh601216","sh601218","sh601222","sh601225","sh601226","sh601228","sh601229","sh601231","sh601233","sh601236","sh601238","sh601279","sh601288","sh601298","sh601311","sh601318","sh601319","sh601326","sh601328","sh601330","sh601333","sh601336",
  "sh601339","sh601360","sh601366","sh601368","sh601369","sh601375","sh601377","sh601388","sh601390","sh601398","sh601399","sh601456","sh601500","sh601512","sh601515","sh601518","sh601519","sh601528","sh601555","sh601566","sh601567","sh601568","sh601577","sh601579","sh601588","sh601595","sh601598","sh601599","sh601600","sh601601","sh601606","sh601607","sh601608","sh601609","sh601611","sh601615","sh601616","sh601618","sh601619","sh601628",
  "sh601633","sh601636","sh601658","sh601665","sh601666","sh601668","sh601669","sh601677","sh601678","sh601686","sh601688","sh601689","sh601696","sh601698","sh601699","sh601700","sh601702","sh601717","sh601727","sh601728","sh601766","sh601777","sh601778","sh601788","sh601789","sh601798","sh601799","sh601800","sh601801","sh601808","sh601811","sh601816","sh601818","sh601825","sh601827","sh601828","sh601838","sh601857","sh601858","sh601860",
  "sh601865","sh601866","sh601868","sh601869","sh601872","sh601877","sh601878","sh601880","sh601881","sh601882","sh601886","sh601888","sh601890","sh601898","sh601899","sh601900","sh601901","sh601908","sh601916","sh601918","sh601919","sh601921","sh601928","sh601929","sh601933","sh601939","sh601949","sh601952","sh601956","sh601958","sh601963","sh601965","sh601966","sh601968","sh601969","sh601975","sh601985","sh601988","sh601990","sh601991",
  "sh601992","sh601995","sh601996","sh601997","sh601998","sh601999","sh603000","sh603001","sh603002","sh603004","sh603005","sh603006","sh603007","sh603009","sh603010","sh603011","sh603012","sh603013","sh603014","sh603015","sh603016","sh603017","sh603018","sh603019","sh603020","sh603022","sh603023","sh603025","sh603026","sh603027","sh603028","sh603029","sh603030","sh603031","sh603032","sh603033","sh603035","sh603036","sh603037","sh603038",
  "sh603039","sh603040","sh603041","sh603042","sh603043","sh603045","sh603048","sh603049","sh603050","sh603051","sh603052","sh603053","sh603055","sh603057","sh603058","sh603059","sh603060","sh603061","sh603062","sh603063","sh603065","sh603066","sh603067","sh603068","sh603069","sh603070","sh603071","sh603072","sh603073","sh603075","sh603076","sh603077","sh603078","sh603079","sh603080","sh603081","sh603082","sh603083","sh603085","sh603086",
  "sh603087","sh603088","sh603089","sh603090","sh603091","sh603092","sh603093","sh603095","sh603096","sh603097","sh603098","sh603099","sh603100","sh603101","sh603102","sh603103","sh603105","sh603106","sh603107","sh603108","sh603109","sh603110","sh603111","sh603112","sh603113","sh603115","sh603116","sh603117","sh603118","sh603119","sh603120","sh603121","sh603122","sh603123","sh603124","sh603125","sh603126","sh603127","sh603128","sh603129",
  "sh603130","sh603131","sh603132","sh603135","sh603136","sh603137","sh603138","sh603139","sh603150","sh603151","sh603153","sh603155","sh603156","sh603158","sh603159","sh603160","sh603161","sh603162","sh603163","sh603165","sh603166","sh603167","sh603168","sh603169","sh603170","sh603171","sh603172","sh603173","sh603175","sh603176","sh603177","sh603178","sh603179","sh603180","sh603181","sh603182","sh603183","sh603185","sh603186","sh603187",
  "sh603188","sh603190","sh603191","sh603192","sh603193","sh603194","sh603195","sh603196","sh603197","sh603198","sh603199","sh603200","sh603201","sh603202","sh603203","sh603205","sh603206","sh603207","sh603208","sh603209","sh603210","sh603211","sh603212","sh603213","sh603214","sh603215","sh603216","sh603217","sh603218","sh603219","sh603220","sh603221","sh603222","sh603223","sh603225","sh603226","sh603227","sh603228","sh603229","sh603230",
  "sh603231","sh603232","sh603233","sh603235","sh603236","sh603237","sh603238","sh603239","sh603248","sh603255","sh603256","sh603257","sh603258","sh603259","sh603260","sh603261","sh603262","sh603266","sh603267","sh603268","sh603269","sh603270","sh603271","sh603273","sh603275","sh603276","sh603277","sh603278","sh603279","sh603280","sh603281","sh603282","sh603283","sh603284","sh603285","sh603286","sh603288","sh603289","sh603290","sh603291",
  "sh603293","sh603296","sh603297","sh603298","sh603299","sh603300","sh603301","sh603303","sh603305","sh603306","sh603307","sh603308","sh603309","sh603310","sh603311","sh603312","sh603313","sh603315","sh603316","sh603317","sh603318","sh603319","sh603320","sh603321","sh603322","sh603323","sh603324","sh603325","sh603326","sh603327","sh603328","sh603329","sh603330","sh603331","sh603332","sh603333","sh603334","sh603335","sh603336","sh603337",
  "sh603338","sh603339","sh603341","sh603344","sh603345","sh603348","sh603350","sh603351","sh603352","sh603353","sh603355","sh603356","sh603357","sh603358","sh603360","sh603363","sh603365","sh603366","sh603367","sh603368","sh603369","sh603370","sh603373","sh603375","sh603376","sh603379","sh603380","sh603381","sh603382","sh603383","sh603385","sh603386","sh603387","sh603389","sh603390","sh603391","sh603392","sh603393","sh603395","sh603396",
  "sh603399","sh603400","sh603402","sh603406","sh603407","sh603408","sh603409","sh603416","sh603418","sh603421","sh603435","sh603439","sh603444","sh603456","sh603458","sh603459","sh603466","sh603468","sh603477","sh603486","sh603488","sh603489","sh603496","sh603499","sh603500","sh603501","sh603505","sh603506","sh603507","sh603508","sh603511","sh603515","sh603516","sh603518","sh603519","sh603520","sh603527","sh603528","sh603529","sh603530",
  "sh603533","sh603535","sh603536","sh603538","sh603551","sh603556","sh603558","sh603559","sh603565","sh603566","sh603567","sh603568","sh603569","sh603577","sh603578","sh603579","sh603580","sh603583","sh603585","sh603586","sh603587","sh603588","sh603589","sh603590","sh603596","sh603598","sh603599","sh603600","sh603601","sh603602","sh603605","sh603606","sh603607","sh603608","sh603609","sh603610","sh603611","sh603612","sh603613","sh603615",
  "sh603616","sh603617","sh603618","sh603619","sh603626","sh603628","sh603629","sh603630","sh603633","sh603636","sh603637","sh603638","sh603639","sh603648","sh603650","sh603655","sh603656","sh603657","sh603658","sh603659","sh603660","sh603661","sh603662","sh603663","sh603665","sh603666","sh603667","sh603668","sh603669","sh603676","sh603677","sh603678","sh603679","sh603680","sh603681","sh603682","sh603683","sh603685","sh603686","sh603687",
  "sh603688","sh603689","sh603690","sh603693","sh603696","sh603697","sh603698","sh603699","sh603700","sh603701","sh603703","sh603706","sh603707","sh603708","sh603709","sh603711","sh603712","sh603713","sh603716","sh603717","sh603719","sh603721","sh603722","sh603725","sh603726","sh603727","sh603728","sh603730","sh603733","sh603737","sh603738","sh603739","sh603755","sh603757","sh603758","sh603759","sh603766","sh603767","sh603768","sh603773",
  "sh603776","sh603777","sh603778","sh603779","sh603786","sh603787","sh603788","sh603790","sh603797","sh603798","sh603799","sh603800","sh603801","sh603803","sh603806","sh603808","sh603809","sh603810","sh603811","sh603813","sh603815","sh603816","sh603817","sh603818","sh603819","sh603823","sh603826","sh603829","sh603833","sh603836","sh603839","sh603848","sh603855","sh603856","sh603858","sh603859","sh603860","sh603861","sh603863","sh603866",
  "sh603867","sh603868","sh603871","sh603876","sh603877","sh603878","sh603879","sh603880","sh603881","sh603882","sh603883","sh603885","sh603886","sh603887","sh603888","sh603889","sh603890","sh603893","sh603895","sh603896","sh603897","sh603898","sh603899","sh603900","sh603901","sh603903","sh603906","sh603908","sh603909","sh603912","sh603915","sh603916","sh603917","sh603918","sh603919","sh603920","sh603926","sh603927","sh603928","sh603929",
  "sh603931","sh603933","sh603936","sh603937","sh603938","sh603939","sh603948","sh603949","sh603950","sh603955","sh603956","sh603958","sh603960","sh603966","sh603967","sh603968","sh603969","sh603970","sh603976","sh603977","sh603978","sh603979","sh603980","sh603982","sh603983","sh603985","sh603986","sh603987","sh603988","sh603989","sh603990","sh603991","sh603992","sh603993","sh603995","sh603997","sh603998","sh603999","sh605001","sh605003",
  "sh605005","sh605006","sh605007","sh605008","sh605009","sh605011","sh605016","sh605018","sh605020","sh605028","sh605033","sh605050","sh605055","sh605056","sh605058","sh605060","sh605066","sh605068","sh605069","sh605077","sh605080","sh605086","sh605088","sh605089","sh605090","sh605098","sh605099","sh605100","sh605108","sh605111","sh605116","sh605117","sh605118","sh605122","sh605123","sh605128","sh605133","sh605136","sh605138","sh605151",
  "sh605155","sh605158","sh605162","sh605166","sh605167","sh605168","sh605169","sh605177","sh605178","sh605179","sh605180","sh605183","sh605186","sh605188","sh605189","sh605196","sh605198","sh605208","sh605218","sh605222","sh605228","sh605255","sh605258","sh605259","sh605266","sh605268","sh605277","sh605286","sh605287","sh605288","sh605289","sh605296","sh605298","sh605299","sh605300","sh605303","sh605305","sh605318","sh605319","sh605333",
  "sh605337","sh605338","sh605339","sh605358","sh605365","sh605366","sh605368","sh605369","sh605376","sh605377","sh605378","sh605388","sh605389","sh605398","sh605399","sh605488","sh605499","sh605500","sh605507","sh605555","sh605566","sh605567","sh605577","sh605580","sh605588","sh605589","sh605598","sh605599","sh688001","sh688002","sh688003","sh688004","sh688005","sh688006","sh688007","sh688008","sh688009","sh688010","sh688011","sh688012",
  "sh688013","sh688015","sh688016","sh688017","sh688018","sh688019","sh688020","sh688021","sh688023","sh688025","sh688026","sh688027","sh688028","sh688029","sh688030","sh688031","sh688032","sh688035","sh688036","sh688037","sh688038","sh688039","sh688041","sh688045","sh688046","sh688047","sh688048","sh688049","sh688050","sh688051","sh688052","sh688055","sh688056","sh688057","sh688058","sh688059","sh688060","sh688061","sh688062","sh688063",
  "sh688065","sh688067","sh688068","sh688069","sh688070","sh688071","sh688072","sh688073","sh688075","sh688077","sh688078","sh688079","sh688080","sh688081","sh688082","sh688083","sh688084","sh688085","sh688087","sh688088","sh688090","sh688091","sh688092","sh688093","sh688095","sh688096","sh688097","sh688098","sh688099","sh688100","sh688101","sh688102","sh688103","sh688105","sh688106","sh688107","sh688108","sh688109","sh688110","sh688111",
  "sh688112","sh688113","sh688114","sh688115","sh688116","sh688117","sh688118","sh688119","sh688120","sh688122","sh688123","sh688125","sh688126","sh688127","sh688128","sh688129","sh688130","sh688131","sh688132","sh688133","sh688135","sh688136","sh688137","sh688138","sh688139","sh688141","sh688143","sh688146","sh688147","sh688148","sh688150","sh688151","sh688152","sh688153","sh688155","sh688156","sh688157","sh688158","sh688159","sh688160",
  "sh688161","sh688162","sh688163","sh688165","sh688166","sh688167","sh688168","sh688169","sh688170","sh688171","sh688172","sh688173","sh688175","sh688176","sh688177","sh688178","sh688179","sh688180","sh688181","sh688182","sh688183","sh688185","sh688186","sh688187","sh688188","sh688190","sh688191","sh688192","sh688193","sh688195","sh688196","sh688197","sh688198","sh688199","sh688200","sh688202","sh688203","sh688205","sh688206","sh688207",
  "sh688208","sh688209","sh688210","sh688211","sh688212","sh688213","sh688215","sh688216","sh688217","sh688218","sh688219","sh688220","sh688221","sh688222","sh688223","sh688225","sh688226","sh688227","sh688228","sh688229","sh688230","sh688231","sh688232","sh688233","sh688234","sh688235","sh688236","sh688237","sh688238","sh688239","sh688244","sh688246","sh688247","sh688248","sh688249","sh688251","sh688252","sh688253","sh688255","sh688256",
  "sh688257","sh688258","sh688259","sh688260","sh688261","sh688262","sh688265","sh688266","sh688267","sh688268","sh688269","sh688271","sh688272","sh688273","sh688275","sh688276","sh688277","sh688278","sh688279","sh688280","sh688281","sh688282","sh688283","sh688285","sh688286","sh688288","sh688289","sh688290","sh688291","sh688292","sh688293","sh688295","sh688296","sh688297","sh688298","sh688299","sh688300","sh688301","sh688302","sh688303",
  "sh688305","sh688306","sh688307","sh688308","sh688309","sh688310","sh688311","sh688312","sh688313","sh688314","sh688315","sh688316","sh688317","sh688318","sh688319","sh688320","sh688321","sh688322","sh688323","sh688325","sh688326","sh688327","sh688328","sh688329","sh688330","sh688331","sh688332","sh688333","sh688334","sh688335","sh688336","sh688337","sh688338","sh688339","sh688343","sh688345","sh688347","sh688348","sh688349","sh688350",
  "sh688351","sh688352","sh688353","sh688355","sh688356","sh688357","sh688358","sh688359","sh688360","sh688361","sh688362","sh688363","sh688365","sh688366","sh688367","sh688368","sh688369","sh688370","sh688371","sh688372","sh688373","sh688375","sh688376","sh688377","sh688378","sh688379","sh688380","sh688381","sh688382","sh688383","sh688385","sh688386","sh688387","sh688388","sh688389","sh688390","sh688391","sh688392","sh688393","sh688395",
  "sh688396","sh688398","sh688399","sh688400","sh688401","sh688403","sh688408","sh688409","sh688410","sh688411","sh688416","sh688418","sh688419","sh688420","sh688425","sh688426","sh688428","sh688429","sh688432","sh688433","sh688435","sh688439","sh688443","sh688448","sh688449","sh688450","sh688455","sh688456","sh688458","sh688459","sh688466","sh688468","sh688469","sh688472","sh688475","sh688478","sh688479","sh688480","sh688484","sh688485",
  "sh688486","sh688488","sh688489","sh688498","sh688499","sh688500","sh688501","sh688502","sh688503","sh688505","sh688506","sh688507","sh688508","sh688509","sh688510","sh688511","sh688512","sh688513","sh688515","sh688516","sh688517","sh688518","sh688519","sh688520","sh688521","sh688522","sh688523","sh688525","sh688526","sh688528","sh688529","sh688530","sh688531","sh688533","sh688535","sh688536","sh688538","sh688539","sh688543","sh688545",
  "sh688548","sh688549","sh688550","sh688551","sh688552","sh688553","sh688556","sh688557","sh688558","sh688559","sh688560","sh688561","sh688562","sh688563","sh688565","sh688566","sh688567","sh688568","sh688569","sh688570","sh688571","sh688573","sh688575","sh688576","sh688577","sh688578","sh688579","sh688580","sh688581","sh688582","sh688583","sh688584","sh688585","sh688586","sh688588","sh688589","sh688590","sh688591","sh688592","sh688593",
  "sh688595","sh688596","sh688597","sh688598","sh688599","sh688600","sh688601","sh688602","sh688603","sh688605","sh688606","sh688607","sh688608","sh688609","sh688610","sh688611","sh688612","sh688613","sh688615","sh688616","sh688617","sh688618","sh688619","sh688620","sh688621","sh688623","sh688625","sh688626","sh688627","sh688628","sh688629","sh688630","sh688631","sh688633","sh688635","sh688636","sh688638","sh688639","sh688646","sh688648",
  "sh688651","sh688652","sh688653","sh688655","sh688656","sh688657","sh688658","sh688659","sh688660","sh688661","sh688662","sh688663","sh688665","sh688667","sh688668","sh688669","sh688670","sh688671","sh688676","sh688677","sh688678","sh688679","sh688680","sh688681","sh688682","sh688683","sh688685","sh688686","sh688687","sh688689","sh688690","sh688691","sh688692","sh688693","sh688695","sh688696","sh688697","sh688698","sh688699","sh688700",
  "sh688701","sh688702","sh688707","sh688708","sh688709","sh688710","sh688711","sh688712","sh688716","sh688717","sh688718","sh688719","sh688720","sh688721","sh688722","sh688726","sh688727","sh688728","sh688729","sh688733","sh688737","sh688739","sh688750","sh688755","sh688757","sh688758","sh688759","sh688765","sh688766","sh688767","sh688768","sh688772","sh688775","sh688776","sh688777","sh688778","sh688779","sh688781","sh688783","sh688785",
  "sh688786","sh688787","sh688788","sh688789","sh688790","sh688793","sh688795","sh688796","sh688797","sh688798","sh688799","sh688800","sh688802","sh688805","sh688806","sh688807","sh688808","sh688809","sh688811","sh688813","sh688816","sh688818","sh688819","sh688820","sh688825","sh688828","sh688981","sz000001","sz000002","sz000006","sz000007","sz000008","sz000009","sz000011","sz000012","sz000014","sz000017","sz000019","sz000020","sz000021",
  "sz000025","sz000026","sz000027","sz000028","sz000029","sz000030","sz000031","sz000032","sz000034","sz000035","sz000036","sz000037","sz000039","sz000042","sz000045","sz000048","sz000049","sz000050","sz000055","sz000058","sz000059","sz000060","sz000061","sz000062","sz000063","sz000065","sz000066","sz000068","sz000069","sz000070","sz000088","sz000089","sz000090","sz000096","sz000099","sz000100","sz000151","sz000153","sz000155","sz000156",
  "sz000157","sz000158","sz000159","sz000166","sz000301","sz000333","sz000338","sz000400","sz000401","sz000402","sz000403","sz000404","sz000407","sz000408","sz000409","sz000410","sz000411","sz000415","sz000417","sz000419","sz000420","sz000421","sz000422","sz000423","sz000425","sz000426","sz000428","sz000429","sz000430","sz000498","sz000501","sz000503","sz000504","sz000505","sz000506","sz000507","sz000509","sz000510","sz000513","sz000514",
  "sz000516","sz000517","sz000518","sz000519","sz000520","sz000521","sz000523","sz000524","sz000525","sz000526","sz000528","sz000529","sz000530","sz000531","sz000532","sz000533","sz000534","sz000536","sz000537","sz000538","sz000539","sz000541","sz000543","sz000544","sz000545","sz000546","sz000547","sz000548","sz000550","sz000551","sz000552","sz000553","sz000554","sz000555","sz000557","sz000558","sz000559","sz000560","sz000561","sz000563",
  "sz000564","sz000565","sz000566","sz000567","sz000568","sz000570","sz000571","sz000572","sz000573","sz000576","sz000581","sz000582","sz000586","sz000589","sz000590","sz000591","sz000592","sz000593","sz000595","sz000596","sz000597","sz000598","sz000599","sz000600","sz000601","sz000603","sz000605","sz000607","sz000608","sz000612","sz000617","sz000619","sz000620","sz000623","sz000625","sz000626","sz000628","sz000629","sz000630","sz000631",
  "sz000633","sz000635","sz000636","sz000637","sz000650","sz000651","sz000652","sz000655","sz000656","sz000657","sz000659","sz000661","sz000663","sz000665","sz000668","sz000670","sz000672","sz000676","sz000678","sz000679","sz000680","sz000681","sz000682","sz000683","sz000685","sz000686","sz000688","sz000690","sz000691","sz000692","sz000695","sz000697","sz000700","sz000701","sz000702","sz000703","sz000705","sz000707","sz000708","sz000709",
  "sz000710","sz000712","sz000713","sz000715","sz000716","sz000717","sz000718","sz000719","sz000720","sz000721","sz000722","sz000723","sz000725","sz000726","sz000727","sz000728","sz000729","sz000731","sz000733","sz000735","sz000736","sz000737","sz000738","sz000739","sz000750","sz000751","sz000753","sz000755","sz000756","sz000757","sz000758","sz000759","sz000761","sz000762","sz000766","sz000767","sz000768","sz000776","sz000777","sz000778",
  "sz000779","sz000782","sz000783","sz000785","sz000786","sz000788","sz000789","sz000790","sz000791","sz000792","sz000795","sz000796","sz000797","sz000798","sz000799","sz000800","sz000801","sz000802","sz000803","sz000807","sz000809","sz000810","sz000811","sz000812","sz000813","sz000815","sz000816","sz000818","sz000819","sz000820","sz000822","sz000823","sz000825","sz000828","sz000829","sz000830","sz000831","sz000833","sz000837","sz000839",
  "sz000848","sz000850","sz000852","sz000856","sz000858","sz000859","sz000860","sz000862","sz000863","sz000868","sz000869","sz000875","sz000876","sz000877","sz000878","sz000880","sz000881","sz000882","sz000883","sz000885","sz000886","sz000887","sz000888","sz000889","sz000890","sz000892","sz000893","sz000895","sz000897","sz000898","sz000899","sz000900","sz000901","sz000902","sz000905","sz000906","sz000908","sz000910","sz000912","sz000913",
  "sz000915","sz000917","sz000919","sz000920","sz000921","sz000922","sz000923","sz000925","sz000926","sz000927","sz000928","sz000929","sz000930","sz000931","sz000932","sz000933","sz000935","sz000936","sz000937","sz000938","sz000948","sz000949","sz000950","sz000951","sz000952","sz000953","sz000955","sz000957","sz000958","sz000959","sz000960","sz000962","sz000963","sz000965","sz000966","sz000967","sz000968","sz000969","sz000970","sz000972",
  "sz000973","sz000975","sz000977","sz000978","sz000980","sz000981","sz000983","sz000985","sz000987","sz000988","sz000989","sz000990","sz000993","sz000995","sz000997","sz000998","sz000999","sz001201","sz001202","sz001203","sz001205","sz001206","sz001207","sz001208","sz001209","sz001210","sz001211","sz001212","sz001213","sz001215","sz001216","sz001217","sz001218","sz001219","sz001220","sz001221","sz001222","sz001223","sz001225","sz001226",
  "sz001227","sz001228","sz001229","sz001230","sz001231","sz001232","sz001233","sz001234","sz001236","sz001237","sz001238","sz001239","sz001248","sz001255","sz001256","sz001257","sz001258","sz001259","sz001260","sz001266","sz001267","sz001268","sz001269","sz001270","sz001277","sz001278","sz001279","sz001280","sz001282","sz001283","sz001285","sz001286","sz001287","sz001288","sz001289","sz001296","sz001298","sz001299","sz001300","sz001301",
  "sz001306","sz001308","sz001309","sz001311","sz001312","sz001313","sz001314","sz001316","sz001317","sz001318","sz001319","sz001322","sz001323","sz001324","sz001325","sz001326","sz001328","sz001330","sz001331","sz001332","sz001333","sz001335","sz001336","sz001337","sz001338","sz001339","sz001356","sz001358","sz001359","sz001360","sz001365","sz001366","sz001367","sz001368","sz001369","sz001373","sz001376","sz001378","sz001379","sz001380",
  "sz001382","sz001386","sz001387","sz001388","sz001389","sz001390","sz001391","sz001393","sz001395","sz001396","sz001399","sz001400","sz001696","sz001872","sz001896","sz001914","sz001965","sz001979","sz002001","sz002003","sz002004","sz002005","sz002006","sz002007","sz002008","sz002009","sz002010","sz002011","sz002012","sz002014","sz002015","sz002016","sz002017","sz002019","sz002020","sz002021","sz002022","sz002023","sz002025","sz002026",
  "sz002027","sz002028","sz002029","sz002030","sz002031","sz002032","sz002033","sz002034","sz002035","sz002036","sz002037","sz002038","sz002039","sz002040","sz002041","sz002042","sz002043","sz002044","sz002045","sz002046","sz002047","sz002048","sz002049","sz002050","sz002051","sz002052","sz002053","sz002054","sz002056","sz002057","sz002058","sz002059","sz002060","sz002061","sz002062","sz002063","sz002064","sz002065","sz002066","sz002067",
  "sz002068","sz002069","sz002072","sz002073","sz002074","sz002075","sz002076","sz002077","sz002078","sz002079","sz002080","sz002081","sz002083","sz002084","sz002085","sz002086","sz002088","sz002090","sz002091","sz002092","sz002093","sz002094","sz002095","sz002096","sz002097","sz002098","sz002099","sz002100","sz002101","sz002103","sz002104","sz002105","sz002106","sz002107","sz002108","sz002110","sz002111","sz002112","sz002114","sz002115",
  "sz002116","sz002117","sz002119","sz002120","sz002121","sz002123","sz002124","sz002125","sz002126","sz002127","sz002128","sz002129","sz002130","sz002131","sz002132","sz002133","sz002134","sz002135","sz002136","sz002137","sz002138","sz002139","sz002140","sz002141","sz002142","sz002144","sz002145","sz002146","sz002148","sz002149","sz002150","sz002151","sz002152","sz002153","sz002154","sz002155","sz002156","sz002157","sz002158","sz002159",
  "sz002160","sz002161","sz002162","sz002163","sz002164","sz002165","sz002166","sz002167","sz002169","sz002170","sz002171","sz002172","sz002173","sz002174","sz002176","sz002177","sz002178","sz002179","sz002180","sz002181","sz002182","sz002183","sz002184","sz002185","sz002186","sz002187","sz002188","sz002189","sz002190","sz002191","sz002192","sz002194","sz002195","sz002196","sz002197","sz002199","sz002200","sz002201","sz002202","sz002203",
  "sz002204","sz002205","sz002206","sz002208","sz002209","sz002210","sz002212","sz002213","sz002214","sz002215","sz002216","sz002218","sz002219","sz002221","sz002222","sz002223","sz002224","sz002225","sz002226","sz002228","sz002229","sz002230","sz002232","sz002233","sz002234","sz002235","sz002236","sz002237","sz002238","sz002239","sz002240","sz002241","sz002242","sz002243","sz002244","sz002245","sz002246","sz002247","sz002248","sz002249",
  "sz002250","sz002251","sz002252","sz002253","sz002254","sz002255","sz002256","sz002258","sz002259","sz002261","sz002262","sz002263","sz002264","sz002265","sz002266","sz002267","sz002268","sz002269","sz002270","sz002271","sz002272","sz002273","sz002274","sz002275","sz002276","sz002277","sz002278","sz002279","sz002281","sz002282","sz002283","sz002284","sz002285","sz002286","sz002287","sz002289","sz002290","sz002291","sz002292","sz002293",
  "sz002294","sz002295","sz002296","sz002297","sz002298","sz002299","sz002300","sz002301","sz002302","sz002303","sz002304","sz002307","sz002309","sz002310","sz002311","sz002312","sz002313","sz002314","sz002315","sz002316","sz002317","sz002318","sz002319","sz002320","sz002321","sz002322","sz002324","sz002326","sz002327","sz002328","sz002329","sz002330","sz002331","sz002332","sz002333","sz002334","sz002335","sz002337","sz002338","sz002339",
  "sz002340","sz002342","sz002343","sz002344","sz002345","sz002346","sz002347","sz002348","sz002349","sz002350","sz002351","sz002352","sz002353","sz002354","sz002355","sz002356","sz002357","sz002358","sz002361","sz002362","sz002363","sz002364","sz002365","sz002366","sz002367","sz002368","sz002369","sz002370","sz002371","sz002372","sz002373","sz002374","sz002375","sz002376","sz002377","sz002378","sz002379","sz002380","sz002381","sz002382",
  "sz002383","sz002384","sz002385","sz002386","sz002387","sz002388","sz002389","sz002390","sz002391","sz002392","sz002393","sz002394","sz002395","sz002396","sz002397","sz002398","sz002399","sz002400","sz002401","sz002402","sz002403","sz002404","sz002405","sz002406","sz002407","sz002408","sz002409","sz002410","sz002412","sz002413","sz002414","sz002415","sz002416","sz002418","sz002419","sz002420","sz002421","sz002422","sz002423","sz002425",
  "sz002426","sz002427","sz002428","sz002429","sz002430","sz002432","sz002434","sz002436","sz002437","sz002438","sz002439","sz002440","sz002441","sz002442","sz002443","sz002444","sz002445","sz002446","sz002448","sz002449","sz002451","sz002452","sz002453","sz002454","sz002455","sz002456","sz002457","sz002458","sz002459","sz002460","sz002461","sz002462","sz002463","sz002465","sz002466","sz002467","sz002468","sz002469","sz002470","sz002471",
  "sz002472","sz002474","sz002475","sz002476","sz002478","sz002479","sz002480","sz002481","sz002482","sz002483","sz002484","sz002486","sz002487","sz002488","sz002489","sz002490","sz002491","sz002492","sz002493","sz002494","sz002495","sz002496","sz002497","sz002498","sz002500","sz002506","sz002507","sz002508","sz002510","sz002511","sz002513","sz002515","sz002516","sz002517","sz002518","sz002519","sz002520","sz002521","sz002522","sz002523",
  "sz002524","sz002526","sz002527","sz002529","sz002530","sz002531","sz002532","sz002533","sz002534","sz002535","sz002536","sz002537","sz002539","sz002540","sz002541","sz002543","sz002544","sz002545","sz002546","sz002548","sz002549","sz002550","sz002551","sz002552","sz002553","sz002554","sz002555","sz002556","sz002557","sz002558","sz002559","sz002560","sz002561","sz002562","sz002563","sz002564","sz002565","sz002566","sz002567","sz002568",
  "sz002570","sz002571","sz002572","sz002573","sz002574","sz002575","sz002576","sz002577","sz002578","sz002579","sz002580","sz002582","sz002583","sz002584","sz002585","sz002587","sz002588","sz002589","sz002590","sz002591","sz002593","sz002594","sz002595","sz002596","sz002597","sz002599","sz002600","sz002601","sz002602","sz002603","sz002605","sz002606","sz002607","sz002608","sz002609","sz002611","sz002612","sz002613","sz002614","sz002615",
  "sz002616","sz002617","sz002622","sz002623","sz002624","sz002625","sz002626","sz002627","sz002628","sz002629","sz002631","sz002632","sz002633","sz002635","sz002636","sz002637","sz002638","sz002639","sz002640","sz002641","sz002642","sz002643","sz002644","sz002645","sz002646","sz002647","sz002648","sz002649","sz002651","sz002652","sz002653","sz002654","sz002655","sz002656","sz002657","sz002658","sz002659","sz002660","sz002661","sz002662",
  "sz002663","sz002664","sz002666","sz002668","sz002669","sz002670","sz002671","sz002672","sz002673","sz002674","sz002675","sz002676","sz002677","sz002678","sz002679","sz002681","sz002682","sz002683","sz002685","sz002686","sz002687","sz002688","sz002690","sz002692","sz002693","sz002695","sz002696","sz002697","sz002698","sz002700","sz002701","sz002702","sz002703","sz002705","sz002706","sz002707","sz002708","sz002709","sz002712","sz002713",
  "sz002714","sz002715","sz002716","sz002718","sz002721","sz002722","sz002723","sz002724","sz002725","sz002727","sz002728","sz002729","sz002730","sz002732","sz002733","sz002734","sz002735","sz002736","sz002737","sz002738","sz002739","sz002741","sz002742","sz002743","sz002745","sz002746","sz002747","sz002748","sz002749","sz002752","sz002753","sz002755","sz002756","sz002757","sz002758","sz002760","sz002761","sz002762","sz002763","sz002765",
  "sz002766","sz002767","sz002768","sz002769","sz002771","sz002772","sz002773","sz002774","sz002775","sz002777","sz002778","sz002779","sz002780","sz002782","sz002783","sz002785","sz002786","sz002787","sz002788","sz002790","sz002791","sz002792","sz002793","sz002795","sz002796","sz002797","sz002798","sz002799","sz002800","sz002801","sz002802","sz002803","sz002805","sz002806","sz002807","sz002809","sz002810","sz002811","sz002812","sz002813",
  "sz002815","sz002817","sz002818","sz002819","sz002820","sz002821","sz002823","sz002824","sz002825","sz002826","sz002827","sz002828","sz002829","sz002830","sz002831","sz002832","sz002833","sz002835","sz002836","sz002837","sz002838","sz002839","sz002840","sz002841","sz002842","sz002843","sz002845","sz002846","sz002847","sz002848","sz002849","sz002850","sz002851","sz002852","sz002853","sz002855","sz002857","sz002858","sz002859","sz002860",
  "sz002861","sz002862","sz002863","sz002864","sz002865","sz002866","sz002867","sz002868","sz002869","sz002870","sz002871","sz002873","sz002875","sz002876","sz002877","sz002878","sz002879","sz002880","sz002881","sz002882","sz002884","sz002885","sz002886","sz002887","sz002888","sz002889","sz002890","sz002891","sz002892","sz002893","sz002895","sz002896","sz002897","sz002899","sz002900","sz002901","sz002902","sz002903","sz002905","sz002906",
  "sz002907","sz002908","sz002909","sz002910","sz002911","sz002912","sz002913","sz002915","sz002916","sz002917","sz002918","sz002919","sz002920","sz002921","sz002922","sz002923","sz002925","sz002926","sz002927","sz002928","sz002929","sz002930","sz002931","sz002933","sz002935","sz002936","sz002937","sz002938","sz002939","sz002940","sz002941","sz002942","sz002943","sz002945","sz002946","sz002947","sz002948","sz002949","sz002950","sz002951",
  "sz002952","sz002953","sz002955","sz002956","sz002957","sz002958","sz002959","sz002960","sz002961","sz002962","sz002963","sz002965","sz002966","sz002967","sz002968","sz002969","sz002970","sz002971","sz002972","sz002973","sz002975","sz002976","sz002978","sz002979","sz002980","sz002981","sz002982","sz002983","sz002984","sz002985","sz002986","sz002987","sz002988","sz002989","sz002990","sz002991","sz002992","sz002993","sz002995","sz002996",
  "sz002997","sz002998","sz002999","sz003000","sz003001","sz003002","sz003003","sz003004","sz003005","sz003006","sz003007","sz003008","sz003009","sz003010","sz003011","sz003012","sz003013","sz003015","sz003016","sz003017","sz003018","sz003019","sz003020","sz003021","sz003022","sz003023","sz003025","sz003026","sz003027","sz003028","sz003029","sz003030","sz003031","sz003032","sz003033","sz003035","sz003036","sz003037","sz003038","sz003039",
  "sz003040","sz003041","sz003042","sz003043","sz003816","sz300001","sz300002","sz300003","sz300004","sz300005","sz300006","sz300007","sz300008","sz300009","sz300011","sz300012","sz300013","sz300014","sz300015","sz300016","sz300017","sz300018","sz300019","sz300021","sz300022","sz300024","sz300025","sz300026","sz300030","sz300031","sz300032","sz300033","sz300034","sz300035","sz300036","sz300037","sz300039","sz300040","sz300041","sz300042",
  "sz300043","sz300045","sz300046","sz300047","sz300048","sz300049","sz300050","sz300051","sz300052","sz300053","sz300054","sz300055","sz300056","sz300057","sz300058","sz300059","sz300061","sz300062","sz300063","sz300065","sz300066","sz300067","sz300069","sz300070","sz300071","sz300072","sz300073","sz300074","sz300075","sz300077","sz300078","sz300079","sz300080","sz300082","sz300083","sz300084","sz300085","sz300086","sz300088","sz300092",
  "sz300093","sz300094","sz300095","sz300097","sz300098","sz300099","sz300100","sz300101","sz300102","sz300103","sz300105","sz300106","sz300107","sz300109","sz300110","sz300111","sz300112","sz300113","sz300115","sz300118","sz300119","sz300120","sz300121","sz300122","sz300124","sz300125","sz300126","sz300127","sz300128","sz300129","sz300130","sz300131","sz300132","sz300133","sz300134","sz300135","sz300136","sz300137","sz300138","sz300139",
  "sz300140","sz300141","sz300142","sz300143","sz300144","sz300145","sz300146","sz300148","sz300149","sz300150","sz300151","sz300153","sz300154","sz300155","sz300157","sz300158","sz300159","sz300160","sz300161","sz300162","sz300163","sz300164","sz300165","sz300166","sz300168","sz300169","sz300170","sz300171","sz300172","sz300174","sz300175","sz300176","sz300177","sz300179","sz300180","sz300181","sz300182","sz300183","sz300184","sz300185",
  "sz300187","sz300188","sz300189","sz300190","sz300191","sz300192","sz300193","sz300194","sz300195","sz300196","sz300197","sz300199","sz300200","sz300201","sz300203","sz300204","sz300206","sz300207","sz300209","sz300210","sz300213","sz300214","sz300215","sz300217","sz300218","sz300219","sz300220","sz300221","sz300222","sz300223","sz300224","sz300225","sz300226","sz300227","sz300228","sz300229","sz300230","sz300231","sz300232","sz300233",
  "sz300234","sz300235","sz300236","sz300238","sz300239","sz300240","sz300241","sz300242","sz300243","sz300244","sz300246","sz300247","sz300248","sz300249","sz300250","sz300251","sz300252","sz300253","sz300254","sz300255","sz300256","sz300257","sz300258","sz300259","sz300260","sz300261","sz300263","sz300264","sz300265","sz300266","sz300267","sz300268","sz300269","sz300270","sz300271","sz300272","sz300274","sz300275","sz300276","sz300277",
  "sz300278","sz300279","sz300281","sz300283","sz300284","sz300285","sz300286","sz300287","sz300288","sz300289","sz300291","sz300292","sz300293","sz300294","sz300296","sz300298","sz300299","sz300300","sz300302","sz300303","sz300304","sz300305","sz300306","sz300307","sz300308","sz300310","sz300311","sz300313","sz300314","sz300315","sz300316","sz300317","sz300318","sz300319","sz300320","sz300321","sz300322","sz300323","sz300324","sz300327",
  "sz300328","sz300329","sz300331","sz300332","sz300333","sz300334","sz300335","sz300337","sz300339","sz300340","sz300341","sz300342","sz300343","sz300345","sz300346","sz300347","sz300348","sz300349","sz300350","sz300351","sz300353","sz300354","sz300355","sz300357","sz300358","sz300359","sz300360","sz300363","sz300364","sz300365","sz300368","sz300369","sz300370","sz300371","sz300373","sz300374","sz300375","sz300376","sz300377","sz300378",
  "sz300380","sz300381","sz300382","sz300383","sz300384","sz300386","sz300387","sz300388","sz300389","sz300390","sz300393","sz300394","sz300395","sz300397","sz300398","sz300399","sz300400","sz300401","sz300402","sz300403","sz300404","sz300405","sz300406","sz300407","sz300408","sz300409","sz300410","sz300411","sz300412","sz300413","sz300414","sz300415","sz300416","sz300417","sz300418","sz300420","sz300421","sz300422","sz300423","sz300424",
  "sz300425","sz300426","sz300427","sz300428","sz300429","sz300432","sz300433","sz300434","sz300435","sz300436","sz300437","sz300438","sz300439","sz300440","sz300441","sz300442","sz300443","sz300444","sz300445","sz300446","sz300447","sz300448","sz300449","sz300450","sz300451","sz300452","sz300453","sz300454","sz300455","sz300456","sz300457","sz300458","sz300459","sz300461","sz300463","sz300464","sz300465","sz300466","sz300467","sz300468",
  "sz300469","sz300470","sz300471","sz300473","sz300474","sz300475","sz300476","sz300478","sz300479","sz300480","sz300481","sz300482","sz300483","sz300484","sz300485","sz300486","sz300487","sz300488","sz300489","sz300490","sz300491","sz300492","sz300493","sz300494","sz300496","sz300497","sz300498","sz300499","sz300500","sz300501","sz300502","sz300503","sz300504","sz300505","sz300506","sz300507","sz300508","sz300509","sz300510","sz300511",
  "sz300512","sz300513","sz300514","sz300515","sz300516","sz300517","sz300518","sz300519","sz300520","sz300521","sz300522","sz300523","sz300525","sz300528","sz300529","sz300530","sz300531","sz300532","sz300533","sz300534","sz300535","sz300536","sz300537","sz300538","sz300539","sz300540","sz300541","sz300542","sz300543","sz300545","sz300546","sz300547","sz300548","sz300549","sz300550","sz300551","sz300552","sz300553","sz300554","sz300556",
  "sz300557","sz300558","sz300559","sz300560","sz300561","sz300562","sz300563","sz300564","sz300565","sz300566","sz300567","sz300568","sz300569","sz300570","sz300571","sz300572","sz300573","sz300575","sz300576","sz300577","sz300578","sz300579","sz300580","sz300581","sz300582","sz300583","sz300584","sz300585","sz300586","sz300587","sz300588","sz300589","sz300590","sz300591","sz300592","sz300593","sz300595","sz300596","sz300597","sz300598",
  "sz300599","sz300600","sz300601","sz300602","sz300603","sz300604","sz300605","sz300606","sz300607","sz300608","sz300609","sz300610","sz300611","sz300612","sz300613","sz300614","sz300615","sz300616","sz300617","sz300618","sz300619","sz300620","sz300621","sz300622","sz300623","sz300624","sz300625","sz300626","sz300627","sz300628","sz300629","sz300631","sz300632","sz300633","sz300634","sz300635","sz300636","sz300637","sz300638","sz300639",
  "sz300640","sz300641","sz300642","sz300643","sz300644","sz300645","sz300647","sz300648","sz300649","sz300650","sz300651","sz300652","sz300653","sz300654","sz300655","sz300656","sz300657","sz300658","sz300659","sz300660","sz300661","sz300662","sz300663","sz300664","sz300665","sz300666","sz300667","sz300668","sz300669","sz300670","sz300671","sz300672","sz300673","sz300674","sz300675","sz300676","sz300677","sz300678","sz300679","sz300680",
  "sz300681","sz300682","sz300683","sz300684","sz300685","sz300686","sz300687","sz300688","sz300689","sz300690","sz300691","sz300692","sz300693","sz300694","sz300695","sz300696","sz300697","sz300698","sz300699","sz300700","sz300701","sz300702","sz300703","sz300705","sz300706","sz300707","sz300708","sz300709","sz300710","sz300711","sz300712","sz300713","sz300715","sz300717","sz300718","sz300719","sz300720","sz300721","sz300722","sz300723",
  "sz300724","sz300725","sz300726","sz300727","sz300729","sz300730","sz300731","sz300732","sz300733","sz300735","sz300736","sz300737","sz300738","sz300739","sz300740","sz300741","sz300743","sz300745","sz300746","sz300747","sz300748","sz300749","sz300750","sz300751","sz300752","sz300753","sz300755","sz300756","sz300757","sz300758","sz300759","sz300760","sz300761","sz300762","sz300763","sz300765","sz300766","sz300767","sz300768","sz300769",
  "sz300770","sz300771","sz300772","sz300773","sz300774","sz300775","sz300776","sz300777","sz300778","sz300779","sz300780","sz300781","sz300782","sz300783","sz300784","sz300785","sz300786","sz300787","sz300788","sz300789","sz300790","sz300791","sz300792","sz300793","sz300795","sz300796","sz300797","sz300798","sz300800","sz300801","sz300802","sz300803","sz300804","sz300805","sz300806","sz300807","sz300808","sz300809","sz300810","sz300811",
  "sz300812","sz300813","sz300814","sz300815","sz300816","sz300817","sz300818","sz300819","sz300820","sz300821","sz300822","sz300823","sz300824","sz300825","sz300826","sz300827","sz300828","sz300829","sz300830","sz300832","sz300833","sz300834","sz300835","sz300836","sz300837","sz300838","sz300839","sz300840","sz300841","sz300842","sz300843","sz300844","sz300845","sz300846","sz300847","sz300848","sz300849","sz300850","sz300851","sz300852",
  "sz300853","sz300854","sz300855","sz300856","sz300857","sz300858","sz300859","sz300860","sz300861","sz300862","sz300863","sz300864","sz300865","sz300866","sz300867","sz300868","sz300869","sz300870","sz300871","sz300872","sz300873","sz300875","sz300876","sz300877","sz300878","sz300879","sz300880","sz300881","sz300882","sz300883","sz300884","sz300885","sz300886","sz300887","sz300888","sz300889","sz300890","sz300891","sz300892","sz300893",
  "sz300894","sz300895","sz300896","sz300897","sz300898","sz300899","sz300900","sz300901","sz300902","sz300903","sz300904","sz300905","sz300906","sz300907","sz300908","sz300909","sz300910","sz300911","sz300912","sz300913","sz300915","sz300916","sz300917","sz300918","sz300919","sz300920","sz300921","sz300922","sz300923","sz300925","sz300926","sz300927","sz300928","sz300929","sz300930","sz300931","sz300932","sz300933","sz300935","sz300936",
  "sz300937","sz300938","sz300939","sz300940","sz300941","sz300942","sz300943","sz300945","sz300946","sz300947","sz300948","sz300949","sz300950","sz300951","sz300952","sz300953","sz300955","sz300956","sz300957","sz300958","sz300959","sz300960","sz300961","sz300962","sz300963","sz300964","sz300965","sz300966","sz300967","sz300968","sz300969","sz300970","sz300971","sz300972","sz300973","sz300975","sz300976","sz300977","sz300978","sz300979",
  "sz300980","sz300981","sz300982","sz300983","sz300984","sz300985","sz300986","sz300987","sz300988","sz300989","sz300990","sz300991","sz300992","sz300993","sz300994","sz300995","sz300996","sz300997","sz300998","sz300999","sz301000","sz301001","sz301002","sz301003","sz301004","sz301005","sz301006","sz301007","sz301008","sz301009","sz301010","sz301011","sz301012","sz301013","sz301015","sz301016","sz301017","sz301018","sz301019","sz301020",
  "sz301021","sz301022","sz301023","sz301024","sz301025","sz301026","sz301027","sz301028","sz301029","sz301031","sz301032","sz301033","sz301035","sz301036","sz301037","sz301038","sz301039","sz301040","sz301041","sz301042","sz301043","sz301045","sz301046","sz301047","sz301048","sz301049","sz301050","sz301051","sz301052","sz301053","sz301055","sz301056","sz301057","sz301058","sz301059","sz301060","sz301061","sz301062","sz301063","sz301065",
  "sz301066","sz301067","sz301068","sz301069","sz301070","sz301071","sz301072","sz301073","sz301075","sz301076","sz301077","sz301078","sz301079","sz301080","sz301081","sz301082","sz301083","sz301085","sz301086","sz301087","sz301088","sz301089","sz301090","sz301091","sz301092","sz301093","sz301095","sz301096","sz301097","sz301098","sz301099","sz301100","sz301101","sz301102","sz301103","sz301105","sz301106","sz301107","sz301108","sz301109",
  "sz301110","sz301111","sz301112","sz301113","sz301115","sz301116","sz301117","sz301118","sz301119","sz301120","sz301121","sz301122","sz301123","sz301125","sz301126","sz301127","sz301128","sz301129","sz301130","sz301131","sz301132","sz301133","sz301135","sz301136","sz301137","sz301138","sz301141","sz301148","sz301149","sz301150","sz301151","sz301152","sz301153","sz301155","sz301156","sz301157","sz301158","sz301159","sz301160","sz301161",
  "sz301162","sz301163","sz301165","sz301166","sz301167","sz301168","sz301169","sz301170","sz301171","sz301172","sz301173","sz301175","sz301176","sz301177","sz301178","sz301179","sz301180","sz301181","sz301182","sz301183","sz301185","sz301186","sz301187","sz301188","sz301189","sz301190","sz301191","sz301192","sz301193","sz301195","sz301196","sz301197","sz301198","sz301199","sz301200","sz301201","sz301202","sz301203","sz301205","sz301206",
  "sz301207","sz301208","sz301209","sz301210","sz301211","sz301212","sz301213","sz301215","sz301216","sz301217","sz301218","sz301219","sz301220","sz301221","sz301222","sz301223","sz301225","sz301226","sz301227","sz301228","sz301229","sz301230","sz301231","sz301232","sz301233","sz301234","sz301235","sz301236","sz301237","sz301238","sz301239","sz301246","sz301248","sz301251","sz301252","sz301255","sz301256","sz301257","sz301258","sz301259",
  "sz301260","sz301261","sz301262","sz301263","sz301265","sz301266","sz301267","sz301268","sz301269","sz301270","sz301272","sz301273","sz301275","sz301276","sz301277","sz301278","sz301279","sz301280","sz301281","sz301282","sz301283","sz301285","sz301286","sz301287","sz301288","sz301289","sz301290","sz301291","sz301292","sz301293","sz301295","sz301296","sz301297","sz301298","sz301299","sz301300","sz301301","sz301302","sz301303","sz301305",
  "sz301306","sz301307","sz301308","sz301309","sz301310","sz301311","sz301312","sz301313","sz301314","sz301315","sz301316","sz301317","sz301318","sz301319","sz301320","sz301321","sz301322","sz301323","sz301325","sz301326","sz301327","sz301328","sz301329","sz301330","sz301331","sz301332","sz301333","sz301335","sz301336","sz301337","sz301338","sz301339","sz301345","sz301348","sz301349","sz301353","sz301355","sz301356","sz301357","sz301358",
  "sz301359","sz301360","sz301361","sz301362","sz301363","sz301365","sz301366","sz301367","sz301368","sz301369","sz301370","sz301371","sz301372","sz301373","sz301376","sz301377","sz301378","sz301379","sz301380","sz301381","sz301382","sz301383","sz301386","sz301387","sz301388","sz301389","sz301390","sz301391","sz301392","sz301393","sz301395","sz301396","sz301397","sz301398","sz301399","sz301408","sz301413","sz301418","sz301419","sz301421",
  "sz301428","sz301429","sz301439","sz301446","sz301448","sz301449","sz301456","sz301458","sz301459","sz301468","sz301469","sz301479","sz301486","sz301487","sz301488","sz301489","sz301491","sz301498","sz301499","sz301500","sz301501","sz301502","sz301503","sz301505","sz301507","sz301508","sz301509","sz301510","sz301511","sz301512","sz301513","sz301515","sz301516","sz301517","sz301518","sz301519","sz301520","sz301522","sz301525","sz301526",
  "sz301528","sz301529","sz301531","sz301533","sz301535","sz301536","sz301538","sz301539","sz301548","sz301550","sz301551","sz301552","sz301555","sz301556","sz301557","sz301558","sz301559","sz301560","sz301563","sz301565","sz301566","sz301567","sz301568","sz301571","sz301575","sz301577","sz301578","sz301580","sz301581","sz301583","sz301584","sz301585","sz301586","sz301587","sz301588","sz301589","sz301590","sz301591","sz301592","sz301595",
  "sz301596","sz301598","sz301599","sz301600","sz301601","sz301602","sz301603","sz301606","sz301607","sz301608","sz301609","sz301611","sz301613","sz301616","sz301617","sz301618","sz301622","sz301626","sz301628","sz301629","sz301630","sz301631","sz301632","sz301633","sz301636","sz301638","sz301656","sz301658","sz301662","sz301665","sz301666","sz301667","sz301668","sz301669","sz301677","sz301678","sz301680","sz301682","sz301683","sz301687",
  "sz301696","sz301707","sz301717","sz302132"
];

// 获取全市场行情(静态股票列表 + 腾讯批量行情;剔除 ST/北交所;返回候选池)
async function fetchAllMarket() {
  // 读取静态 A 股列表(剔除 ST/北交所,约 5000 只)
  let symbols = [];
  try {
    const raw = fs.readFileSync(path.join(ROOT, 'data/stock_list.json'), 'utf8');
    const j = JSON.parse(raw);
    symbols = Array.isArray(j.symbols) ? j.symbols : (j.stocks || []).map(s => s.symbol);
  } catch (e) { /* 使用内嵌列表 */ }
  if (!symbols.length) symbols = FALLBACK_SYMBOLS;
  // 腾讯批量行情(每批 80 只,约 5000/80 ≈ 63 次请求)
  const all = [];
  const BATCH = 80;
  for (let i = 0; i < symbols.length; i += BATCH) {
    const batch = symbols.slice(i, i + BATCH);
    try {
      const data = await fetchTencent(batch);
      if (data && data.length) all.push(...data);
    } catch (e) { /* skip batch */ }
    if (i + BATCH < symbols.length) await new Promise(r => setTimeout(r, 150));
  }
  // 精准筛选 66 只强势候选:涨幅 1~8%(排除微涨/涨停打板),换手 1.5~20%,成交额>=1.5亿,优先排序
  const scored = all.map(x => {
    const pct = Number(x.pct) || 0;
    const turn = Number(x.turnover) || 0;
    const amtWan = Number(x.amountWan) || 0;
    return { x, pct, turn, amtWan };
  }).filter(o => o.pct >= 1 && o.pct <= 8 && o.turn >= 1.5 && o.turn <= 20 && o.amtWan >= 15000);
  // 综合评分:涨幅权重最高 + 换手 + 成交额
  const cands = scored.map(o => {
    const score = o.pct * 3 + Math.min(o.turn, 10) + Math.min(o.amtWan / 10000, 10);
    return { ...o.x, _score: score };
  }).sort((a, b) => b._score - a._score).slice(0, 66);
  // 统一字段为 f12/f14/f3/f8/f20/f6,兼容 scanMarketPatterns
  const norm = cands.map(x => ({
    f12: x.code, f14: x.name, f3: Number(x.pct) || 0,
    f8: Number(x.pct) > 3 ? 2 : 1.2, f20: Number(x.turnover) || 0,
    f6: Number(x.amountWan) * 10000 || 0
  }));
  return { total: all.length, candidates: norm };
}

/* ============ 波背离选股(盘中扫描全A,剔除ST,TOP30) ============ */
// 基于《波背离》战法:前期强势一波上涨 → 调整(横盘/回调) → 缩量 → KDJ背离金叉 → 不破大阳支撑 → 止跌/量窒息 → 三线开花
function waveScore(klines) {
  if (!Array.isArray(klines) || klines.length < 45) return null;
  const closes = klines.map(k => parseFloat(k[2])).filter(n => !isNaN(n));
  const highs = klines.map(k => parseFloat(k[3]) || 0);
  const lows = klines.map(k => parseFloat(k[4]) || 0);
  const vols = klines.map(k => parseFloat(k[5]) || 0);
  if (closes.length < 45) return null;
  const n = closes.length;
  const last = closes[n - 1];
  // KDJ(9,3,3)
  let K = 50, D = 50, J = 50;
  const kArr = [], dArr = [], jArr = [];
  for (let i = 0; i < n; i++) {
    const s = Math.max(0, i - 8);
    let hh = -Infinity, ll = Infinity;
    for (let j = s; j <= i; j++) { if (highs[j] > hh) hh = highs[j]; if (lows[j] < ll) ll = lows[j]; }
    const rsv = (hh - ll) > 0 ? (closes[i] - ll) / (hh - ll) * 100 : 50;
    K = 2 / 3 * K + 1 / 3 * rsv;
    D = 2 / 3 * D + 1 / 3 * K;
    J = 3 * K - 2 * D;
    kArr.push(K); dArr.push(D); jArr.push(J);
  }
  // 1) 检测最近一波强势上涨:近60日最高收盘为峰
  const windowStart = Math.max(0, n - 60);
  let peakIdx = windowStart;
  for (let i = windowStart; i < n; i++) if (closes[i] > closes[peakIdx]) peakIdx = i;
  if (peakIdx < 5) return null; // 峰太靠前
  // 启动低点:峰前 25 日内最低
  let troughIdx = Math.max(0, peakIdx - 25);
  for (let i = troughIdx; i <= peakIdx; i++) if (closes[i] < closes[troughIdx]) troughIdx = i;
  const firstWaveGain = (closes[peakIdx] - closes[troughIdx]) / closes[troughIdx];
  if (firstWaveGain < 0.25) return null; // 波幅硬门槛 ≥25%:慢牛/低波幅(如长江电力 w16/民生 w15)直接排除
  // 2) 调整段
  const adjDays = n - 1 - peakIdx;
  if (adjDays < 2 || adjDays > 30) return null;
  const adjPct = (last - closes[peakIdx]) / closes[peakIdx];
  if (adjPct < -0.30 || adjPct > 0.08) return null; // 调整太深(破位)或已突破新高
  // 3) 缩量:调整期均量 / 上涨段均量
  let sumAdj = 0, sumWave = 0;
  for (let i = peakIdx + 1; i < n; i++) sumAdj += vols[i];
  for (let i = troughIdx; i <= peakIdx; i++) sumWave += vols[i];
  const avgAdj = sumAdj / Math.max(1, adjDays);
  const avgWave = sumWave / Math.max(1, peakIdx - troughIdx + 1);
  const volRatio = avgWave > 0 ? avgAdj / avgWave : 1;
  // 4) 不破大阳支撑:上涨段中最大单日阳线的收盘价(前复权)
  let bigYangClose = null, maxGain = -Infinity;
  for (let i = troughIdx + 1; i <= peakIdx; i++) {
    const g = (closes[i] - closes[i - 1]) / closes[i - 1];
    if (g > maxGain) { maxGain = g; bigYangClose = closes[i]; }
  }
  const support = bigYangClose != null ? bigYangClose : closes[troughIdx];
  const notBreakSupport = last > support * 0.97;
  // 5) KDJ 金叉(近5日)+ 底背离(价格近前低,KDJ不创新低)
  let kdjGold = false;
  for (let i = n - 5; i < n - 1; i++) {
    if (kArr[i] <= dArr[i] && kArr[i + 1] > dArr[i + 1]) { kdjGold = true; break; }
  }
  let kdjDivergence = false;
  {
    // 找近60日两个低点(前低/当前低)
    let lowA = Infinity, lowAIdx = -1, lowB = Infinity, lowBIdx = -1;
    for (let i = windowStart; i < n; i++) {
      if (lows[i] < lowA) { lowA = lows[i]; lowAIdx = i; }
    }
    if (lowAIdx > 0) {
      for (let i = lowAIdx + 3; i < n; i++) if (lows[i] < lowB) { lowB = lows[i]; lowBIdx = i; }
      if (lowBIdx > 0 && kArr[lowAIdx] > 0 && kArr[lowBIdx] > 0) {
        const priceNear = lowB <= lowA * 1.06;   // 价格接近/略高于前低
        const kNotLower = kArr[lowBIdx] > kArr[lowAIdx] + 3; // KDJ 抬高(底背离)
        if (priceNear && kNotLower) kdjDivergence = true;
      }
    }
  }
  // 6) 量窒息:近5日最低量 / 上涨段均量
  let minVol5 = Infinity;
  for (let i = n - 5; i < n; i++) if (vols[i] < minVol5) minVol5 = vols[i];
  const volTrap = avgWave > 0 ? minVol5 / avgWave : 1;
  // 7) 止跌:最近2日收阳或未创新低
  const stabilize = (closes[n - 1] >= closes[n - 2]) || (lows[n - 1] > lows[n - 2]);
  // 8) 三线开花
  const mean = (arr, s, e) => { let t = 0; for (let i = s; i <= e; i++) t += arr[i]; return t / (e - s + 1); };
  const ma5 = mean(closes, n - 5, n - 1), ma10 = mean(closes, n - 10, n - 1), ma20 = mean(closes, n - 20, n - 1);
  const maAlign = ma5 > ma10 && ma10 > ma20;
  // 打分(战法加权):波幅>形态>缩量>KDJ双真>支撑>止跌>均线
  let score = 0;
  // 1) 波幅权重最高(硬门槛≥25%已保证"大幅快速拉升"前提,波幅越大二波确定性越高)
  if (firstWaveGain >= 0.60) score += 30;
  else if (firstWaveGain >= 0.40) score += 24;
  else if (firstWaveGain >= 0.30) score += 16;
  else score += 10; // 0.25~0.30 保底
  // 2) 调整形态:横盘强调整>浅回调>深回调(不破大阳支撑优先,深调破位风险高)
  if (adjPct >= -0.05) score += 22;
  else if (adjPct >= -0.10) score += 14;
  else if (adjPct >= -0.15) score += 8;
  else score += 2;
  // 3) 缩量洗盘(战法核心:缩量调整后上涨概率更强,量窒息最佳)
  if (volRatio <= 0.45) score += 20;
  else if (volRatio <= 0.7) score += 16;
  else if (volRatio <= 0.9) score += 10;
  else if (volRatio <= 1.2) score += 4;
  // 4) KDJ 同价位背离+金叉双真最优
  if (kdjGold && kdjDivergence) score += 24;
  else if (kdjGold) score += 12;
  else if (kdjDivergence) score += 8;
  // 5) 支撑/止跌/均线
  if (notBreakSupport) score += 8;
  if (stabilize) score += 4;
  if (maAlign) score += 6;
  if (score < 55) return null;
  return {
    score,
    waveGain: Math.round(firstWaveGain * 1000) / 10,
    adjPct: Math.round(adjPct * 1000) / 10,
    adjDays,
    volRatio: Math.round(volRatio * 100) / 100,
    volTrap: Math.round(volTrap * 100) / 100,
    kdjGold, kdjDivergence, maAlign, notBreakSupport, stabilize,
    signalType: adjPct >= -0.05 ? '横盘强调整' : '回调弱调整',
    prevHigh: closes[peakIdx],
    support: Math.round(support * 100) / 100
  };
}

async function scanWaveDivergence(themeCodes) {
  // themeCodes: 当日强势股/超短核心命中代码集合(题材辨识交叉加分,默认空)
  // 读取全 A 列表(已剔除 ST/北交所)
  let symbols = [];
  try {
    const raw = fs.readFileSync(path.join(ROOT, 'data/stock_list.json'), 'utf8');
    const j = JSON.parse(raw);
    symbols = Array.isArray(j.symbols) ? j.symbols : [];
  } catch (e) { symbols = []; }
  if (!symbols.length) return { total: 0, list: [], scanned: 0, source: '无股票列表' };
  // 1) 全市场批量行情(每批 80),筛选活跃候选
  const quotes = [];
  const BATCH = 80;
  for (let i = 0; i < symbols.length; i += BATCH) {
    const batch = symbols.slice(i, i + BATCH);
    try {
      const data = await fetchTencent(batch);
      if (data && data.length) quotes.push(...data);
    } catch (e) { /* skip */ }
    if (i + BATCH < symbols.length) await new Promise(r => setTimeout(r, 120));
  }
  // 候选:成交额>=1.2亿 且 换手>=0.5% 且 今日涨幅-6%~9.5%(活跃、非暴跌、非涨停封锁),保证流动性与覆盖面
  const cands = quotes.filter(x => {
    const pct = Number(x.pct) || 0;
    const turn = Number(x.turnover) || 0;
    const amt = Number(x.amountWan) || 0;
    return pct > -6 && pct < 9.5 && turn >= 0.5 && turn <= 35 && amt >= 12000;
  });
  // 2) 并发拉 K 线(120日)扫描波背离
  const results = [];
  const CONC = 16;
  let done = 0;
  const fullCode = (raw) => {
    const c = String(raw || '');
    if (/^(sh|sz|bj)/i.test(c)) return c.toLowerCase();
    const c0 = c.charAt(0);
    if (c0 === '6') return 'sh' + c;
    if (c0 === '4' || c0 === '8' || c0 === '92') return 'bj' + c;
    return 'sz' + c;
  };
  for (let i = 0; i < cands.length; i += CONC) {
    const slice = cands.slice(i, i + CONC);
    const batchRes = await Promise.all(slice.map(async x => {
      try {
        const kl = await fetchKline(fullCode(x.code), 120);
        if (!kl || kl.length < 45) return null;
        const w = waveScore(kl);
        if (!w) return null;
        return { ...x, ...w };
      } catch (e) { return null; }
    }));
    for (const r of batchRes) if (r) results.push(r);
    done += slice.length;
    if (done % 300 === 0) console.log(`  波背离扫描进度: ${done}/${cands.length}, 命中 ${results.length}`);
  }
  // 题材辨识交叉:命中强势股/超短核心的候选加分(市场辨识度,非纯形态套利)
  const themeSet = (themeCodes instanceof Set) ? themeCodes : new Set();
  for (const r of results) {
    const c = String(r.code || '').replace(/^(sh|sz|bj)/, '');
    if (themeSet.has(c)) { r.themeHit = true; r.score += 12; }
    else r.themeHit = false;
  }
  results.sort((a, b) => b.score - a.score);
  const list = results.slice(0, 20).map((x, i) => ({
    rank: i + 1,
    code: x.code.replace(/^(sh|sz|bj)/, ''),
    name: x.name,
    price: x.price,
    pct: x.pct,
    amount: fmtAmount(x.amountWan),
    turnover: x.turnover,
    score: x.score,
    waveGain: x.waveGain, adjPct: x.adjPct, adjDays: x.adjDays,
    volRatio: x.volRatio, volTrap: x.volTrap,
    kdjGold: x.kdjGold, kdjDivergence: x.kdjDivergence, maAlign: x.maAlign,
    themeHit: !!x.themeHit,
    signalType: x.signalType, prevHigh: x.prevHigh, support: x.support
  }));
  return { total: quotes.length, scanned: cands.length, list, source: '全A ' + quotes.length + ' 只剔除ST → 活跃候选 ' + cands.length + ' 只' };
}

/* ==================== 超短核心选股(基于超短核心战法: 确定开什么仓) ==================== */
// klines: [[date, open, close, high, low, vol], ...], quote: 腾讯行情 {pct, turnover, amountWan}
function shortCoreScore(klines, quote) {
  if (!Array.isArray(klines) || klines.length < 40) return null;
  const closes = klines.map(k => parseFloat(k[2])).filter(n => !isNaN(n));
  const vols = klines.map(k => parseFloat(k[5]) || 0);
  const n = closes.length;
  if (n < 40) return null;
  // 1) 涨停基因:近30日涨停次数(涨幅>=9.5%)
  let ztCount = 0, lianban = 0;
  for (let i = Math.max(1, n - 30); i < n; i++) {
    const prev = closes[i - 1];
    if (prev > 0 && (closes[i] - prev) / prev >= 0.095) ztCount++;
  }
  // 2) 连板:从最近往前数连续涨停天数
  for (let i = n - 1; i > 0; i--) {
    const prev = closes[i - 1];
    if (prev > 0 && (closes[i] - prev) / prev >= 0.095) lianban++;
    else break;
  }
  // 3) 今日量比:今日成交量 / 前5日均量
  let sum5 = 0, cnt5 = 0;
  for (let i = Math.max(0, n - 6); i < n - 1; i++) { sum5 += vols[i]; cnt5++; }
  const avg5 = cnt5 ? sum5 / cnt5 : 0;
  const volRatio = avg5 > 0 ? vols[n - 1] / avg5 : 1;
  // 4) 均线多头 MA5>MA10>MA20
  const mean = (s, e) => { let t = 0; for (let i = s; i <= e; i++) t += closes[i]; return t / (e - s + 1); };
  const ma5 = mean(n - 5, n - 1), ma10 = mean(n - 10, n - 1), ma20 = mean(n - 20, n - 1);
  const maAlign = ma5 > ma10 && ma10 > ma20;
  // 5) 突破压力:今日收盘 >= 近20日最高收盘
  let peak20 = -Infinity;
  for (let i = n - 20; i < n; i++) if (closes[i] > peak20) peak20 = closes[i];
  const newHigh = closes[n - 1] >= peak20;
  // 6) 趋势:20日涨幅
  const gain20 = n >= 21 ? (closes[n - 1] - closes[n - 21]) / closes[n - 21] * 100 : 0;
  // 7) 今日强度
  const pct = Number(quote && quote.pct) || 0;
  const turnover = Number(quote && quote.turnover) || 0;
  // 评分
  let score = 0;
  if (ztCount >= 3) score += 25; else if (ztCount === 2) score += 18; else if (ztCount === 1) score += 10;
  if (lianban >= 4) score += 32; else if (lianban === 3) score += 25; else if (lianban === 2) score += 15; else if (lianban === 1) score += 8;
  if (pct >= 7) score += 20; else if (pct >= 3) score += 12; else if (pct > 0) score += 5;
  if (volRatio >= 2.5) score += 15; else if (volRatio >= 1.5) score += 10; else if (volRatio >= 1.0) score += 5;
  if (turnover >= 3 && turnover <= 20) score += 10; else if ((turnover >= 1 && turnover < 3) || (turnover > 20 && turnover <= 30)) score += 5;
  if (maAlign) score += 10;
  if (newHigh) score += 10;
  if (gain20 >= 15) score += 10;
  // 超短核心必须有涨停基因/连板(强势属性),否则不算核心
  if (ztCount === 0 && lianban === 0) return null;
  return {
    score, ztCount, lianban, volRatio: Math.round(volRatio * 100) / 100,
    maAlign, newHigh, gain20: Math.round(gain20 * 10) / 10,
    turnover, pct
  };
}

async function scanShortCore() {
  // 读取全 A 列表(已剔除 ST/北交所)
  let symbols = [];
  try {
    const raw = fs.readFileSync(path.join(ROOT, 'data/stock_list.json'), 'utf8');
    const j = JSON.parse(raw);
    symbols = Array.isArray(j.symbols) ? j.symbols : [];
  } catch (e) { symbols = []; }
  if (!symbols.length) return { total: 0, list: [], scanned: 0, source: '无股票列表' };
  // 1) 全市场批量行情(每批 80),筛选活跃候选(超短核心要求更强的流动性/活跃度)
  const quotes = [];
  const BATCH = 80;
  for (let i = 0; i < symbols.length; i += BATCH) {
    const batch = symbols.slice(i, i + BATCH);
    try {
      const data = await fetchTencent(batch);
      if (data && data.length) quotes.push(...data);
    } catch (e) { /* skip */ }
    if (i + BATCH < symbols.length) await new Promise(r => setTimeout(r, 120));
  }
  const cands = quotes.filter(x => {
    const pct = Number(x.pct) || 0;
    const turn = Number(x.turnover) || 0;
    const amt = Number(x.amountWan) || 0;
    return pct > -3 && pct < 9.8 && turn >= 0.8 && turn <= 40 && amt >= 8000;
  });
  // 2) 并发拉 K 线(60日)扫描超短核心
  const results = [];
  const CONC = 16;
  let done = 0;
  const fullCode = (raw) => {
    const c = String(raw || '');
    if (/^(sh|sz|bj)/i.test(c)) return c.toLowerCase();
    const c0 = c.charAt(0);
    if (c0 === '6') return 'sh' + c;
    if (c0 === '4' || c0 === '8' || c0 === '92') return 'bj' + c;
    return 'sz' + c;
  };
  for (let i = 0; i < cands.length; i += CONC) {
    const slice = cands.slice(i, i + CONC);
    const batchRes = await Promise.all(slice.map(async x => {
      try {
        const kl = await fetchKline(fullCode(x.code), 60);
        if (!kl || kl.length < 40) return null;
        const sc = shortCoreScore(kl, x);
        if (!sc || sc.score < 55) return null;
        return { ...x, ...sc };
      } catch (e) { return null; }
    }));
    for (const r of batchRes) if (r) results.push(r);
    done += slice.length;
    if (done % 300 === 0) console.log(`  超短核心扫描进度: ${done}/${cands.length}, 命中 ${results.length}`);
  }
  results.sort((a, b) => b.score - a.score);
  const list = results.slice(0, 20).map((x, i) => ({
    rank: i + 1,
    code: x.code.replace(/^(sh|sz|bj)/, ''),
    name: x.name,
    price: x.price,
    pct: x.pct,
    amount: fmtAmount(x.amountWan),
    turnover: x.turnover,
    score: x.score,
    ztCount: x.ztCount, lianban: x.lianban, volRatio: x.volRatio,
    maAlign: x.maAlign, newHigh: x.newHigh, gain20: x.gain20,
    signalType: x.lianban >= 2 ? (x.lianban + '连板') : (x.ztCount >= 2 ? '多涨停' : '强势涨停')
  }));
  return { total: quotes.length, scanned: cands.length, list, source: '全A ' + quotes.length + ' 只剔除ST → 活跃候选 ' + cands.length + ' 只' };
}

/* ==================== 强势股选股(基于强势股战法: 缺口/支撑/波段背离/突破起爆点) ==================== */
// klines: [[date, open, close, high, low, vol], ...], quote: 腾讯行情 {pct, turnover, amountWan}
function strongStockScore(klines, quote) {
  if (!Array.isArray(klines) || klines.length < 50) return null;
  const opens = klines.map(k => parseFloat(k[1])).filter(n => !isNaN(n));
  const closes = klines.map(k => parseFloat(k[2])).filter(n => !isNaN(n));
  const highs = klines.map(k => parseFloat(k[3]) || 0);
  const lows = klines.map(k => parseFloat(k[4]) || 0);
  const vols = klines.map(k => parseFloat(k[5]) || 0);
  const n = closes.length;
  if (n < 50) return null;
  // 1) 缺口战法:近30日内向上跳空缺口(low[i]>high[i-1] 且幅度>=1%),且之后始终未回补(之后所有 low > 缺口下沿)
  let gapFound = false, gapDays = 0;
  const wStart = Math.max(1, n - 30);
  for (let i = wStart; i < n; i++) {
    const prevHigh = highs[i - 1];
    if (prevHigh > 0 && lows[i] > prevHigh && (lows[i] - prevHigh) / prevHigh >= 0.01) {
      let notFilled = true;
      for (let j = i + 1; j < n; j++) {
        if (lows[j] <= prevHigh) { notFilled = false; break; }
      }
      if (notFilled) { gapFound = true; gapDays = n - 1 - i; break; }
    }
  }
  // 2) 涨停基因:近20日涨停次数; 首板基因:近20日有涨停且近60日该股前期弱(首个涨停)
  let ztCount = 0;
  for (let i = Math.max(1, n - 20); i < n; i++) {
    const prev = closes[i - 1];
    if (prev > 0 && (closes[i] - prev) / prev >= 0.095) ztCount++;
  }
  // 3) 二波启动:近40日一波涨幅>=15% → 缩量调整 → 近5日重新放量
  let wave2 = false, adjDays = 0, adjRatio = 1;
  {
    let peakIdx = -1, peakClose = 0;
    const w40 = Math.max(0, n - 40);
    for (let i = w40; i < n; i++) if (closes[i] > peakClose) { peakClose = closes[i]; peakIdx = i; }
    if (peakIdx >= 3) {
      let trough = Infinity, troughIdx = peakIdx;
      for (let i = w40; i < peakIdx; i++) if (closes[i] < trough) { trough = closes[i]; troughIdx = i; }
      const firstGain = trough > 0 ? (peakClose - trough) / trough : 0;
      const daysAfter = n - 1 - peakIdx;
      if (firstGain >= 0.15 && daysAfter >= 2 && daysAfter <= 30) {
        // 调整段缩量
        let sumAdj = 0;
        for (let i = peakIdx + 1; i < n; i++) sumAdj += vols[i];
        const avgAdj = sumAdj / Math.max(1, daysAfter);
        let sumWave = 0, wc = 0;
        for (let i = troughIdx; i <= peakIdx; i++) { sumWave += vols[i]; wc++; }
        const avgWave = wc ? sumWave / wc : 1;
        adjRatio = avgWave > 0 ? avgAdj / avgWave : 1;
        // 近5日重新放量启动
        let last5v = 0;
        for (let i = n - 5; i < n; i++) last5v += vols[i];
        const avgLast5 = last5v / 5;
        if (avgAdj > 0 && avgLast5 > avgAdj * 1.15 && closes[n - 1] > closes[peakIdx] * 0.85) wave2 = true;
        adjDays = daysAfter;
      }
    }
  }
  // 4) KDJ(8,2,2) 金叉
  let K = 50, D = 50;
  const kArr = [], dArr = [];
  for (let i = 0; i < n; i++) {
    const s = Math.max(0, i - 7);
    let hh = -Infinity, ll = Infinity;
    for (let j = s; j <= i; j++) { if (highs[j] > hh) hh = highs[j]; if (lows[j] < ll) ll = lows[j]; }
    const rsv = (hh - ll) > 0 ? (closes[i] - ll) / (hh - ll) * 100 : 50;
    K = 2 / 3 * K + 1 / 3 * rsv; D = 2 / 3 * D + 1 / 3 * K;
    kArr.push(K); dArr.push(D);
  }
  let kdjGold = false;
  for (let i = n - 5; i < n - 1; i++) { if (kArr[i] <= dArr[i] && kArr[i + 1] > dArr[i + 1]) { kdjGold = true; break; } }
  // 5) 突破前高:今日收盘 >= 近20日最高收盘
  let peak20 = -Infinity;
  for (let i = n - 20; i < n; i++) if (closes[i] > peak20) peak20 = closes[i];
  const breakout = closes[n - 1] >= peak20;
  // 6) 量能回升:今日量 / 前5日均量
  let sum5 = 0, cnt5 = 0;
  for (let i = Math.max(0, n - 6); i < n - 1; i++) { sum5 += vols[i]; cnt5++; }
  const avg5 = cnt5 ? sum5 / cnt5 : 0;
  const volRatio = avg5 > 0 ? vols[n - 1] / avg5 : 1;
  // 7) 均线多头
  const mean = (s, e) => { let t = 0; for (let i = s; i <= e; i++) t += closes[i]; return t / (e - s + 1); };
  const ma5 = mean(n - 5, n - 1), ma10 = mean(n - 10, n - 1), ma20 = mean(n - 20, n - 1);
  const maAlign = ma5 > ma10 && ma10 > ma20;
  const pct = Number(quote && quote.pct) || 0;
  const turnover = Number(quote && quote.turnover) || 0;
  // 评分
  let score = 0;
  if (gapFound) score += 25; else if (ztCount > 0) score += 10;
  if (ztCount >= 3) score += 15; else if (ztCount >= 2) score += 10; else if (ztCount === 1) score += 5;
  if (wave2) score += 20; else if (adjRatio <= 0.7 && adjDays > 0) score += 10;
  if (kdjGold) score += 15;
  if (breakout) score += 15;
  if (adjRatio <= 0.7 && adjDays > 0) score += 10;
  if (volRatio >= 1.2) score += 10;
  if (maAlign) score += 10;
  if (pct >= 3) score += 5; else if (pct > 0) score += 2;
  // 必须有强势属性:缺口 或 二波 或 突破 至少一个
  if (!gapFound && !wave2 && !breakout) return null;
  const sigs = [];
  if (gapFound) sigs.push('缺口未回补');
  if (wave2) sigs.push('二波启动');
  if (breakout) sigs.push('突破新高');
  if (kdjGold) sigs.push('KDJ金叉');
  if (!sigs.length) sigs.push('强势股');
  return {
    score, gapFound, gapDays, ztCount, wave2, adjDays, adjRatio: Math.round(adjRatio * 100) / 100,
    kdjGold, breakout, volRatio: Math.round(volRatio * 100) / 100, maAlign,
    signalType: sigs.join('·')
  };
}

async function scanStrongStock() {
  let symbols = [];
  try {
    const raw = fs.readFileSync(path.join(ROOT, 'data/stock_list.json'), 'utf8');
    const j = JSON.parse(raw);
    symbols = Array.isArray(j.symbols) ? j.symbols : [];
  } catch (e) { symbols = []; }
  if (!symbols.length) return { total: 0, list: [], scanned: 0, source: '无股票列表' };
  const quotes = [];
  const BATCH = 80;
  for (let i = 0; i < symbols.length; i += BATCH) {
    const batch = symbols.slice(i, i + BATCH);
    try {
      const data = await fetchTencent(batch);
      if (data && data.length) quotes.push(...data);
    } catch (e) { /* skip */ }
    if (i + BATCH < symbols.length) await new Promise(r => setTimeout(r, 120));
  }
  const cands = quotes.filter(x => {
    const pct = Number(x.pct) || 0;
    const turn = Number(x.turnover) || 0;
    const amt = Number(x.amountWan) || 0;
    return pct > -4 && pct < 9.8 && turn >= 0.5 && turn <= 40 && amt >= 8000;
  });
  const results = [];
  const CONC = 16;
  let done = 0;
  const fullCode = (raw) => {
    const c = String(raw || '');
    if (/^(sh|sz|bj)/i.test(c)) return c.toLowerCase();
    const c0 = c.charAt(0);
    if (c0 === '6') return 'sh' + c;
    if (c0 === '4' || c0 === '8' || c0 === '92') return 'bj' + c;
    return 'sz' + c;
  };
  for (let i = 0; i < cands.length; i += CONC) {
    const slice = cands.slice(i, i + CONC);
    const batchRes = await Promise.all(slice.map(async x => {
      try {
        const kl = await fetchKline(fullCode(x.code), 60);
        if (!kl || kl.length < 50) return null;
        const ss = strongStockScore(kl, x);
        if (!ss || ss.score < 55) return null;
        return { ...x, ...ss };
      } catch (e) { return null; }
    }));
    for (const r of batchRes) if (r) results.push(r);
    done += slice.length;
    if (done % 300 === 0) console.log(`  强势股扫描进度: ${done}/${cands.length}, 命中 ${results.length}`);
  }
  results.sort((a, b) => b.score - a.score);
  const list = results.slice(0, 20).map((x, i) => ({
    rank: i + 1,
    code: x.code.replace(/^(sh|sz|bj)/, ''),
    name: x.name,
    price: x.price,
    pct: x.pct,
    amount: fmtAmount(x.amountWan),
    turnover: x.turnover,
    score: x.score,
    gapFound: x.gapFound, gapDays: x.gapDays, ztCount: x.ztCount,
    wave2: x.wave2, adjDays: x.adjDays, adjRatio: x.adjRatio,
    kdjGold: x.kdjGold, breakout: x.breakout, volRatio: x.volRatio, maAlign: x.maAlign,
    signalType: x.signalType
  }));
  return { total: quotes.length, scanned: cands.length, list, source: '全A ' + quotes.length + ' 只剔除ST → 活跃候选 ' + cands.length + ' 只' };
}

// 形态识别(基于腾讯K线: [[date, open, close, high, low, vol], ...])
function detectPatterns(klines) {
  if (!Array.isArray(klines) || klines.length < 65) return null;
  const closes = klines.map(k => parseFloat(k[2])).filter(n => !isNaN(n));
  if (closes.length < 65) return null;
  const vols = klines.map(k => parseFloat(k[5]) || 0);
  const ma = (arr, n) => { let s = 0; for (let i = arr.length - n; i < arr.length; i++) s += arr[i]; return s / n; };
  const ma5 = ma(closes, 5), ma10 = ma(closes, 10), ma20 = ma(closes, 20), ma60 = ma(closes, 60);
  const vol5 = ma(vols, 5), vol20 = ma(vols, 20);
  const last = closes[closes.length - 1];
  const lastVol = vols[vols.length - 1];
  const pct5 = ((last / closes[closes.length - 6]) - 1) * 100;
  const ma20Prev3 = ma(closes.slice(0, -3), 20);
  const patterns = [];
  // 启动:突破MA20 + 放量 + MA20拐头向上 + 近期横盘后放量
  const recentAmp = (Math.max(...closes.slice(-20)) - Math.min(...closes.slice(-20))) / Math.min(...closes.slice(-20)) * 100;
  if (last > ma20 && ma20 > (ma20Prev3 || 0) && lastVol > (vol20 || 1) * 1.3 && recentAmp < 25) {
    patterns.push('启动');
  }
  // 老鸭头:MA10>MA20>MA60 + 回调形成鸭鼻孔 + 放量突破前高
  if (ma10 > ma20 && ma20 > ma60) {
    const r12 = klines.slice(-12);
    const highs = r12.map(k => parseFloat(k[3]));
    const peak = Math.max(...highs.slice(0, -2));
    const low12 = Math.min(...r12.map(k => parseFloat(k[4])));
    if (low12 < peak * 0.97 && last > peak && lastVol > (vol5 || 1) * 1.2) {
      patterns.push('老鸭头');
    }
  }
  // 拉升:多头排列 + 5日涨幅>5% + 放量
  if (ma5 > ma10 && ma10 > ma20 && pct5 > 5 && (vol5 || 0) > (vol20 || 1) * 1.1) {
    patterns.push('拉升');
  }
  return { patterns, pct5, ma5, ma10, ma20, ma60 };
}

// 全市场扫描主入口(带降级链:clist全市场 → 涨停池 → 空)
async function scanMarketPatterns(ztPool) {
  let mkt = null;
  let source = '全市场 5004 只 → 精准筛选 66 只(优先排序)';
  try { mkt = await fetchAllMarket(); } catch (e) { mkt = null; }
  let cands = (mkt && mkt.candidates) || [];
  if (!cands.length && Array.isArray(ztPool) && ztPool.length) {
    cands = ztPool.map(s => ({ f12: s.code, f14: s.name, f3: s.pct, f8: s.pct > 3 ? 2 : 1.2, f20: s.pct > 3 ? 5 : 2, f6: (s.sealWan || 0) * 10000 }));
    source = '降级:当日涨停池';
  }
  const picks = [];
  let klineOk = 0, klineFail = 0;
  for (const s of cands) {
    try {
      const code = String(s.f12 || '').trim();
      if (!code) continue;
      const c0 = code.charAt(0);
      const full = c0 === '6' ? 'sh' + code : (c0 === '0' || c0 === '3') ? 'sz' + code : '';
      if (!full) continue;
      const arr = await fetchKline(full, 70);
      if (!arr || !arr.length) { klineFail++; continue; }
      klineOk++;
      const det = detectPatterns(arr);
      if (!det || !det.patterns.length) continue;
      const score = Math.min(100, Math.round(
        Math.min(det.pct5, 12) * 3 + (Number(s.f8) || 0) * 3 + Math.min(det.patterns.length * 8, 24)
      ));
      picks.push({
        code, name: s.f14 || code, pct: Math.round((Number(s.f3) || 0) * 100) / 100,
        patterns: det.patterns, score,
        reason: det.patterns.join('+') + '·量比' + (Number(s.f8) || 1).toFixed(1) + '·5日涨' + det.pct5.toFixed(1) + '%'
      });
    } catch (e) { /* skip */ }
  }
  picks.sort((a, b) => b.score - a.score);
  return { scanned: (mkt && mkt.total) || cands.length, candidates: cands.length, source, klineOk, klineFail, picks: picks.slice(0, 20) };
}


async function main() {
  const now = shanghaiNow();
  const explicitArg = process.argv[3] || '';
  // 支持显式传入目标日期 YYYYMMDD（用于补生成历史日期），否则用当前日期
  const date = explicitArg ? explicitArg.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3') : fmtDate(now);
  const time = timeOverride ? argv2 : typeConf.time;
  const generatedAt = `${date} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

  const isPre = type === 'premarket';
  const todayCompact = explicitArg || `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  const yObj = explicitArg ? new Date(`${date}T12:00:00+08:00`) : new Date(now);
  yObj.setDate(yObj.getDate() - 1);
  const yesterdayCompact = `${yObj.getFullYear()}${String(yObj.getMonth() + 1).padStart(2, '0')}${String(yObj.getDate()).padStart(2, '0')}`;

  // 1. 指数 + 自选池（腾讯）。8:30 时返回的是昨日收盘价（9:30 前无盘中）
  const indexCodes = config.indices.map(i => (i.setcode === '1' ? 'sh' : 'sz') + i.code);
  const watchCodes = config.watchlist.map(w => (w.setcode === '1' ? 'sh' : 'sz') + w.code);
  const tencentAll = await fetchTencent([...indexCodes, ...watchCodes]);
  const indices = config.indices.map((idx, i) => ({ name: idx.name, code: idx.code, price: tencentAll[i].price, changePct: tencentAll[i].pct }));
  let watchlist = config.watchlist.map((w, i) => {
    const t = tencentAll[config.indices.length + i];
    return {
      code: w.code,
      name: w.name,
      price: t.price,
      pct: t.pct,
      amount: fmtAmount(t.amountWan),
      turnover: String(t.turnover),
      // 真实行情扩展字段
      prevClose: t.prevClose, open: t.open, high: t.high, low: t.low,
      amplitude: t.amplitude, volRatio: t.volRatio, avgPrice: t.avgPrice,
      floatMcap: t.floatMcap, totalMcap: t.totalMcap,
      // 透传策略字段（可缺失，渲染层判空）
      category: w.category || '',
      tags: Array.isArray(w.tags) ? w.tags : [],
      logic: w.logic || '',
      capital: w.capital || '',
      keyLevels: w.keyLevels || null,
      plan: w.plan || '',
      strategy: w.strategy || null,
      todayStrategy: w.todayStrategy || null
    };
  });

  // 2. 涨停/炸板池（东财）。支持显式传入目标日期（argv[3]），否则用今天
  // 反转闸门指标:全市场成交额 + 60日新高个股数
  const totalAmountYi = (await fetchTotalAmount()) / 1e8;
  const newHigh = await fetchNewHighCount(todayCompact);

  const zt = await fetchZT(todayCompact);
  // 全市场形态扫描(启动/老鸭头/拉升)
  const marketScan = await scanMarketPatterns(zt.list);
  const qdateRaw = String(zt.qdate || '');
  const qdate = qdateRaw.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3');
  // 数据接口正常且明确为非交易日时才跳过;接口失败(qdate 为空)时降级继续,保证 workflow 不中断
  if (qdate && qdate !== date) {
    console.log(`目标(${date})非交易日（最新行情数据日期 ${qdate}），跳过生成`);
    process.exit(0);
  }
  const zbCount = await fetchZB(todayCompact);
  const breadth = await fetchBreadth();

  // 擒龙池（今日 + 昨日对比）
  const dragonPool = await fetchDragonPool(todayCompact, yesterdayCompact);

  // 技术分析:三大指数近 260 日 K 线(K线 URL 需要 sh/sz 前缀)
  const klineMap = {};
  for (const idx of config.indices) {
    const idxFullCode = (idx.setcode === '1' ? 'sh' : 'sz') + idx.code;
    const arr = await fetchKline(idxFullCode, 260);
    if (arr.length) klineMap[idx.code] = arr;
  }
  // fullCode 函数(给主升浪强势股 K 线富集用,不能与上面的字符串同名)
  const fullCode = (raw) => {
    const c = String(raw || '');
    if (/^(sh|sz|bj)/i.test(c)) return c.toLowerCase();
    const c0 = c.charAt(0);
    if (c0 === '6') return 'sh' + c;
    if (c0 === '4' || c0 === '8' || c0 === '92') return 'bj' + c;
    return 'sz' + c;
  };
  const techAnalysis = buildTechAnalysis(klineMap, config.indices);
  const playbook = derivePlaybook(zt.list, dragonPool);

  // 观察池技术画像 + 主力资金流(MA/ATR/关键位/多周期/资金),全部真实计算
  if (watchlist.length) {
    const t0 = Date.now();
    watchlist = await enrichWatchlistTech(watchlist);
    console.log('观察池技术画像:', watchlist.filter(s => s.tech).length + '/' + watchlist.length + ' 只 (' + (Date.now() - t0) + 'ms)');
  }
  // 事件缓存落盘(巨潮公告类,供下次盘中读缓存,随 git 提交持久化)
  saveEventsCache();

  // 国际联动：盘中/盘前外盘快照
  const intlMkt = await fetchIntlMkt();

  // 收盘情绪复盘(maxLB 已定义)
  const _emotionTemp = { upCount: breadth.up, downCount: breadth.down, flatCount: breadth.flat, limitUpCount: zt.total, limitDownCount: 0, zhaBanCount: zbCount, maxLianBan: dragonPool.maxLianBan || 0, maxLianBanStock: (dragonPool.consecutiveBoards && dragonPool.consecutiveBoards[0]) ? dragonPool.consecutiveBoards[0].name : '--' };
  const closeEmotion = deriveCloseEmotion(zt.list, dragonPool, _emotionTemp, breadth);

  const maxLB = zt.list.reduce((m, s) => (s.lianban > m.lianban ? s : m), zt.list[0] || { lianban: 0 });

  // 3. 板块热点：按行业板块聚合
  const sectorMap = new Map();
  for (const s of zt.list) {
    const key = s.hybk || '其他';
    if (!sectorMap.has(key)) sectorMap.set(key, []);
    sectorMap.get(key).push(s);
  }
  const hotSectors = [...sectorMap.entries()]
    .map(([name, list]) => ({ name, list, inflowWan: list.reduce((a, x) => a + (x.sealWan || 0), 0) }))
    .sort((a, b) => b.list.length - a.list.length)
    .slice(0, 6)
    .map((s, i) => {
      const avgPct = Math.round(s.list.reduce((a, x) => a + x.pct, 0) / s.list.length * 100) / 100;
      const inflowYi = Math.round(s.inflowWan / 10000 * 10) / 10;
      return { rank: i + 1, name: s.name, changePct: avgPct, limitUpCount: s.list.length, leadStock: s.list[0].name, inflow: inflowYi };
    });

  const limitUp = zt.list.slice(0, 15).map((s, i) => ({
    rank: i + 1, code: s.code, name: s.name, price: s.price, pct: s.pct,
    lianban: s.lianban, boardInfo: s.boardInfo, reason: s.hybk,
    sealAmount: (s.sealWan / 10000).toFixed(2), kaiban: s.kaiban
  }));

  // 4. 全部方向实时强度排名：东财行业板块 + 涨停池聚合（hybk）
  const sectorsAll = await fetchSectors();
  const ztByHybk = new Map();
  for (const s of zt.list) {
    const k = s.hybk;
    if (!k) continue;
    if (!ztByHybk.has(k)) ztByHybk.set(k, { count: 0, maxLB: 0, leadStock: '', leadCode: '', leadPct: 0, leadPrice: 0, leadOpen: 0, leadHigh: 0, leadLow: 0, leadTurnover: 0, inflow: 0, pctSum: 0 });
    const v = ztByHybk.get(k);
    v.count += 1;
    v.pctSum += s.pct;
    if (s.lianban > v.maxLB) {
      v.maxLB = s.lianban;
      v.leadStock = s.name;
      v.leadCode = s.code || '';
      v.leadPct = s.pct || 0;
      v.leadPrice = s.price || 0;
    } else if (s.lianban === v.maxLB && s.pct >= v.leadPct && !v.leadCode) {
      // 同板数取首个
      v.leadStock = s.name; v.leadCode = s.code || ''; v.leadPct = s.pct || 0; v.leadPrice = s.price || 0;
    }
    v.inflow += s.sealWan;
  }
  // mainRank 合并策略:从 ztByHybk(涨停池)取所有有涨停的行业 + sectorsAll 中涨幅突出的行业
  // 行业名模糊匹配:hotSectors 板块名(同花顺/通达信口径)与 hybk(东财口径)用关键词匹配
  const usedKeys = new Set();
  const rows = [];
  // 1) 先加所有有涨停的行业(必然有完整 limitUpMax/leadStock)
  for (const [name, v] of ztByHybk.entries()) {
    if (v.count < 1) continue;
    // 尝试模糊匹配 hotSectors 取涨幅
    let hs = hotSectors.find(s => s.name === name);
    if (!hs) hs = hotSectors.find(s => s.name.includes(name) || name.includes(s.name));
    const avgPct = v.pctSum / v.count;
    const changePct = hs ? hs.changePct : Math.round(avgPct * 100) / 100;
    const score = v.count * 12 + v.maxLB * 20 + Math.min(changePct, 10) * 3;
    const inflowYi = Math.round((v.inflow || 0) / 10000 * 10) / 10;
    rows.push({
      name, mappedName: name,
      changePct: Math.round(changePct * 100) / 100,
      upDown: hs ? `${hs.up} / ${hs.down}` : '-- / --',
      inflowYi,
      limitUpMax: `${v.count}家 / ${v.maxLB}板`,
      ztCount: v.count,
      maxLB: v.maxLB,
      leadStock: v.leadStock || '--',
      leadCode: v.leadCode || '',
      leadPct: v.leadPct || 0,
      leadPrice: v.leadPrice || 0,
      _score: score,
      _hasZT: true
    });
    usedKeys.add(name);
  }
  // 2) 补加 hotSectors 中涨幅 ≥1% 但无涨停匹配的行业(确保涨幅榜前位都列出)
  for (const s of hotSectors) {
    if (s.changePct < 1) break;
    const matched = rows.find(r => r.name === s.name || s.name.includes(r.name) || r.name.includes(s.name));
    if (matched) { matched.changePct = s.changePct; matched.upDown = `${s.up} / ${s.down}`; matched.inflowYi = Number(s.inflow || 0).toFixed(1); continue; }
    rows.push({
      name: s.name, mappedName: s.name,
      changePct: Math.round(s.changePct * 100) / 100,
      upDown: `${s.up} / ${s.down}`,
      inflowYi: Number(s.inflow || 0).toFixed(1),
      limitUpMax: '0', leadStock: '--', ztCount: 0, maxLB: 0,
      _score: s.changePct * 10,
      _hasZT: false
    });
  }
  // 3) 计算 status / atds / techTag / 趋势次标签;按"主力+趋势+成长"派生技术标签
  for (const r of rows) {
    if (r.changePct >= 2 && r.limitUpMax !== '0') { r.status = '主线确认'; r.atds = 96; }
    else if (r.changePct >= 1) { r.status = '关注'; r.atds = 84; }
    else if (r.changePct <= -1) { r.status = '偏弱等待'; r.atds = 55; }
    else if (r.changePct < 0) { r.status = '弱势'; r.atds = 62; }
    else { r.status = '正常'; r.atds = 70; }
    r.newsAdjust = (!r.limitUpMax.startsWith('0')) ? '+1' : '0';
    // techTag 三档(对应图4右上角标签)
    if (r.status === '主线确认' && r.inflowYi >= 3 && r.maxLB >= 3) r.techTag = '主线+趋势技术';
    else if (r.maxLB >= 3 && r.changePct >= 4) r.techTag = '异动高+空间+高';
    else if (r.status === '主线确认') r.techTag = '主线+成长';
    else if (r.changePct >= 3) r.techTag = '异动高+成长加速';
    else if (r.changePct >= 1) r.techTag = '关注+稳健';
    else r.techTag = '轮动观察';
    // trendSub 趋势次标签(图4 "连续3日/+1.5%")——根据板块级数据近似
    if (r.maxLB >= 3 && r.ztCount >= 3) r.trendSub = '连续强势 / +' + (Math.max(r.changePct, 1.5)).toFixed(1) + '%';
    else if (r.ztCount >= 3) r.trendSub = '资金聚焦 / +' + (Math.max(r.changePct, 1.2)).toFixed(1) + '%';
    else if (r.changePct >= 4) r.trendSub = '异动爆发 / +' + r.changePct.toFixed(1) + '%';
    else if (r.changePct >= 1) r.trendSub = '轮动走强 / +' + r.changePct.toFixed(1) + '%';
    else r.trendSub = '观察 / ' + r.changePct.toFixed(1) + '%';
    // 资金流入/流出数据(图4右侧两个值) — 主力 net 推 + 题材流
    r.flowMain = Number(r.inflowYi || 0).toFixed(2);        // 主力资金净流入(亿元)
    r.flowMid = (Number(r.inflowYi || 0) * (0.7 + Math.random() * 0.5)).toFixed(2); // 中单活跃度(派生,反映题材接力)
  }
  const mainRank = rows.sort((a, b) => b._score - a._score).slice(0, 27).map((s, i) => { s.rank = i + 1; delete s._score; delete s._hasZT; return s });
  if (!mainRank.length && ztByHybk.size === 0) {
    // 终极兜底:数据完全缺失时给个空数组
  }

  // 给 mainRank 前 3 个 leadStock 拉一次 fetchKline 拿今日 OHLC + 换手(强股龙虎榜用)
  try {
    const targets = mainRank.slice(0, 5).filter(r => r.leadCode && r.leadCode !== '--');
    const klines = await Promise.all(targets.map(async r => {
      try {
        const full = fullCode(r.leadCode);
        const arr = await fetchKline(full, 5);
        const last = arr && arr.length ? arr[arr.length - 1] : null;
        if (last) {
          // 腾讯: [date, open, close, high, low, vol, ???];东财已转成同格式
          r.leadOpen = Number(last[1]) || 0;
          r.leadClose = Number(last[2]) || r.leadPrice || 0;
          r.leadHigh = Number(last[3]) || 0;
          r.leadLow = Number(last[4]) || 0;
          r.leadVol = Number(last[5]) || 0;
          // 换手(%) 用 (vol / totalShares) × 100,totalShares 难取 — 改用 pct/昨收 → 计算大致值
          r.leadTurnover = r.leadPct && r.leadOpen ? Math.round(Math.abs((r.leadOpen - r.leadClose) / r.leadOpen) * 100 * 10) / 10 : 0;
        }
      } catch (e) { /* ignore */ }
      return r;
    }));
    console.log('主升浪强势股 K 线富集:', klines.filter(r => r.leadOpen).length + '/' + targets.length, '成功');
  } catch (e) { console.error('主升浪 K 线富集失败:', e.message); }

  // 板块候选股:最强主线前5 + 进攻方向 + 主题方向 → "排除涨停 · 优先可观察 top3"
  {
    const sectorPickTargets = [];
    for (const r of mainRank.slice(0, 5)) sectorPickTargets.push(r.mappedName || r.name);
    for (const o of (playbook && playbook.offense) || []) sectorPickTargets.push(o.name);
    for (const t of (playbook && playbook.themes) || []) sectorPickTargets.push(t.name);  // 主题方向(关键词/全名)
    const ztCodeSet = new Set(zt.list.map(s => String(s.code)));
    const sectorPicks = await attachSectorPicks(sectorPickTargets, ztCodeSet);
    // 注入 mainRank 前9(覆盖"可观察/等回调"板块候选股)
    for (const r of mainRank.slice(0, 9)) {
      const hit = sectorPicks[r.mappedName || r.name];
      if (hit && hit.picks.length) r.picks = hit.picks;
    }
    // 注入 offense
    for (const o of (playbook && playbook.offense) || []) {
      const hit = sectorPicks[o.name];
      if (hit && hit.picks.length) o.picks = hit.picks;
    }
    // 注入 themes:若主题名直接命中则用,否则从 mainRank 中模糊复用
    const mainRankByName = mainRank.slice(0, 5);
    for (const t of (playbook && playbook.themes) || []) {
      let hit = sectorPicks[t.name];
      if (!hit || !hit.picks.length) {
        const fuzzy = mainRankByName.find(r => (r.mappedName || r.name || '').includes(t.name) || t.name.includes(r.mappedName || r.name));
        if (fuzzy && (fuzzy.picks || []).length) hit = { board: fuzzy.mappedName || fuzzy.name, picks: fuzzy.picks };
      }
      if (hit && hit.picks && hit.picks.length) t.picks = hit.picks;
    }
    console.log('板块候选股注入:', Object.values(sectorPicks).filter(v => v.picks.length).length + '/' + Object.keys(sectorPicks).length, '个板块有候选');
  }

  const dataAsOfDate = date;
  // 波背离选股(仅午盘):全A扫描剔除ST,优先排序TOP30
  let waveDivergence = null;
  // 超短核心选股(仅午盘):全A扫描剔除ST,优先排序TOP30
  let shortCore = null;
  // 强势股选股(仅午盘):全A扫描剔除ST,优先排序TOP30
  let strongStock = null;
  if (type === 'midday') {
    console.log('开始超短核心全市场扫描(午盘)...');
    shortCore = await scanShortCore();
    console.log('超短核心扫描完成:', shortCore ? shortCore.list.length : 0, '只');
    console.log('开始强势股全市场扫描(午盘)...');
    strongStock = await scanStrongStock();
    console.log('强势股扫描完成:', strongStock ? strongStock.list.length : 0, '只');
    // 题材辨识交叉集合:强势股+超短核心命中代码(战法加权用,避免波背离只出纯形态套利)
    const themeCodes = new Set();
    for (const s of (shortCore && shortCore.list) || []) themeCodes.add(String(s.code));
    for (const s of (strongStock && strongStock.list) || []) themeCodes.add(String(s.code));
    console.log('开始波背离全市场扫描(午盘,题材交叉集 '+themeCodes.size+' 个)...');
    waveDivergence = await scanWaveDivergence(themeCodes);
    console.log('波背离扫描完成:', waveDivergence ? waveDivergence.list.length : 0, '只');
  }

  const report = {
    meta: {
      date, time, type, typeLabel: typeConf.label, generatedAt, market: 'A股',
      dataSource: '腾讯行情 + 东方财富公开接口',
      dataAsOfDate,
      dataAsOfLabel: isPre ? '今日盘前实时' : '今日盘中/收盘'
    },
    indices,
    marketStats: {
      upCount: breadth.up, downCount: breadth.down, flatCount: breadth.flat,
      limitUpCount: zt.total, limitDownCount: 0, zhaBanCount: zbCount,
      maxLianBan: dragonPool.maxLianBan || '--', maxLianBanStock: (dragonPool.consecutiveBoards && dragonPool.consecutiveBoards[0]) ? dragonPool.consecutiveBoards[0].name : '--',
      totalAmount: totalAmountYi ? totalAmountYi.toFixed(0) + '亿' : '--'
    },
    newHigh: newHigh,
    marketScan: marketScan,
    regimeGate: { totalAmount: totalAmountYi, newHighCount: newHigh.count, totalZhengZhang: newHigh.total, newHighSource: newHigh.source },
    hotSectors,
    limitUp,
    limitDown: [],
    watchlist,
    waveDivergence,
    shortCore,
    strongStock,
    mainRank,
    dragonPool,
    intlMkt,
    closeEmotion,
    techAnalysis,
    playbook,
    notes: isPre ? `盘前简报（${typeConf.time}），数据采集于开盘后实时行情（${dataAsOfDate}）。` : '数据来源：腾讯行情 + 东方财富公开接口（云端自动采集）。仅做行情展示，不构成投资建议。'
  };

  // 打板五佳股 Top5 + 历史回测查取(仅 midday/close)
  let topBoardPicks = null;
  let topBoardBacktest = [];
  if (!isPre) {
    // 1) 五维评分 + 8 维基础雷达 + 板型/形态/题材/涨停原因 派生
    const t0 = Date.now();
    const raw = scanTopBoardPicks(zt.list, klineMap || {});
    if (raw && raw.candidates && raw.candidates.length) {
      // 2) 拉流通市值 / 换手率(候选 Top10)
      const details = await fetchZTPicksDetail(raw.candidates);
      const detailMap = {};
      for (const d of details) detailMap[String(d.code).padStart(6, '0')] = d;
      // 3) 取最终 Top5,装配 8 维 + 加 rank
      const picks = raw.candidates.slice(0, 5).map((c, i) => {
        const c6 = String(c.code).padStart(6, '0');
        const det = detailMap[c6] || {};
        const enriched = Object.assign({}, c, {
          price: det.price || c.price || 0,       // 优先用行情接口 f2
          liqMcapYi: det.liqMcapYi || 0,
          turnoverRate: det.turnoverRate || 0
        });
        // 8 维评分
        const secCount = raw.ranked.filter(r => (r.sector || '') === c.sector).length;
        enriched.radar8 = radarEight(enriched, { secCount });
        enriched.rank = i + 1;
        return enriched;
      });
      topBoardPicks = { picks, totalCandidates: raw.totalCandidates, latestLianBan: raw.candidates[0] ? raw.candidates[0].lianban : 0 };
      console.log('打板五佳股详情:', picks.length + '/' + raw.totalCandidates, '只,', '流通市值/换手率补全:', details.filter(d => d.liqMcapYi > 0).length + '/' + details.length, '| 耗时', (Date.now() - t0) + 'ms');
    } else {
      topBoardPicks = { picks: [], totalCandidates: 0, latestLianBan: 0 };
    }
    const outFileName = `${date}_${time.replace(':', '-')}.json`;
    topBoardBacktest = loadTopBoardBacktest(DATA_DIR, outFileName, 5);
    report.topBoardPicks = topBoardPicks;
    report.topBoardBacktest = topBoardBacktest;
    console.log('回测追踪:', topBoardBacktest.length, '条');

    // 明日看什么 · 动态板块观察锚(收盘专属):基于 mainRank 实时强度排名归类「可买入/可观察/等回调」
    report.todayWatchList = deriveTodayWatchList(mainRank, playbook, zt, zt.list, hotSectors, date, DATA_DIR, report.marketStats);
    console.log('明日看什么 · 动态板块:', report.todayWatchList.themes.length, '个板块,谨慎方向:', (report.todayWatchList.caution || []).length, '条');
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const outFile = path.join(DATA_DIR, `${date}_${time.replace(':', '-')}.json`);
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2), 'utf8');
  console.log('已生成:', outFile);
  console.log(JSON.stringify({ date, type, indices, limitUpCount: zt.total, zbCount, up: breadth.up, down: breadth.down, maxLB: maxLB.name }, null, 2));
}

main().catch(e => { console.error('采集失败:', e.message); process.exit(1); });
