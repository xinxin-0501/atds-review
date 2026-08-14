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

const type = process.argv[2] || 'close';
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
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const text = await res.text();
    const out = [];
    for (const line of text.trim().split(';')) {
      const m = line.trim().match(/^v_[a-z]+\d+="(.*)"$/);
      if (!m) continue;
      const f = m[1].split('~');
      out.push({
        name: f[1], code: f[2], price: parseFloat(f[3]), pct: parseFloat(f[32]),
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
  try {
    const url = 'http://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&fields=f1,f2,f3,f104,f105,f106&secids=1.000001,0.399001,0.399006';
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const j = await res.json();
    const diff = (j.data && j.data.diff) || [];
    let up = 0, down = 0, flat = 0;
    for (const it of diff) { up += it.f104 || 0; down += it.f105 || 0; flat += it.f106 || 0; }
    return { up, down, flat };
  } catch (e) { console.error('fetchBreadth 失败:', e.message); return { up: 0, down: 0, flat: 0 }; }
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

async function fetchKline(code, count = 250) {
  const url = `http://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${code},day,,,${count},qfq`;
  for (const host of ['http://web.ifzq.gtimg.cn', 'https://web.ifzq.gtimg.cn']) {
    try {
      const r = await fetch(host === 'https' ? url.replace('http://', 'https://') : url, {
        headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'http://gu.qq.com/' },
        redirect: 'follow',
      });
      const buf = await r.arrayBuffer();
      const t = new TextDecoder('gbk').decode(buf);
      const j = JSON.parse(t);
      const series = j && j.data && j.data[code] && j.data[code].day;
      if (Array.isArray(series) && series.length) return series;
    } catch (e) { /* try next */ }
  }
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


// 全市场成交额(沪深两市合计,单位:亿元)
async function fetchTotalAmount() {
  try {
    // 东财沪深两市实时数据 push2.eastmoney.com → sh+sz 累计
    const url = 'https://push2.eastmoney.com/api/qt/stock/get?fields=f43&secids=1.000001,0.399001';
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const j = await res.json();
    const diff = (j.data && j.data.diff) || [];
    let total = 0;
    for (const it of diff) total += (it.f43 || 0);
    return total;  // 元,转亿需 /1e8
  } catch (e) { console.error('fetchTotalAmount 失败:', e.message); return 0; }
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
    const proxy = pool.filter(s => (s.lbc || 1) === 1 && (s.zdp || 0) >= 5).length;
    return { count: proxy, total: pool.length, source: '东财涨停池代理' };
  } catch (e) { console.error('fetchNewHighCount 失败:', e.message); return { count: 0, total: 0, source: '接口失败' }; }
}


async function main() {
  const now = shanghaiNow();
  const explicitArg = process.argv[3] || '';
  // 支持显式传入目标日期 YYYYMMDD（用于补生成历史日期），否则用当前日期
  const date = explicitArg ? explicitArg.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3') : fmtDate(now);
  const time = typeConf.time;
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
  const watchlist = config.watchlist.map((w, i) => {
    const t = tencentAll[config.indices.length + i];
    return { code: w.code, name: w.name, price: t.price, pct: t.pct, amount: fmtAmount(t.amountWan), turnover: String(t.turnover) };
  });

  // 2. 涨停/炸板池（东财）。支持显式传入目标日期（argv[3]），否则用今天
  // 反转闸门指标:全市场成交额 + 60日新高个股数
  const totalAmountYi = (await fetchTotalAmount()) / 1e8;
  const newHigh = await fetchNewHighCount(todayCompact);
  const zt = await fetchZT(todayCompact);
  const qdateRaw = String(zt.qdate || '');
  const qdate = qdateRaw.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3');
  // 数据接口正常且明确为非交易日时才跳过;接口失败(qdate 为空)时降级继续,保证 workflow 不中断
  if (!isPre && qdate && qdate !== date) {
    console.log(`目标(${date})非交易日（最新行情数据日期 ${qdate}），跳过生成`);
    process.exit(0);
  }
  const zbCount = isPre ? 0 : await fetchZB(todayCompact);
  const breadth = isPre ? { up: 0, down: 0, flat: 0 } : await fetchBreadth();

  // 擒龙池（今日 + 昨日对比）
  const dragonPool = await fetchDragonPool(todayCompact, yesterdayCompact);

  // 技术分析:三大指数近 260 日 K 线(K线 URL 需要 sh/sz 前缀)
  const klineMap = {};
  for (const idx of config.indices) {
    const fullCode = (idx.setcode === '1' ? 'sh' : 'sz') + idx.code;
    const arr = await fetchKline(fullCode, 260);
    if (arr.length) klineMap[idx.code] = arr;
  }
  const techAnalysis = buildTechAnalysis(klineMap, config.indices);
  const playbook = derivePlaybook(zt.list, dragonPool);

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
    .map(([name, list]) => ({ name, list }))
    .sort((a, b) => b.list.length - a.list.length)
    .slice(0, 6)
    .map((s, i) => {
      const avgPct = Math.round(s.list.reduce((a, x) => a + x.pct, 0) / s.list.length * 100) / 100;
      return { rank: i + 1, name: s.name, changePct: avgPct, limitUpCount: s.list.length, leadStock: s.list[0].name };
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
    if (!ztByHybk.has(k)) ztByHybk.set(k, { count: 0, maxLB: 0, leadStock: '', inflow: 0, pctSum: 0 });
    const v = ztByHybk.get(k);
    v.count += 1;
    v.pctSum += s.pct;
    if (s.lianban > v.maxLB) { v.maxLB = s.lianban; v.leadStock = s.name; }
    v.inflow += s.sealWan;
  }
  let mainRank;
  if (sectorsAll.length) {
    mainRank = sectorsAll.map(s => {
      const z = ztByHybk.get(s.name);
      const count = z ? z.count : 0;
      const maxLB = z ? z.maxLB : 0;
      const leadStock = z ? z.leadStock : '--';
      const score = s.changePct * 15 + count * 5;
      let status = '正常', atds = 70;
      if (s.changePct >= 2 && count >= 3) { status = '主线确认'; atds = 96; }
      else if (s.changePct >= 1 && count >= 1) { status = '关注'; atds = 84; }
      else if (s.changePct <= -1) { status = '偏弱等待'; atds = 55; }
      else if (s.changePct < 0) { status = '弱势'; atds = 62; }
      return {
        rank: 0,
        name: s.name,
        mappedName: s.name,
        changePct: Math.round(s.changePct * 100) / 100,
        upDown: `${s.up} / ${s.down}`,
        inflowYi: Math.round((s.inflow || 0) / 100000000 * 10) / 10,
        limitUpMax: z ? `${count}家 / ${maxLB}板` : '--',
        leadStock,
        newsAdjust: count >= 3 ? '+1' : '0',
        atds,
        status,
        _score: score
      };
    }).sort((a, b) => b._score - a._score).slice(0, 27).map((s, i) => { s.rank = i + 1; delete s._score; return s; });
  } else {
    // Fallback: 板块 API 不可用时，从涨停池按 hybk 聚合生成
    mainRank = [...ztByHybk.entries()].map(([name, v]) => {
      const score = (v.pctSum / v.count) * 15 + v.count * 5;
      const avgPct = Math.round((v.pctSum / v.count) * 100) / 100;
      let status = '正常', atds = 70;
      if (avgPct >= 2 && v.count >= 3) { status = '主线确认'; atds = 96; }
      else if (avgPct >= 1 && v.count >= 1) { status = '关注'; atds = 84; }
      else if (avgPct <= -1) { status = '偏弱等待'; atds = 55; }
      return {
        rank: 0, name, mappedName: name, changePct: avgPct,
        upDown: '-- / --', inflowYi: '--', limitUpMax: `${v.count}家 / ${v.maxLB}板`,
        leadStock: v.leadStock, newsAdjust: v.count >= 3 ? '+1' : '0', atds, status,
        _score: score
      };
    }).sort((a, b) => b._score - a._score).slice(0, 27).map((s, i) => { s.rank = i + 1; delete s._score; return s; });
  }

  const dataAsOfDate = isPre ? qdate : date;
  const report = {
    meta: {
      date, time, type, typeLabel: typeConf.label, generatedAt, market: 'A股',
      dataSource: '腾讯行情 + 东方财富公开接口',
      dataAsOfDate,
      dataAsOfLabel: isPre ? '昨日收盘' : '今日盘中/收盘'
    },
    indices,
    marketStats: {
      upCount: breadth.up, downCount: breadth.down, flatCount: breadth.flat,
      limitUpCount: zt.total, limitDownCount: 0, zhaBanCount: zbCount,
      maxLianBan: dragonPool.maxLianBan || '--', maxLianBanStock: (dragonPool.consecutiveBoards && dragonPool.consecutiveBoards[0]) ? dragonPool.consecutiveBoards[0].name : '--',
      totalAmount: totalAmountYi ? totalAmountYi.toFixed(0) + '亿' : '--'
    },
    newHigh: newHigh,
    regimeGate: { totalAmount: totalAmountYi, newHighCount: newHigh.count, totalZhengZhang: newHigh.total, newHighSource: newHigh.source },
    hotSectors,
    limitUp,
    limitDown: [],
    watchlist,
    mainRank,
    dragonPool,
    intlMkt,
    closeEmotion,
    techAnalysis,
    playbook,
    notes: isPre ? `盘前简报（08:30），数据基于 ${dataAsOfDate} 收盘。今日市场 9:30 开盘后才会有实时数据。` : '数据来源：腾讯行情 + 东方财富公开接口（云端自动采集）。仅做行情展示，不构成投资建议。'
  };

  fs.mkdirSync(DATA_DIR, { recursive: true });
  const outFile = path.join(DATA_DIR, `${date}_${time.replace(':', '-')}.json`);
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2), 'utf8');
  console.log('已生成:', outFile);
  console.log(JSON.stringify({ date, type, indices, limitUpCount: zt.total, zbCount, up: breadth.up, down: breadth.down, maxLB: maxLB.name }, null, 2));
}

main().catch(e => { console.error('采集失败:', e.message); process.exit(1); });
