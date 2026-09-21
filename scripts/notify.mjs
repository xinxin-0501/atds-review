// v11.110 告警通知(Server酱) —— 三类异常即时触达:节假日误判 / 三源兜底全失败 / 进程崩溃
// 用法: node scripts/notify.mjs "标题" "内容(可含换行)"
// 环境变量 SERVERCHAN_SENDKEY(由 GitHub Actions Secret 注入);告警失败不阻断主流程(exit 0)。
// 注意:必须用 encodeURIComponent 保持 UTF-8(实测 Windows 本地 curl -d 会把中文转 GBK → Server酱 30001)。
const key = process.env.SERVERCHAN_SENDKEY || '';
const title = (process.argv[2] || 'ATDS 告警').slice(0, 32);
const desp = (process.argv[3] || '').slice(0, 4000);
if (!key) { console.log('[notify] 未配置 SERVERCHAN_SENDKEY，跳过告警'); process.exit(0); }
try {
  const r = await fetch('https://sctapi.ftqq.com/' + key + '.send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
    body: 'title=' + encodeURIComponent(title) + '&desp=' + encodeURIComponent(desp)
  });
  const j = await r.json();
  console.log('[notify]', j && j.code === 0 ? '推送成功(pushid ' + ((j.data || {}).pushid || '') + ')' : ('推送失败 ' + (j && j.message || '')));
} catch (e) {
  console.warn('[notify] 发送异常(不阻断主流程):', e.message);
}
process.exit(0);
