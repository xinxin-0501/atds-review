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
  // 东财沪深指数上涨/下跌/平盘家数(f104/f105/f106)。HTTPS + 超时,兼容 GitHub Actions 境外环境
  const url = 'https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&fields=f1,f2,f3,f104,f105,f106&secids=1.000001,0.399001,0.399006';
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 8000);
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: ac.signal }).finally(() => clearTimeout(timer));
    const j = await res.json();
    const diff = (j.data && j.data.diff) || [];
    let up = 0, down = 0, flat = 0;
    for (const it of diff) { up += it.f104 || 0; down += it.f105 || 0; flat += it.f106 || 0; }
    if (up || down || flat) return { up, down, flat };
  } catch (e) { console.error('fetchBreadth 失败:', e.message); }
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

async function fetchKline(code, count = 250) {
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
  if (firstWaveGain < 0.15) return null; // 一波涨幅不足,排除
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
  // 打分
  let score = 0;
  if (firstWaveGain >= 0.20) score += 25; else if (firstWaveGain >= 0.15) score += 15;
  if (adjPct >= -0.05) score += 20; else if (adjPct >= -0.15) score += 15; else score += 8;
  if (volRatio <= 0.5) score += 15; else if (volRatio <= 0.75) score += 10;
  if (kdjGold) score += 15;
  if (kdjDivergence) score += 10;
  if (notBreakSupport) score += 10;
  if (stabilize) score += 5;
  if (maAlign) score += 5;
  if (score < 45) return null;
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

async function scanWaveDivergence() {
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
  results.sort((a, b) => b.score - a.score);
  const list = results.slice(0, 30).map((x, i) => ({
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
  const list = results.slice(0, 30).map((x, i) => ({
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
  const list = results.slice(0, 30).map((x, i) => ({
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
  // 全市场形态扫描(启动/老鸭头/拉升)
  const marketScan = await scanMarketPatterns(zt.list);
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
    rows.push({
      name, mappedName: name,
      changePct: Math.round(changePct * 100) / 100,
      upDown: hs ? `${hs.up} / ${hs.down}` : '-- / --',
      inflowYi: hs ? Math.round((hs.inflow || 0) / 100000000 * 10) / 10 : Math.round((v.inflow || 0) / 10000 / 10000 * 10) / 10,
      limitUpMax: `${v.count}家 / ${v.maxLB}板`,
      leadStock: v.leadStock || '--',
      _score: score,
      _hasZT: true
    });
    usedKeys.add(name);
  }
  // 2) 补加 hotSectors 中涨幅 ≥1% 但无涨停匹配的行业(确保涨幅榜前位都列出)
  for (const s of hotSectors) {
    if (s.changePct < 1) break;
    const matched = rows.find(r => r.name === s.name || s.name.includes(r.name) || r.name.includes(s.name));
    if (matched) { matched.changePct = s.changePct; matched.upDown = `${s.up} / ${s.down}`; matched.inflowYi = Math.round((s.inflow || 0) / 100000000 * 10) / 10; continue; }
    rows.push({
      name: s.name, mappedName: s.name,
      changePct: Math.round(s.changePct * 100) / 100,
      upDown: `${s.up} / ${s.down}`,
      inflowYi: Math.round((s.inflow || 0) / 100000000 * 10) / 10,
      limitUpMax: '0', leadStock: '--',
      _score: s.changePct * 10,
      _hasZT: false
    });
  }
  // 3) 计算 status / atds 并排序
  for (const r of rows) {
    if (r.changePct >= 2 && r.limitUpMax !== '0') { r.status = '主线确认'; r.atds = 96; }
    else if (r.changePct >= 1) { r.status = '关注'; r.atds = 84; }
    else if (r.changePct <= -1) { r.status = '偏弱等待'; r.atds = 55; }
    else if (r.changePct < 0) { r.status = '弱势'; r.atds = 62; }
    else { r.status = '正常'; r.atds = 70; }
    r.newsAdjust = (!r.limitUpMax.startsWith('0')) ? '+1' : '0';
  }
  const mainRank = rows.sort((a, b) => b._score - a._score).slice(0, 27).map((s, i) => { s.rank = i + 1; delete s._score; delete s._hasZT; return s });
  if (!mainRank.length && ztByHybk.size === 0) {
    // 终极兜底:数据完全缺失时给个空数组
  }

  const dataAsOfDate = isPre ? qdate : date;
  // 波背离选股(仅午盘):全A扫描剔除ST,优先排序TOP30
  let waveDivergence = null;
  // 超短核心选股(仅午盘):全A扫描剔除ST,优先排序TOP30
  let shortCore = null;
  // 强势股选股(仅午盘):全A扫描剔除ST,优先排序TOP30
  let strongStock = null;
  if (type === 'midday') {
    console.log('开始波背离全市场扫描(午盘)...');
    waveDivergence = await scanWaveDivergence();
    console.log('波背离扫描完成:', waveDivergence ? waveDivergence.list.length : 0, '只');
    console.log('开始超短核心全市场扫描(午盘)...');
    shortCore = await scanShortCore();
    console.log('超短核心扫描完成:', shortCore ? shortCore.list.length : 0, '只');
    console.log('开始强势股全市场扫描(午盘)...');
    strongStock = await scanStrongStock();
    console.log('强势股扫描完成:', strongStock ? strongStock.list.length : 0, '只');
  }

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
    notes: isPre ? `盘前简报（08:30），数据基于 ${dataAsOfDate} 收盘。今日市场 9:30 开盘后才会有实时数据。` : '数据来源：腾讯行情 + 东方财富公开接口（云端自动采集）。仅做行情展示，不构成投资建议。'
  };

  fs.mkdirSync(DATA_DIR, { recursive: true });
  const outFile = path.join(DATA_DIR, `${date}_${time.replace(':', '-')}.json`);
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2), 'utf8');
  console.log('已生成:', outFile);
  console.log(JSON.stringify({ date, type, indices, limitUpCount: zt.total, zbCount, up: breadth.up, down: breadth.down, maxLB: maxLB.name }, null, 2));
}

main().catch(e => { console.error('采集失败:', e.message); process.exit(1); });
