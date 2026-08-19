#!/usr/bin/env node
// 用东财跌停池接口修正 cloud_fetch.mjs 硬编码的 limitDownCount=0
// 用法: node scripts/patch_limitdown.mjs data/reviews/2026-08-18_15-20.json [YYYYMMDD]
import fs from 'fs';

const file = process.argv[2];
const dateArg = process.argv[3] || '';
if (!file) { console.error('缺少 JSON 路径'); process.exit(1); }

async function fetchDT() {
  const url = `http://push2ex.eastmoney.com/getTopicDTPool?ut=7eea3edcaed734bea9cbfc24409ed989&dpt=wz.ztzt&Pageindex=0&pagesize=5&sort=fund%3Aasc&date=${dateArg}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const j = await res.json();
  const d = (j && j.data) || {};
  const pool = d.pool || [];
  const list = pool.map(s => ({
    code: String(s.c), name: s.n,
    price: (s.p || 0) / 1000,
    pct: Math.round((s.zdp || 0) * 100) / 100,
    reason: s.hybk || '', sealWan: Math.round((s.fund || 0) / 10000),
    kaiban: s.zbc || 0
  }));
  return { total: d.tc || pool.length, list, qdate: String(d.qdate || '') };
}

const dt = await fetchDT();
const report = JSON.parse(fs.readFileSync(file, 'utf8'));
const dateDash = report.meta.date.replace(/-/g, '');
if (dt.qdate !== dateDash) {
  report.marketStats.limitDownCount = 0;
  report.limitDown = [];
  console.log(`跌停接口发生日期(${dt.qdate})非当天(${dateDash})，跌停家数记为 0`);
} else {
  report.marketStats.limitDownCount = dt.total;
  report.limitDown = dt.list.slice(0, 5);
  console.log(`跌停 ${dt.total} 家，明细 ${dt.list.length} 条`);
}
fs.writeFileSync(file, JSON.stringify(report, null, 2), 'utf8');
console.log('已写入:', file);
