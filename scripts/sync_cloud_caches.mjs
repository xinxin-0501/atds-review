#!/usr/bin/env node
/**
 * 把【云端自维护的缓存】同步到本地工作区,再做任何推送。
 *
 * 为什么必须有:data/*_cache.json 只由云端 Actions 采集写入,而本地副本必然陈旧。
 *   2026-09-16 实测事故:本机自动化做全量推送时,把本地那份 date=2026-09-14 的
 *   auction_cache.json 覆盖了云端当天 09:30 刚采到的 date=2026-09-16 版本
 *   ⇒ 之后所有报告读竞价快照时"日期不符即丢弃" ⇒ 超短核心的「竞价量比/竞价换手」
 *   静默变成 null(页面显示 --),看起来像"数据没更新",实际是被本地盖旧了。
 *
 * 用法: GH_TOKEN=xxx node scripts/sync_cloud_caches.mjs
 * 行为: 对每个 data/*_cache.json,若远程存在且(本地不存在 或 内容不同),用远程版覆盖本地。
 *       只下行、不上行,永不删除本地文件。失败不阻断调用方(打印警告后 exit 0)。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const OWNER = 'xinxin-0501', REPO = 'atds-review', BRANCH = 'main';
const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || (() => {
  try {
    const out = execSync('git credential fill', { input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8' });
    const m = out.match(/^password=(.+)$/m);
    return m ? m[1].trim() : '';
  } catch (e) { return ''; }
})();
if (!TOKEN) { console.warn('[缓存同步] 无 GH_TOKEN,跳过(不影响采集)'); process.exit(0); }
const API = `https://api.github.com/repos/${OWNER}/${REPO}`;
const H = { Authorization: `token ${TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': 'atds-sync' };

const DATA_DIR = path.join(ROOT, 'data');
if (!fs.existsSync(DATA_DIR)) { console.log('[缓存同步] 无 data/ 目录,跳过'); process.exit(0); }

// 远程 data/ 下的缓存清单
let entries = [];
try {
  const r = await fetch(`${API}/contents/data?ref=${BRANCH}&t=${Date.now()}`, { headers: H });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  entries = (await r.json()).filter(x => /_cache\.json$/.test(x.name));
} catch (e) {
  console.warn('[缓存同步] 读取远程 data/ 失败:', e.message, '→ 跳过(下一步推送仍受 FORBID_CACHE 保护)');
  process.exit(0);
}

let updated = 0, same = 0, failed = 0, skipped = 0;
for (const e of entries) {
  try {
    // ⚠️ 必须走 Blobs API:Contents API 对 >1MB 的文件返回 content:"" / encoding:"none",
    //    照抄会把 15MB 的 kline_cache 写成 0 字节(**静默清空缓存**,比不下载更糟)。踩过。
    const r = await fetch(`${API}/git/blobs/${e.sha}`, { headers: H });
    if (!r.ok) throw new Error('blob HTTP ' + r.status);
    const j = await r.json();
    if (j.encoding !== 'base64' || !j.content) throw new Error('blob 未返回 base64(encoding=' + j.encoding + ')');
    const remoteBuf = Buffer.from(j.content, 'base64');
    // 体积守卫:解码后明显小于远程声明的 size ⇒ 判定下载不完整,拒绝落盘(宁可保留旧版)
    if (e.size && remoteBuf.length < e.size * 0.9) {
      throw new Error(`体积异常(解出 ${remoteBuf.length} / 远程 ${e.size} 字节)→ 拒绝落盘`);
    }
    const localPath = path.join(DATA_DIR, e.name);
    if (fs.existsSync(localPath) && fs.readFileSync(localPath).equals(remoteBuf)) { same++; continue; }
    // 只在"远程更新"时下行;本地有更新的日期标记时保留本地(避免把云端旧版盖到本地新版上)
    if (fs.existsSync(localPath)) {
      try {
        const lo = JSON.parse(fs.readFileSync(localPath, 'utf8'));
        const ro = JSON.parse(remoteBuf.toString('utf8'));
        const ld = String(lo.date || lo.tradeDate || lo.savedAt || '');
        const rd = String(ro.date || ro.tradeDate || ro.savedAt || '');
        if (ld && rd && ld > rd) { console.log(`  · ${e.name}: 本地(${ld}) 比远程(${rd}) 新 → 保留本地`); skipped++; continue; }
      } catch (err) { /* 解析失败(含空文件)则按"远程为准" */ }
    }
    fs.writeFileSync(localPath, remoteBuf);
    console.log(`  ✓ ${e.name}: ${(remoteBuf.length / 1048576).toFixed(1)} MB 已用云端版本覆盖本地`);
    updated++;
  } catch (err) {
    console.warn(`  ✗ ${e.name}: ${err.message}`);
    failed++;
  }
}
console.log(`[缓存同步] 更新 ${updated} · 一致 ${same} · 保留本地 ${skipped} · 失败 ${failed}(共 ${entries.length} 个云端缓存)`);
