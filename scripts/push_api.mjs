// GitHub REST API 推送 (blobs -> trees -> commit -> PATCH refs/heads/main)
// 用法: node scripts/push_api.mjs <commit-message>
// 特性: 增量 blob(仅上传与远程 tree 不同的文件) + base_tree 合并(保留远程独有文件)
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = path.resolve(import.meta.dirname, '..');
const OWNER = 'xinxin-0501';
const REPO = 'atds-review';
const BRANCH = 'main';
const TOKEN = (() => {
  if (process.env.GH_TOKEN || process.env.GITHUB_TOKEN) return process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  const out = execSync('git credential fill', { input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8' });
  const m = out.match(/^password=(.+)$/m);
  if (!m) throw new Error('无法获取 GitHub 凭据');
  return m[1].trim();
})();
const MESSAGE = process.argv[2] || 'ATDS auto premarket report';
// ATDS_DRYRUN=1:只做校验不真正提交。用于验证"tree 是否还会丢文件"这类逻辑,
//   它会跳过全部 blob 上传(用远程已有 sha 占位),因此零副作用、几十秒内跑完。
const DRYRUN = process.env.ATDS_DRYRUN === '1';

const API = `https://api.github.com/repos/${OWNER}/${REPO}`;
const H = { Authorization: `token ${TOKEN}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'User-Agent': 'atds-auto' };

async function req(method, url, body, retries = 5) {
  for (let i = 0; i < retries; i++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), Number(process.env.ATDS_HTTP_TIMEOUT_MS) || 60000);
    try {
      const r = await fetch(url, { method, headers: H, body: body ? JSON.stringify(body) : undefined, signal: ac.signal });
      const t = await r.text();
      if (!r.ok) throw new Error(`${method} ${url.split('?')[0]} -> ${r.status}: ${t.slice(0, 200)}`);
      return t ? JSON.parse(t) : null;
    } catch (e) {
      clearTimeout(timer);
      console.log(`  retry ${i + 1}/${retries} ${method} ${url.split('?')[0]}: ${e.message}`);
      if (i === retries - 1) throw e;
      await new Promise(s => setTimeout(s, 3000 * (i + 1)));
    } finally {
      clearTimeout(timer);
    }
  }
}

// git blob sha1 = sha1("blob <size>\0<content>")
function gitBlobSha(buf) {
  const h = crypto.createHash('sha1');
  h.update(`blob ${buf.length}\0`);
  h.update(buf);
  return h.digest('hex');
}

// 0. 取远程 main head + 递归 tree (path -> sha)
console.log('fetch remote head/tree...');
const headRef = await req('GET', `${API}/git/ref/heads/${BRANCH}`);
const headSha = headRef.object.sha;
const headCommit = await req('GET', `${API}/git/commits/${headSha}`);
const headTree = headCommit.tree.sha;
console.log('remote head:', headSha.slice(0, 7), '| tree:', headTree.slice(0, 7));

let remotePaths = new Map();
const remoteTrees = new Map();
try {
  const t = await req('GET', `${API}/git/trees/${headTree}?recursive=1`);
  for (const e of t.tree) {
    if (e.type === 'blob') remotePaths.set(e.path, e.sha);
    else if (e.type === 'tree') remoteTrees.set(e.path, e.sha);   // v11.54:子目录也要 base_tree
  }
  console.log('remote blobs:', remotePaths.size, '| remote trees:', remoteTrees.size);
} catch (e) {
  console.log('recursive tree fetch failed, treat as empty base:', e.message);
}

// 1. 列出全部本地跟踪文件 + 计算 blob sha,筛出需上传的
const files = execSync('git ls-files -z', { cwd: ROOT, encoding: 'utf8' })
  .split('\0').filter(Boolean).map(f => f.replace(/\//g, path.sep));
console.log('tracked files:', files.length);

const needUpload = []; // {p, buf}
const localSha = new Map();
const skipKeepRemote = new Set(); // ATDS_SKIP_PATHS 命中且远程已有:跳过上传,tree 沿用远程内容
// v11.66【铁律护栏】data/*_cache.json 只由云端 Actions 维护,本地副本必然陈旧。
//   背景(实测 2026-09-16):本机自动化调用本脚本全量推送时,把【本地陈旧缓存】覆盖到了云端 ——
//   data/auction_cache.json 当天 09:30 云端刚采到 date=2026-09-16,被本地那份 date=2026-09-14 覆盖回去,
//   此后所有报告读竞价快照时因 date 不匹配而丢弃 ⇒ 「竞价量比/竞价换手」静默变成 null(页面显示 --)。
//   原先只靠调用方自觉(文档里写"绝不推 cache"),现改为【脚本内硬拦截】:命中 cache 且远程已有时,
//   一律跳过上传、tree 沿用远程内容。
const FORBID_CACHE = /^data\/.*_cache\.json$/;
for (const f of files) {
  const abs = path.join(ROOT, f);
  const buf = fs.readFileSync(abs);
  const sha = gitBlobSha(buf);
  localSha.set(f, sha);
  const rp = f.split(path.sep).join('/');
  if ((process.env.ATDS_SKIP_PATHS || '').split(',').filter(Boolean).includes(rp) && remotePaths.has(rp)) {
    skipKeepRemote.add(f);
    continue;
  }
  if (FORBID_CACHE.test(rp) && remotePaths.has(rp)) {
    skipKeepRemote.add(f);
    continue;
  }
  if (remotePaths.get(rp) !== sha) needUpload.push({ p: f, buf, rp });
}
console.log(`diff blobs to upload: ${needUpload.length}/${files.length}`);

// 2. 并发上传差异 blob (dry-run 时跳过:用远程 sha 占位,只关心路径集合是否有丢失)
const blobSha = new Map(localSha);
for (const f of skipKeepRemote) blobSha.set(f, remotePaths.get(f.split(path.sep).join('/')));
if (skipKeepRemote.size) console.log(`skip(沿用远程): ${[...skipKeepRemote].join(', ')}`);
let done = 0;
const CONC = Number(process.env.ATDS_CONC) || 5;
if (DRYRUN) {
  console.log(`dry-run:跳过上传 ${needUpload.length} 个 blob`);
  for (const { p, rp } of needUpload) blobSha.set(p, remotePaths.get(rp) || localSha.get(p));
} else {
for (let i = 0; i < needUpload.length; i += CONC) {
  await Promise.all(needUpload.slice(i, i + CONC).map(async ({ p, buf, rp }) => {
    const j = await req('POST', `${API}/git/blobs`, { content: buf.toString('base64'), encoding: 'base64' });
    blobSha.set(p, j.sha);
    done++;
    console.log(`  blob ${done}/${needUpload.length}: ${rp}`);
  }));
}
}

// 3. 自底向上构建嵌套 tree (await 递归,保证子树先建)
// v11.54 修(严重):原实现**只给根目录**带 base_tree,子目录 tree 全是从本地文件重建的 →
//   远程独有的子目录文件被静默删除。实证:2026-09-14 18:02 的提交删掉了
//   data/reviews/2026-09-14_{11-30,13-30,14-40}.json、site/2026-09-14_{11-30,13-30,14-40}.html、
//   scripts/{hero_mobile.css,modal_css.txt} 共 8 个文件(全是"本地没有、远程有"的文件)。
//   现在每一层都带 base_tree ⇒ 推送只增/改,不删。
async function buildTree(dir) {
  const children = new Map();
  for (const f of files) {
    const rel = path.relative(dir, f);
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
      const seg = rel.split(path.sep)[0];
      const full = path.join(dir, seg);
      if (seg === rel) children.set(seg, { type: 'blob', path: full });
      else if (!children.has(seg)) children.set(seg, { type: 'tree', path: full });
    }
  }
  const entries = [];
  for (const [name, c] of children) {
    if (c.type === 'blob') entries.push({ path: name, mode: '100644', type: 'blob', sha: blobSha.get(c.path) });
    else entries.push({ path: name, mode: '040000', type: 'tree', sha: await buildTree(c.path) });
  }
  const dirPosix = dir.split(path.sep).join('/');
  const base = dirPosix === '' ? headTree : remoteTrees.get(dirPosix);
  const body = base ? { tree: entries, base_tree: base } : { tree: entries };
  console.log('POST tree:', dirPosix || '(root)', base ? 'base_tree=' + base.slice(0, 7) : '⚠ 无 base_tree(远程无此目录)');
  const j = await req('POST', `${API}/git/trees`, body);
  return j.sha;
}

console.log('构建 tree...');
const rootTreeSha = await buildTree('');
console.log('root tree:', rootTreeSha.slice(0, 7));

// 4. 安全闸:新 tree 相对远程不得丢失任何文件(除非显式 ATDS_ALLOW_DELETE=1)
//    这是对"子目录漏 base_tree ⇒ 静默删文件"这类事故的兜底:任何一次误删都会在此处中止,
//    而不是等到几天后发现历史报告不见了。
try {
  const nt = await req('GET', `${API}/git/trees/${rootTreeSha}?recursive=1`);
  const newPaths = new Set(nt.tree.filter(e => e.type === 'blob').map(e => e.path));
  const lost = [...remotePaths.keys()].filter(p => !newPaths.has(p));
  if (lost.length) {
    const allow = process.env.ATDS_ALLOW_DELETE === '1';
    console.error(`${allow ? '显式允许删除' : '⚠️ 检测到将删除'} ${lost.length} 个远程文件${allow ? '' : ',已中止 push(确需删除请设 ATDS_ALLOW_DELETE=1)'}`);
    lost.slice(0, 20).forEach(p => console.error('  - ' + p));
    if (!allow) process.exit(2);
  } else {
    console.log('安全闸:无文件丢失 ✓');
  }
} catch (e) {
  console.log('安全闸跳过(无法取回新 tree):', e.message);
}

// 5. 创建 commit (parent = 远程 head)
if (DRYRUN) {
  console.log('dry-run:不创建 commit、不动 ref。tree 校验通过即代表推送不会丢文件。');
  process.exit(0);
}
const commit = await req('POST', `${API}/git/commits`, {
  message: MESSAGE,
  tree: rootTreeSha,
  parents: [headSha],
});
console.log('commit:', commit.sha);

// 5. PATCH ref (force:false,若远程又前进则失败重跑)
const ref = await req('PATCH', `${API}/git/refs/heads/${BRANCH}`, { sha: commit.sha, force: false });
console.log('ref updated:', ref.object.sha);
console.log('PUSH OK');
