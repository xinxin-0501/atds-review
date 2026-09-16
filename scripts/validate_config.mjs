#!/usr/bin/env node
/**
 * v11.69 策略参数校验器 —— config.json 的「保存闸」。
 * 用法: node scripts/validate_config.mjs   （合法 exit 0；有不合法项 exit 1）
 *
 * 为什么需要:config 的 strategy 曾长期手写,出现过「止损价高于现价」「入场价是另一只票的价格」
 * 这类**自相矛盾**的参数,却照样上屏 —— 卡片上的执行纪律因此是错的。
 * 现在参数默认由程序生成,只有 manual_override 可能引入主观值,故**必须**在保存/推送前拦住。
 *
 * 三条硬约束(与 cloud_fetch.validatePlanF 保持一致,测试里有跨端一致性断言):
 *   ① 止损价 ≥ 现价            → 拒绝(做多语境下止损位高于现价毫无意义)
 *   ② 入场价偏离现价 > 20%      → 拒绝(偏离过远,不是"今天的计划")
 *   ③ 止损 ≥ 入场 或 止盈 ≤ 入场 → 拒绝(计划内部不自洽)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
const list = cfg.watchlist || [];

export function validatePlanF(plan, price) {
  const px = Number(price) || 0;
  if (!plan) return { ok: false, reason: '无法生成计划(技术画像缺失)' };
  const e = Number(plan.entry), st = Number(plan.stop), tg = Number(plan.target);
  if (!(px > 0)) return { ok: false, reason: '现价无效' };
  if (!(e > 0) || !(st > 0) || !(tg > 0)) return { ok: false, reason: '计划参数缺失或非正数' };
  if (st >= px) return { ok: false, reason: '止损价 ' + st.toFixed(2) + ' 不低于现价 ' + px.toFixed(2) };
  if (Math.abs(e - px) / px > 0.20) return { ok: false, reason: '入场价 ' + e.toFixed(2) + ' 偏离现价 ' + px.toFixed(2) + ' 超过 20%' };
  if (st >= e) return { ok: false, reason: '止损价 ' + st.toFixed(2) + ' 不低于入场价 ' + e.toFixed(2) };
  if (tg <= e) return { ok: false, reason: '止盈价 ' + tg.toFixed(2) + ' 不高于入场价 ' + e.toFixed(2) };
  return { ok: true, reason: '' };
}

function fullCode(s) {
  const c = String(s.code || '');
  if (/^(sh|sz|bj)/i.test(c)) return c.toLowerCase();
  const c0 = c.charAt(0);
  if (c0 === '6' || c0 === '5' || c0 === '9') return 'sh' + c;
  if (c0 === '4' || c0 === '8' || c0 === '92') return 'bj' + c;
  return 'sz' + c;
}

async function fetchPrices(codes) {
  const out = {};
  const q = codes.join(',');
  for (const host of ['http://qt.gtimg.cn', 'https://qt.gtimg.cn']) {
    try {
      const r = await fetch(host + '/q=' + q, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!r.ok) continue;
      const buf = await r.arrayBuffer();
      const txt = new TextDecoder('gbk').decode(buf);   // 腾讯行情是 GBK
      for (const line of txt.split(';')) {
        const m = line.match(/v_(?:sh|sz|bj)(\d{6})="([^"]*)"/);
        if (!m) continue;
        const f = m[2].split('~');
        const px = parseFloat(f[3]);
        if (px > 0) out[m[1]] = px;
      }
      if (Object.keys(out).length) return out;
    } catch (e) { /* 换主机 */ }
  }
  return out;
}

const need = list.filter(s => {
  const ov = (s.strategy && s.strategy.manual_override) || null;
  return ov && (ov.entry != null || ov.stop != null || ov.target != null);
});

const errors = [];
let checked = 0;

if (!need.length) {
  console.log('[策略校验] 11 只观察池个股均未填写 manual_override —— 全部使用系统自动生成值，无需校验。');
} else {
  const codes = need.map(fullCode);
  const px = await fetchPrices(codes);
  const noPx = [];
  for (const s of need) {
    const p = px[String(s.code)];
    if (!(p > 0)) { noPx.push(s.name + '(' + s.code + ')'); continue; }
    checked++;
    const ov = s.strategy.manual_override;
    const v = validatePlanF({ entry: ov.entry, stop: ov.stop, target: ov.target }, p);
    console.log('[策略校验] ' + s.name + '(' + s.code + ') 现价 ' + p +
      ' | 人工 entry=' + ov.entry + ' stop=' + ov.stop + ' target=' + ov.target +
      ' → ' + (v.ok ? '✅ 通过' : '❌ ' + v.reason));
    if (!v.ok) errors.push(s.name + '(' + s.code + '): ' + v.reason);
  }
  if (noPx.length) console.log('[策略校验] ⚠️ 未能取到现价,跳过校验: ' + noPx.join('、'));
}
console.log('---');

if (errors.length) {
  console.error('⛔ 拒绝保存:config.json 中有 ' + errors.length + ' 处策略参数不合理，请先修正再推送:');
  errors.forEach(e => console.error('   · ' + e));
  console.error('   (若确认不再需要人工参数,把 manual_override 设为 null 即改用系统自动生成值)');
  process.exit(1);
}
console.log('✅ 策略参数校验通过（人工项 ' + checked + ' 个）');
process.exit(0);
