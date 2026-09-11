function getBaseUrl(){var h=location.href.split("#")[0];if(/index\.html/i.test(h)){return h.replace(/index\.html.*$/i,"");}if(h.slice(-1)==="/"){return h;}var i=h.lastIndexOf("/");return h.slice(0,i+1);}
function showQr(){var u=getBaseUrl();document.getElementById("qr-mask").style.display="flex";document.getElementById("qr-sub").textContent=u;var el=document.getElementById("qrcode");el.innerHTML="";try{new QRCode(el,{text:u,width:200,height:200});}catch(e){el.innerHTML='<div style="font-size:12px;color:#999">二维码生成失败</div>';}}
function hideQr(){document.getElementById("qr-mask").style.display="none";}
function showResearch(code){var m=document.getElementById("modal-"+code);if(m){m.classList.add("show");document.body.style.overflow="hidden";}}
function closeModal(code){var m=document.getElementById("modal-"+code);if(m){m.classList.remove("show");document.body.style.overflow="";}}
async function fetchStockData(raw){
  if(!/^\d{6}$/.test(String(raw)))return null;
  var c0=String(raw).charAt(0);var sc;
  if(c0==="6"){sc="sh";}else if(c0==="4"||c0==="8"||c0==="92"){sc="bj";}else{sc="sz";}
  for(var attempt=0;attempt<3;attempt++){
    try{
      var res=await fetch("https://qt.gtimg.cn/q="+sc+raw,{cache:"no-store"});
      if(!res.ok)continue;
      var buf=await res.arrayBuffer();
      var text=new TextDecoder("gbk").decode(buf);
      var m=text.match(/="([^"]+)"/);if(!m)continue;
      var f=m[1].split("~");if(f.length<40)continue;
      var retCode=String(f[2]||"").trim();
      if(retCode!==String(raw))continue;
      var data={code:retCode,name:f[1],price:parseFloat(f[3]),pct:parseFloat(f[32])||0,amount:((parseFloat(f[37])||0)/10000).toFixed(1)+"亿",turnover:f[38]||"--",setcode:sc,
        prevClose:parseFloat(f[4])||0,open:parseFloat(f[5])||0,high:parseFloat(f[33])||0,low:parseFloat(f[34])||0,
        amplitude:parseFloat(f[43])||0,volRatio:parseFloat(f[49])||0,avgPrice:parseFloat(f[51])||0,
        floatMcap:parseFloat(f[44])||0,totalMcap:parseFloat(f[45])||0};
      if(!data.name)continue;
      return data;
    }catch(e){}
    if(attempt<2)await new Promise(function(r){setTimeout(r,500);});
  }
  return null;
}
async function openStockResearch(code){
  code=String(code||"").trim();
  // 总是走动态版丰富弹窗(忽略静态 modal,统一体验)
  closeAllModals();
  var data=await fetchStockData(code);
  if(!data){alert("未找到股票代码 "+code);return;}
  showDynamicResearch(data);
  var atds=70+Math.min(25,Math.max(-15,Math.round(Number(data.pct||0)*2+(Number(data.turnover)||0)*0.5)));
  if(atds>=85 && !document.querySelector('.wl-stock-row[data-code="'+code+'"]')){try{await addFetchedToWatchlist(code);}catch(e){addToWatchlistUI(data);saveWatchlist();}}
}
async function addFetchedToWatchlist(code){
  code=String(code||"").trim();
  if(!/^\d{6}$/.test(code)){
    // 从打开的 modal 读 code(兼容性回退)
    var openM=document.querySelector('.modal-mask.show[data-code]');
    if(!openM)openM=document.querySelector('.modal-mask[id^="modal-"]');
    if(openM){
      var cm=openM.id.match(/modal-(\d+)/);if(cm)code=cm[1];
      if(!code&&openM.dataset)code=openM.dataset.code;
    }
  }
  if(!/^\d{6}$/.test(code)){alert("无效股票代码: "+code);return;}
  // 检查是否已存在
  if(document.querySelector('.wl-stock-row[data-code="'+code+'"]')){
    alert("已在观察池中");
    var exist=document.querySelector('.wl-stock-row[data-code="'+code+'"]');
    if(exist){exist.style.background="#fff7e6";setTimeout(function(){exist.style.background="";},1500);}
    return;
  }
  var data=await fetchStockData(code);
  if(!data){alert("未能获取行情,请检查网络后重试");return;}
  // 拉 K 线 → 决策技术画像(ATR14/支撑压力/缺口/多周期),与 config 观察池一致
  try {
    var c0 = code.charAt(0);
    var full = (c0 === '6' || c0 === '5') ? ('sh' + code) : ((c0 === '4' || c0 === '8' || c0 === '92') ? ('bj' + code) : ('sz' + code));
    var kl = await fetchKlineF(full, 90);
    if (kl && kl.length >= 30) {
      data.tech = calcDecisionTech(kl);
    }
  } catch (e) { /* K 线失败不影响加入,决策卡降级为粗逻辑 */ }
  // 主力资金流(东财):失败不阻塞,决策卡显示 -- 
  try {
    var ff2 = await fetchStockFundFlowF(code);
    if (ff2) data.fundFlow = ff2;
  } catch (e) {}
  // 分钟趋势 + 封单 + 龙虎榜 + 事件(真实,并发拉取,失败不阻塞)
  try {
    var ext = await Promise.all([
      fetchMinuteTrendF(code, 'm60'), fetchMinuteTrendF(code, 'm15'),
      fetchLimitUpSealF(code), fetchLhbDetailF(code), fetchEventsF(code)
    ]);
    // 分钟线兜底:双源失败(如浏览器CORS拦截腾讯/新浪)时用日线MA5/MA20斜率近似,坚决不显示"暂缺"
    var f60 = ext[0], f15 = ext[1];
    if (!f60) f60 = approxMinFromTechF(data.tech);
    if (!f15) f15 = approxMinFromTechF(data.tech);
    if (f60 || f15) data.minTrend = { m60: f60, m15: f15 };
    if (ext[2]) data.seal = ext[2];
    if (ext[3]) data.lhb = ext[3];
    if (ext[4]) data.events = ext[4];
  } catch (e) {}
  addToWatchlistUI(data);
  // 保存全量数据(供退出重登时立即渲染,不依赖网络)
  saveWatchlistStockData(code,data);
  saveWatchlist();
  // 添加后立即强制刷新一次,确保显示最新实时行情(不等待 60s 定时)
  setTimeout(function(){try{refreshWatchlistQuotes();}catch(e){}}, 200);
  var el=document.querySelector('.wl-stock-row[data-code="'+code+'"]');
  if(el){el.style.background="#e8f5e9";setTimeout(function(){el.style.background="";},1500);}
  // 滚动到观察池卡片,方便用户看到新增
  var card=document.querySelector('.watchlist-card');
  if(card&&card.scrollIntoView){try{card.scrollIntoView({behavior:'smooth',block:'center'});}catch(e){}}
  alert("✓ 已加入观察池: "+data.name);
  var mm=document.getElementById("modal-"+code);
  if(mm)mm.classList.remove("show");
  document.body.style.overflow="";
}
async function fetchKlineF(code, count) {
  count = count || 70;
  try {
    const url = 'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=' + code + ',day,,,' + count + ',qfq';
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const txt = await res.text();
    const j = JSON.parse(txt);
    const series = j && j.data && j.data[code] && (j.data[code].qfqday || j.data[code].day);
    if (Array.isArray(series) && series.length) {
      // 写入浏览器本地缓存(供 CORS/网络失败时兜底)
      try { var kc=JSON.parse(localStorage.getItem('atds_kline_cache')||'{}'); kc[code]={date:new Date().toISOString().slice(0,10),series:series.slice(-120)}; localStorage.setItem('atds_kline_cache',JSON.stringify(kc)); } catch(e2) {}
      return series;
    }
  } catch (e) {}
  // 失败兜底:浏览器本地缓存 → 仓库 data/kline_cache.json(GitHub Pages 同源)
  try { var kc=JSON.parse(localStorage.getItem('atds_kline_cache')||'{}'); if(kc[code]&&kc[code].series&&kc[code].series.length) return kc[code].series; } catch(e) {}
  try { var r=await fetch('data/kline_cache.json',{cache:'no-store'}); if(r.ok){var jc=await r.json(); if(jc[code]&&jc[code].series) return jc[code].series;} } catch(e) {}
  return [];
}
function detectPatternsF(klines) {
  if (!Array.isArray(klines) || klines.length < 65) return null;
  var closes = klines.map(function(k){ return parseFloat(k[2]); });
  var vols = klines.map(function(k){ return parseFloat(k[5]) || 0; });
  var ma = function(arr, n){ var s = 0; for (var i = arr.length - n; i < arr.length; i++) s += arr[i]; return s / n; };
  var ma5 = ma(closes,5), ma10 = ma(closes,10), ma20 = ma(closes,20), ma60 = ma(closes,60);
  var vol5 = ma(vols,5), vol20 = ma(vols,20);
  var last = closes[closes.length-1], lastVol = vols[vols.length-1];
  var pct5 = (last / closes[closes.length-6] - 1) * 100;
  var ma20Prev3 = ma(closes.slice(0,-3), 20);
  var patterns = [];
  var recentAmp = (Math.max.apply(null, closes.slice(-20)) - Math.min.apply(null, closes.slice(-20))) / Math.min.apply(null, closes.slice(-20)) * 100;
  if (last > ma20 && ma20 > ma20Prev3 && lastVol > vol20 * 1.3 && recentAmp < 25) patterns.push('启动');
  if (ma10 > ma20 && ma20 > ma60) {
    var r12 = klines.slice(-12);
    var highs = r12.map(function(k){ return parseFloat(k[3]); });
    var peak = Math.max.apply(null, highs.slice(0,-2));
    var low12 = Math.min.apply(null, r12.map(function(k){ return parseFloat(k[4]); }));
    if (low12 < peak * 0.97 && last > peak && lastVol > vol5 * 1.2) patterns.push('老鸭头');
  }
  if (ma5 > ma10 && ma10 > ma20 && pct5 > 5 && vol5 > vol20 * 1.1) patterns.push('拉升');
  return patterns.length ? { patterns: patterns, pct5: pct5 } : null;
}
async function refreshMarketScan(){
  var list = document.getElementById('ms-list');
  if (!list) { alert('未找到形态扫描模块'); return; }
  list.innerHTML = '<div class="ms-empty">🔄 刷新重扫中，请稍候...</div>';
  // 收集候选代码:页面涨停梯队 + 观察池
  var codes = new Set();
  document.querySelectorAll('.stock-code').forEach(function(el){ var m = (el.textContent||'').match(/\d{6}/); if (m) codes.add(m[0]); });
  document.querySelectorAll('.wl-stock-row[data-code]').forEach(function(r){ var c = r.getAttribute('data-code'); if (c) codes.add(c); });
  if (codes.size < 5) {
    document.querySelectorAll('.da-stock').forEach(function(a){ var c = a.getAttribute('data-code'); if (c) codes.add(c); });
  }
  var arr = Array.from(codes).slice(0, 80);
  var picks = [];
  for (var i = 0; i < arr.length; i++) {
    var code = arr[i];
    var c0 = code.charAt(0);
    var full = c0 === '6' ? 'sh' + code : 'sz' + code;
    var kl = await fetchKlineF(full, 70);
    if (!kl || !kl.length) continue;
    var det = detectPatternsF(kl);
    if (!det) continue;
    picks.push({ code: code, name: code, pct: Math.round(det.pct5*100)/100, patterns: det.patterns, score: Math.min(90, 50 + det.patterns.length*10) });
  }
  if (!picks.length) { list.innerHTML = '<div class="ms-empty">刷新完成，未识别到形态个股（数据源可能仍不可达）</div>'; return; }
  var html = picks.map(function(p, i){ return '<div class="ms-row"><span class="ms-rank">' + (i+1) + '</span><a class="da-stock ms-name" data-code="' + p.code + '" onclick="openStockResearch(this.dataset.code)">' + p.code + '</a><span class="ms-code">' + p.code + '</span><span class="ms-patterns">' + p.patterns.map(function(x){ return '<span class="ms-pattern">' + x + '</span>'; }).join('') + '</span><span class="ms-score">' + p.score + '</span><button class="wl-btn ms-add" data-code="' + p.code + '" onclick="addFetchedToWatchlist(this.dataset.code)">加入</button></div>'; }).join('');
  list.innerHTML = html;
  alert('刷新完成，识别 ' + picks.length + ' 只形态个股');
}
function openRegimeNHList(){
  // 弹窗由后端 renderRegimeNHModal 渲染(名单固定),前端只负责打开与刷新行情
  var m = document.getElementById('regime-nh-modal');
  if (!m) return;
  m.classList.add('show');
  document.body.style.overflow = 'hidden';
  refreshRegimeNH();
}
async function refreshRegimeNH(){
  // 仅批量拉取名单内个股的实时行情,更新现价/涨跌幅(不再重新检测K线)
  var items = document.querySelectorAll('#regime-nh-modal .nh-item[data-code]');
  if (!items.length) return;
  var btn = document.getElementById('nh-refresh-btn');
  if (btn) { btn.disabled = true; btn.textContent = '↻ 刷新中…'; }
  var codes = []; var map = {};
  items.forEach(function(it){ var c = it.getAttribute('data-code'); if (c) { codes.push(c); map[c] = it; } });
  try {
    var batch = [];
    codes.forEach(function(raw){ var c0 = raw.charAt(0); if (c0 === '6') batch.push('sh' + raw); else if (c0 === '4' || c0 === '8' || c0 === '92') batch.push('bj' + raw); else batch.push('sz' + raw); });
    var res = await fetch('https://qt.gtimg.cn/q=' + batch.join(','), { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    var buf = await res.arrayBuffer();
    var text = new TextDecoder('gbk').decode(buf);
    text.split(';').forEach(function(line){
      var m = line.trim().match(/^v_[a-z]+\d+="(.*)"$/); if (!m) return;
      var f = m[1].split('~'); if (f.length < 40) return;
      var code = String(f[2] || '').trim(); if (!map[code]) return;
      var price = parseFloat(f[3]) || 0, pct = parseFloat(f[32]) || 0;
      var it = map[code];
      var cls = pct >= 0 ? 'up' : 'down';
      var priceEl = it.querySelector('.nh-price');
      if (priceEl) { priceEl.className = 'nh-price ' + cls; priceEl.textContent = price.toFixed(2); }
      var pctEl = it.querySelector('.nh-pct');
      if (pctEl) { pctEl.className = 'nh-pct ' + cls; pctEl.textContent = (pct > 0 ? '+' : '') + pct.toFixed(2) + '%'; }
    });
  } catch(e) {}
  if (btn) { btn.disabled = false; btn.textContent = '↻ 刷新行情'; }
}
function closeRegimeNH(){ var m = document.getElementById('regime-nh-modal'); if (m) m.classList.remove('show'); document.body.style.overflow=''; }
function addAllNHToWatchlist(){
  var items = document.querySelectorAll('.nh-item[data-code]');
  var codes = [];
  for (var i = 0; i < items.length; i++) {
    var c = items[i].getAttribute('data-code');
    if (c && !document.querySelector('.wl-stock[data-stock-code="'+c+'"]')) codes.push(c);
  }
  bulkAddToWatchlist(codes, ' 60日新高个股');
}
async function handleSearchStock(){var input=document.getElementById("search-input");if(!input)return;var raw=(input.value||"").trim();window.__atdsUnlocked=true;if(!raw){alert("请输入股票代码或名称（如 600519 / 大北农）");return;}try{
  if(/^\d{6}$/.test(raw)){ // 纯代码:直接查行情
    var data=await fetchStockData(raw);if(!data){alert("未找到股票代码 "+raw);return;}
    closeAllModals();
    if(!document.querySelector('.wl-stock-row[data-code="'+data.code+'"]')){try{await addFetchedToWatchlist(data.code);}catch(e){}}
    showDynamicResearch(data);input.value="";return;
  }
  // 名称/拼音搜索 → 候选列表
  var cands=await searchStockByName(raw);
  if(!cands||!cands.length){alert("未找到股票: "+raw+"，请尝试输入 6 位代码");return;}
  if(cands.length===1){
    var d=await fetchStockData(cands[0].code);if(!d){alert("未找到股票代码 "+cands[0].code);return;}
    closeAllModals();
    if(!document.querySelector('.wl-stock-row[data-code="'+d.code+'"]')){try{await addFetchedToWatchlist(d.code);}catch(e){}}
    showDynamicResearch(d);input.value="";return;
  }
  showStockCandidates(cands,raw);
}catch(e){alert("网络异常："+e.message);}}
async function searchStockByName(q){try{var url="https://smartbox.gtimg.cn/s3/?v=2&q="+encodeURIComponent(q)+"&t=gp&c=8";var res=await fetch(url,{cache:"no-store"});if(!res.ok)return null;var buf=await res.arrayBuffer();var text=new TextDecoder("gbk").decode(buf);var m=text.match(/^v_hint="(.*)"\s*$/);if(!m||!m[1])return null;return m[1].split("^").map(function(seg){var p=seg.split("~");if(p.length<5)return null;return {market:p[0],code:p[1],name:p[2],pinyin:p[3],type:p[4]};}).filter(function(x){return x&&(x.type==="GP-A"||x.type==="GP-B");});}catch(e){return null;}}
function showStockCandidates(cands,q){
  var mask=document.createElement("div");mask.className="modal-mask";mask.style.display="flex";
  mask.onclick=function(ev){if(ev&&ev.target===mask&&mask.parentNode)mask.parentNode.removeChild(mask);};
  var box=document.createElement("div");
  box.style.cssText="background:#fff;border-radius:12px;padding:16px;width:88%;max-width:360px;max-height:70vh;overflow:auto;box-shadow:0 8px 30px rgba(0,0,0,.18);";
  var rows=(cands||[]).map(function(c){
    return '<div class="cand-row" data-code="'+escHtmlF(c.code)+'" style="padding:11px 6px;border-bottom:1px solid #f1f5f9;cursor:pointer;display:flex;justify-content:space-between;align-items:center;"><span style="font-weight:600;">'+escHtmlF(c.name)+'</span><span style="color:#64748b;font-size:12px;">'+escHtmlF(c.code)+'</span></div>';
  }).join("");
  box.innerHTML='<div style="font-weight:700;font-size:15px;margin-bottom:6px;">🔍 搜索结果：<span style="color:#7c3aed;">'+escHtmlF(q)+'</span></div><div style="color:#94a3b8;font-size:12px;margin-bottom:8px;">点击候选加入观察池并显示最新行情</div>'+rows;
  mask.appendChild(box);document.body.appendChild(mask);
  box.querySelectorAll(".cand-row").forEach(function(row){
    row.onclick=function(){var code=row.getAttribute("data-code");if(mask.parentNode)mask.parentNode.removeChild(mask);(async function(){var d=await fetchStockData(code);if(!d){alert("未找到股票代码 "+code);return;}closeAllModals();if(!document.querySelector('.wl-stock-row[data-code="'+d.code+'"]')){try{await addFetchedToWatchlist(d.code);}catch(e){}}showDynamicResearch(d);var inp=document.getElementById("search-input");if(inp)inp.value="";})();};
  });
}
function closeAllModals(){var list=document.querySelectorAll(".modal-mask.show");for(var i=0;i<list.length;i++){list[i].classList.remove("show");}document.body.style.overflow="";}
// 最强主线卡片:点击展开/收起"排除涨停 · 优先可观察前3"
function toggleMdPicks(i){
  var w=document.getElementById("md-picks-"+i);
  if(!w)return;
  var card=w.closest?w.closest(".md-card"):w.parentElement;
  if(card)card.classList.toggle("open");
}
// 今天怎么看 · 5 主题切换(收盘复盘,02 模块);点击 tab 切换 detail
function toggleTwCard(i){
  var tabs=document.querySelectorAll(".tw-tab");
  var details=document.querySelectorAll(".tw-detail");
  for(var j=0;j<tabs.length;j++){
    if(j===i){ tabs[j].classList.add("active"); }else{ tabs[j].classList.remove("active"); }
  }
  for(var j=0;j<details.length;j++){
    if(j===i){ details[j].classList.add("active"); }else{ details[j].classList.remove("active"); }
  }
}
function deriveRiskLevelF(pct){var v=Number(pct)||0;if(v>=5||v<=-5)return{name:'高风险',tone:'high'};if(v>=2||v<=-2)return{name:'中风险',tone:'mid'};return{name:'低风险',tone:'low'};}
function deriveTimeHorizonF(pct,turnover){var v=Number(pct)||0,t=Number(turnover)||0;if(v>=3&&t>=2)return{name:'短线',tone:'short'};if(v>=-1&&v<=3&&t>=0.5)return{name:'波段',tone:'wave'};return{name:'长线',tone:'long'};}
function deriveAdviceF(pct,atds,riskTone){var v=Number(pct)||0,a=Number(atds)||0;if(v<=-5)return{name:'减仓规避',tone:'cut'};if(a>=85&&riskTone!='high')return{name:'重点关注',tone:'focus'};if(a>=70)return{name:'持有观察',tone:'hold'};if(a<60&&v<=-1)return{name:'观望',tone:'wait'};return{name:'持有观察',tone:'hold'};}
function deriveRiskTextF(pct,turnover){var v=Number(pct)||0,t=Number(turnover)||0,lines=[];if(v>=5)lines.push('涨幅>5%,RSI 超买区');else if(v>=2)lines.push('涨幅 2-5%,技术偏强');else if(v>=-1)lines.push('震荡整理,方向未明');else if(v>=-3)lines.push('回调 2-3%,观察支撑');else lines.push('跌幅>3%,风险增大');if(t>=5)lines.push('放量活跃');else if(t>=2)lines.push('量能温和');else if(t>=0.5)lines.push('量能一般');else lines.push('量能偏低');return lines;}
function deriveHorizonLinesF(pct,turnover){var v=Number(pct)||0,t=Number(turnover)||0,sh=v>=3&&t>=2?'回踩 MA5 不破可继续,跌破减仓':v>=1?'区间震荡,顺势做 T,关注 MA10':v<=-3?'下跌趋势,反弹至 MA5 减仓':'区间震荡,关注 MA10 方向选择';var wa=v>=2?'沿 MA20 运行,跌破 MA60 警惕走弱':v<=-2?'跌至 MA20 下方,关注 MA60 是否扣住':'区间震荡,等待 MA20 方向选择';var lo=v>=0?'站上 MA120 偏多,关注 MA250 突破':'跌破 MA120,长线宜减仓观望';return[{k:'短线',v:sh},{k:'波段',v:wa},{k:'长线',v:lo}];}
function deriveAdviceTextF(pct,atds,riskTone){var v=Number(pct)||0,a=Number(atds)||0;if(v<=-5)return'跌幅较大,建议减仓规避';if(a>=85&&riskTone!='high')return'ATDS 证据强,重点关注';if(a>=75&&v>=0)return'持有观察,等待放量催化';if(a<60&&v<=-1)return'技术偏弱,观望等待企稳';if(v>=5)return'高位震荡,逢高减仓为主';return'持有观察,关注量能配合';}
/* ============ 观察池建议五类文案 (2026-09-07) — 前端手动加股同样适用 ============ */
// 文案生成(后端 wlTechAdviceText 的前端版,共用一套规则,确保跨场景一致)
function wlAdviceTextF(t, v, price){
  if (!t || !t.ma5 || !t.ma10 || !t.ma20) return '';
  var p2 = (n) => Number(n).toFixed(2);
  var pctV = v;  // 当日涨幅
  // 1) 高位加速乖离(bias5 > 8 或 pct > 8 且高于 MA5 9% 以上):不追高
  if ((t.bias5 != null && t.bias5 > 8) || (pctV >= 8 && t.ma5 && price > t.ma5 * 1.09)) {
    return '不追高,股价偏离 MA5(' + p2(t.ma5) + ')已达 ' + (t.bias5 || 0).toFixed(1) + '%,等回踩 MA10 附近企稳再买';
  }
  // 2) 均线多头排列 + 缩量回踩到位(nearMa20, 量比<1.1):强势可关注
  if (t.bullArrange && (t.nearMa20 || (t.volRatio != null && t.volRatio < 1.1 && pctV < 3 && pctV >= -2))) {
    return '强势可关注:沿 MA10(' + p2(t.ma10) + ') 上行,回踩 MA10 附近企稳可分批买入,跌破 MA20(' + p2(t.ma20) + ') 严格止损';
  }
  // 3) 放量突破 MA20 初期(MA20 上方 + 量比 > 1.3 + bias5 < 6):放量突破
  if (price > t.ma20 && t.volRatio != null && t.volRatio > 1.3 && (t.bias5 != null && t.bias5 < 6)) {
    return '放量突破 MA20(' + p2(t.ma20) + '),观察 2-3 日站稳后回踩 MA5(' + p2(t.ma5) + ') 确认纳入';
  }
  // 4) 已破位(跌破 MA20):信号观望
  if (price < t.ma20 && t.ma20 > t.ma60) {
    return '信号尚不充分:运行于 MA20(' + p2(t.ma20) + ') 下方,先观望等待趋势进一步明朗';
  }
  // 5) 均线多头 + 区间运行:满足跟踪
  if (t.bullArrange || (t.ma10 > t.ma20 && t.ma20 > t.ma60)) {
    return '满足跟踪条件:沿 MA10(' + p2(t.ma10) + ') 上行,回踩不破可跟踪介入,跌破 MA20(' + p2(t.ma20) + ') 止盈';
  }
  // 兜底:中性
  return '信号尚不充分,先观察几日等待趋势进一步明朗';
}
// 文案 tone(对应红/绿/黄/灰 chip): ok=满足跟踪, mid=强势可关注, break=放量突破, wait=观望, high=不追高
function wlAdviceToneF(t, v){
  var txt = wlAdviceTextF(t, v, 0);
  if (txt.indexOf('不追高') >= 0) return { name: '不追高', tone: 'high' };
  if (txt.indexOf('放量突破') >= 0) return { name: '放量突破', tone: 'break' };
  if (txt.indexOf('强势可关注') >= 0) return { name: '强势可关注', tone: 'mid' };
  if (txt.indexOf('满足跟踪') >= 0) return { name: '满足跟踪', tone: 'ok' };
  return { name: '观望等待', tone: 'wait' };
}

function escHtmlF(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
// 自动生成 watchlist 字段模板(手动添加个股用,基于实时行情 + 可选 K 线技术画像)
function autoGenStrategy(s,v,atds,turnover,tech){
  tech = tech || null;
  var price=Number(s.price)||0;
  // 关键位:有 tech 用 MA20/MA10/MA5,无 tech 回退到 ±8%
  var support = tech && tech.ma20 ? Number(tech.ma20).toFixed(2) : (price*0.92).toFixed(2);
  var pressure = tech && tech.ma10 ? Math.max(Number(tech.ma10)*1.04, price*1.06).toFixed(2) : (price*1.08).toFixed(2);
  var stopLoss = tech && tech.ma20 ? Math.min(price*0.95, Number(tech.ma20)*0.97).toFixed(2) : (price*0.95).toFixed(2);
  // 策略字段模板
  var logic;
  if (tech) {
    if (tech.bullArrange) logic = '均线多头排列(MA5>MA10>MA20>MA60),趋势向上,回踩可跟踪';
    else if (price < tech.ma20) logic = '现价跌破 MA20(' + Number(tech.ma20).toFixed(2) + '),趋势走弱,观望';
    else if (tech.bias5 != null && tech.bias5 > 8) logic = '短期乖离大,股价偏离 MA5 ' + tech.bias5.toFixed(1) + '%,不宜追高';
    else logic = '现价运行于 MA10(' + Number(tech.ma10).toFixed(2) + ')与 MA20(' + Number(tech.ma20).toFixed(2) + ')之间,关注方向选择';
  } else {
    logic = v>=5?'强势突破,关注量能持续性':
             v>=2?'强势承接,技术偏强':
             v>=-1?'震荡整理,方向待确认':
             v>=-3?'回调观察,关注支撑位':
             '弱势回调,严格控制仓位';
  }
  var capital=turnover>=5?'主力活跃,换手率 '+s.turnover+'%,资金博弈加剧':
                turnover>=2?'换手温和('+s.turnover+'%),资金参与一般':
                turnover>=0.5?'换手一般('+s.turnover+'%)':
                '换手偏低('+s.turnover+'%),关注资金异动';
  var keyLevels='支撑 ' + support + ' / 压力 ' + pressure;
  // 操作建议:基于 ATDS + 风险等级
  var planEntry=atds>=85?'重点关注,可参与':
                atds>=70?'持有观察,等待催化':
                atds>=60?'中性观望,等放量确认':
                '建议观望,等待企稳';
  var entryPrice=tech && tech.ma10 ? '回踩 MA10(' + Number(tech.ma10).toFixed(2) + ') 附近低吸' :
                 v>=3?'突破当前价 '+price+' 跟进':
                 v<=-3?'回踩 '+support+' 附近低吸':
                 '区间震荡 '+support+' - '+pressure;
  var entryPos=atds>=85?'中等仓位':
                atds>=70?'轻仓试错':
                '保守仓位';
  var entryNote=tech && tech.ma20 ? '跌破 MA20(' + Number(tech.ma20).toFixed(2) + ') 严格止损,执行纪律' : '参考风险等级与资金面,严格执行止损';
  var stopLossStr=stopLoss+' · 清仓';
  var takeProfitStr=tech && tech.ma10 ? '站稳 MA10(' + Number(tech.ma10).toFixed(2) + ') 趋势延伸' : (v>=0?'站稳 '+pressure+' 趋势延伸':'跌破 '+support+' 走弱减仓');
  var targetStr=tech ? (price + ' → ' + pressure + ' / 下一压力 MA5 上方') : (price + ' → ' + pressure);
  var riskStr='买入区 '+price+',止损 '+stopLoss+'。跌破止损必须走,不恋战。';
  return {
    logic:logic, capital:capital, keyLevels:keyLevels,
    plan:planEntry+',关注 '+entryPrice+' 机会',
    strategy:{entryStrategy:v>=3?'突破追涨':'回踩低吸',entryPrice:entryPrice,entryPosition:entryPos,entryNote:entryNote,stopLoss:stopLossStr,takeProfit:takeProfitStr,target:targetStr,risk:riskStr},
    todayStrategy:{
      core:tech && tech.bullArrange ? '均线多头排列,持股观察,沿MA10分批介入' : (v>=2?'不追高,等回踩确认后再参与':'已回调,可分批低吸,严控仓位'),
      planA:{title:'求稳回踩',content:tech ? '回踩 MA10(' + Number(tech.ma10).toFixed(2) + ') 附近低吸,严控仓位在 20-30%' : '回踩 '+support+' 附近低吸,严控仓位在 20-30%'},
      planB:{title:'突破确认',content:'放量突破 '+pressure+' 加仓,确认趋势后看高 5-8%'},
      choice:'先做方案 A 求稳,跌破 '+stopLoss+' 立即止损',
      position:'总仓位控制在回笼资金的 20% 以内,单股严控',
      alert:'若板块整体走弱或大盘破位,放弃买入等待'
    }
  };
}
// 单独渲染 detail 区(供 refreshWatchlistQuotes 复用,保证手动添加个股 detail 也跟随最新行情)
// 交易决策卡(主卡片+复盘卡):镜像云端 buildStockRow 的 detail 结构,真实数据 + 量化盈亏比/置信度/仓位
function buildDecisionCardHtml(s){
  s=s||{};
  var t=s.tech||{};
  var ff=s.fundFlow||{};
  var price=Number(s.price)||0;
  var pct=Number(s.pct)||0;
  function f2(x){return (x==null||isNaN(x))?'--':Number(x).toFixed(2);}
  function sign(x){return (x==null||isNaN(x))?'':(x>0?'+':'');}
  // 关键位动态转换:现价<均线→压力,现价>均线→支撑(修复"跌破均线仍显示支撑"Bug);去重 + ±20% 过滤
  function splitLvls(){
    var all=(Array.isArray(t.supports)?t.supports:[]).concat(Array.isArray(t.pressures)?t.pressures:[]);
    var seen={},sup=[],pre=[];
    for(var i=0;i<all.length;i++){
      var x=all[i];
      if(!x||x.price==null||isNaN(x.price))continue;
      var k=x.price.toFixed(2);
      if(seen[k])continue;seen[k]=1;
      if(price>0&&Math.abs(x.price-price)/price>0.20)continue;
      if(x.price<price)sup.push(x);else if(x.price>price)pre.push(x);
    }
    sup.sort(function(a,b){return b.price-a.price;});
    pre.sort(function(a,b){return a.price-b.price;});
    return {sup:sup,pre:pre};
  }
  function supStrong(){var a=splitLvls().sup;for(var i=0;i<a.length;i++){if(a[i].weight==='strong')return a[i];}return a[0]||null;}
  function preStrong(){var a=splitLvls().pre;for(var i=0;i<a.length;i++){if(a[i].weight==='strong')return a[i];}return a[0]||null;}
  var sup=supStrong(), pre=preStrong();
  var supPrice=sup?sup.price:(t.ma20||price*0.96);
  var prePrice=pre?pre.price:(t.ma5||price*1.05);
  var entry=(supPrice<price)?supPrice:price;
  var atr=t.atr14||(price*0.03);
  var stop=entry-Math.max(atr,entry*0.03);
  var target=prePrice>entry?prePrice:(entry*1.06);
  var rr=(target-entry)/(entry-stop);
  var rrNow=(price>stop)?(target-price)/(price-stop):0;
  var stopPct=entry>0?(entry-stop)/entry*100:3;
  var p={entry:entry,stop:stop,target:target,rr:rr,rrNow:rrNow,stopPct:stopPct,sup:sup,pre:pre,atr:atr};
  function rrTone(r){return r>=2?'good':r>=1.5?'ok':r>=1?'warn':'bad';}
  // 置信度(趋势30/资金25/题材20/关键位15/盈亏比10)
  var trendScore=t.trend==='up'?30:t.trend==='repair'?20:t.trend==='flat'?12:5;
  var fundScore=12;
  if((ff.d1||0)>0)fundScore+=6;
  if((ff.d3||0)>0)fundScore+=4;
  var vr=Number(s.volRatio)||(t.volRatio||1);
  if(vr>=1.3)fundScore+=3;
  fundScore=Math.min(25,fundScore);
  var themeScore=8;
  if(s.category)themeScore+=6;
  if(Array.isArray(s.tags)&&s.tags.length)themeScore+=4;
  themeScore=Math.min(20,themeScore);
  var keyScore=6;
  if(p.sup&&price<=p.sup.price*1.03)keyScore+=6;
  if(p.pre&&price>=p.pre.price*0.97)keyScore+=3;
  keyScore=Math.min(15,keyScore);
  var rrScore=p.rr>=2?10:p.rr>=1.5?7:p.rr>=1?4:0;
  var confTotal=Math.round(trendScore+fundScore+themeScore+keyScore+rrScore);
  // 仓位计算器:单笔风险0.5%-1% ÷ 止损幅度,单股15%硬顶
  var stopPctMax=Math.max(p.stopPct,1);
  var rawLow=0.5/stopPctMax*100, rawHigh=1/stopPctMax*100;
  var posCapped=rawHigh>15;
  var pos={low:Math.min(Math.round(rawLow),15),high:Math.min(Math.round(rawHigh),15),capped:posCapped,stopPct:Math.round(stopPctMax*10)/10};
  var confTone=confTotal>=75?'good':confTotal>=60?'ok':'warn';
  var statusLabel=confTotal>=75?'可交易':confTotal>=60?'轻仓试错':'观察';
  var priority=confTotal>=75&&p.rr>=2?'★★★':confTotal>=60?'★★':'★';
  var rrToneVal=rrTone(p.rr);
  // 催化/阶段/地位/分歧(提前计算 tags/divergence,供"一致加速→开盘预期"联动与题材具体化)
  var tagsArr=Array.isArray(s.tags)?s.tags:[];
  var divergence=pct>=5&&vr>=1.3?'一致加速':vr>=1.5?'分歧换手':vr<0.8?'缩量一致':'正常换手';
  // 开盘预期(基于昨收/今开/均价);分歧=一致加速时强制修正
  var gapPct=(s.prevClose>0&&s.open>0)?((s.open-s.prevClose)/s.prevClose*100):null;
  var accelOpenPct=Math.max(1,pct*0.5);
  var openExpect=divergence==='一致加速'
    ?'一致加速：高开需达'+accelOpenPct.toFixed(1)+'%以上才符合预期（基于昨日涨幅推算），若大幅低开则警惕情绪反转'
    :(gapPct==null?'--':(gapPct>=2?'高开'+gapPct.toFixed(1)+'%·防冲高回落':gapPct<=-2?'低开'+gapPct.toFixed(1)+'%·看承接':'平开±2%·看方向'));
  var falsify=p.sup?('跌破'+f2(p.sup.price)+'('+(p.sup.label||'强支撑')+')且无法收回 → 逻辑失效'):'跌破近期低点且无法收回 → 逻辑失效';
  // 板块地位(首选→板块龙头/稳健→中军/其余→跟风) + 核心概念具体化(种业/天然气/地产链等)
  var boardStatus=(tagsArr.join('').indexOf('首选')>=0)?'板块龙头':(tagsArr.join('').indexOf('稳健')>=0)?'中军':'跟风';
  var catalystTxt=(s.logic||'')+(s.category||'')+(s.name||'')+tagsArr.join(' ');
  var concept=(function(){
    var m=[['种业',/转基因|种子|种业/],['种植/土地',/种植|土地流转|耕地/],['天然气',/燃气|天然气|LNG|油气管网/],['地产链',/地产|房地产|物业|城中村|基建/],['光模块',/光模块|海缆|光通信|旭创|新易盛/],['算力',/算力|CPO|AI算力|数据中心/],['机器人',/机器人|减速器|人形/],['传媒/IP',/传媒|IP|游戏|影视|出版/],['稀土',/稀土|永磁|盛和|北方稀土/],['小金属',/小金属/],['军工',/军工|航天|国防|天银/],['半导体材料',/半导体|芯片|集成电路|国瓷|电子陶瓷|MLCC/],['新能源',/光伏|储能|锂电|新能源/],['农业',/农业|农牧|养殖|粮食|生猪/],['医药',/美诺华|医药|创新药|医疗|制药/],['证券',/证券|券商/],['银行',/银行/],['保险',/保险/]];
    for(var i=0;i<m.length;i++){if(m[i][1].test(catalystTxt))return m[i][0];}
    return s.category||'题材';
  })();
  var catalyst=concept;
  var ferment=pct>=7?'高潮/加速':pct>=3?'发酵':(pct>=0&&t.trend==='up')?'启动':pct<-2?'退潮':'混沌';
  // 时效/情绪周期/容错率(手动标签优先,否则派生)
  var catalystTime=s.catalystTime||((boardStatus.indexOf('龙头')>=0)?'波段1-2周':'短线1-3天');
  var emotionCycle=ferment==='高潮/加速'?'加速':ferment==='退潮'?'退潮':ferment==='发酵'?'发酵':ferment==='启动'?'修复':'冰点';
  var tolerance=boardStatus.indexOf('龙头')>=0?'容错高':boardStatus.indexOf('中军')>=0?'容错中':'容错低';
  // 冲突提示(滞涨/跟风不足/龙头走弱)
  var conflicts=[];
  if(ff.d1!=null&&ff.d1>0&&pct<=0.3)conflicts.push('资金流入但价不涨·滞涨风险');
  if((s.category||tagsArr.length)&&pct<0)conflicts.push('题材强但个股弱·跟风不足');
  if(pct<=-5)conflicts.push('个股大跌·若为板块龙头需防带崩情绪');
  var trendLabel=t.trend==='up'?'多头':t.trend==='repair'?'修复':t.trend==='down'?'空头':'震荡';
  var weeklyLabel=t.weeklyTrend==='up'?'周线向上':t.weeklyTrend==='down'?'周线向下':'周线走平';
  var _lv=splitLvls();
  var supList=_lv.sup;
  var preList=_lv.pre;
  var supHtml=supList.slice(0,3).map(function(x){return '<span class="lv lv-s'+(x.weight==='strong'?' lv-strong':'')+'">'+f2(x.price)+'<i>'+escHtmlF(x.label)+'</i></span>';}).join('')||'<span class="lv">--</span>';
  var preHtml=preList.slice(0,3).map(function(x){return '<span class="lv lv-p'+(x.weight==='strong'?' lv-strong':'')+'">'+f2(x.price)+'<i>'+escHtmlF(x.label)+'</i></span>';}).join('')||'<span class="lv">--</span>';
  var gapHtml=t.gapUp?('向上缺口 '+f2(t.gapUp.level)+(t.gapUp.filled?'·已回补':'·未回补')):(t.gapDown?('向下缺口 '+f2(t.gapDown.level)+(t.gapDown.filled?'·已回补':'·未回补')):'无近期缺口');
  // 资金量能 (d1/d3/d5 null → 显示「数据暂缺」而非 --亿;fromCache 标记缓存数据)
  var ffMissTip=' title="数据源抽风，已降级读取本地缓存，但仍无缓存数据，决策受限"';
  var ffCacheTip=' title="数据源抽风，已降级读取本地缓存'+(ff.cacheDate?'（'+ff.cacheDate+'）':'')+'，数据可能滞后"';
  function ffCell(v,label){
    var miss=(v==null||isNaN(v));
    var tip=miss?ffMissTip:(ff.fromCache?ffCacheTip:'');
    var tone=miss?'':(v>=0?'up':'down');
    var txt=miss?'<i class="ff-missing">数据暂缺</i>':(sign(v)+v.toFixed(2)+'亿'+(ff.fromCache?'<i class="ff-cache">缓存</i>':''));
    return '<span>'+label+' <b class="'+tone+'"'+tip+'>'+txt+'</b></span>';
  }
  var fundHtml=ffCell(ff.d1,'主力净流入')+ffCell(ff.d3,'3日')+ffCell(ff.d5,'5日');
  var tvol=t.volChgPct;
  var volChgTxt=tvol!=null?(tvol>=0?'+':'')+tvol.toFixed(1)+'%':'--';
  var volChgCls=tvol!=null?(tvol>=0?'up':'down'):'';
  var volHtml='<span>量比 <b>'+((Number(s.volRatio)||t.volRatio||'--'))+'</b></span>'+
    '<span>换手 <b>'+escHtmlF(s.turnover||'--')+'%</b></span>'+
    '<span>较昨日量 <b class="'+volChgCls+'">'+volChgTxt+'</b></span>'+
    '<span>振幅 <b>'+(Number(s.amplitude)?Number(s.amplitude).toFixed(2)+'%':'--')+'</b></span>'+
    '<span>分歧 <b>'+escHtmlF(divergence)+'</b></span>';
  // 竞价(真实:高开/低开幅度 + 开盘后承接/抛压)
  var auctionHtml=(function(){
    if(!s.prevClose||!s.open)return '竞价 --';
    var gp=(s.open-s.prevClose)/s.prevClose*100;
    var gptxt=gp>=2?'高开'+gp.toFixed(1)+'%':gp<=-2?'低开'+gp.toFixed(1)+'%':'平开'+(gp>=0?'+':'')+gp.toFixed(1)+'%';
    var after=price>s.open?'承接强':price<s.open?'抛压重':'平走';
    return '竞价 '+gptxt+' · 开盘后'+after;
  })();
  // 封单(真实:涨停池匹配)
  var seal=s.seal||null;
  var sealHtml=seal
    ?'<span>封单 <b class="up">'+(seal.sealFund/1e8).toFixed(2)+'亿</b></span><span>连板 <b class="up">'+seal.lbc+'板</b></span><span>炸板 <b>'+seal.zbc+'次</b></span>'
    :'<span>封单 <b>非涨停</b></span>';
  // 量化风险信号(可观测规则) + 大盘强弱(总仓位上限)
  var riskSignals=s.riskSignals||[];
  if(!riskSignals.length){
    if(pct<=-7&&(t.volChgPct>30||vr>1.5))riskSignals.push('单日放量下跌超7%');
    if(seal&&seal.zbc>0)riskSignals.push('炸板'+seal.zbc+'次');
    if(t.ma5&&price<t.ma5)riskSignals.push('现价跌破MA5');
    if(t.ma20&&price<t.ma20&&t.trend==='down')riskSignals.push('跌破MA20趋势转弱');
  }
  var mr=s.marketRegime||{label:'震荡',capPct:50};
  // 龙虎榜(真实:机构/游资/北向净买)
  var lhb=s.lhb||null;
  var lhbHtml=lhb
    ?'龙虎榜('+escHtmlF(lhb.date)+')：机构 <b class="'+((lhb.inst||0)>=0?'up':'down')+'">'+((lhb.inst||0)>=0?'+':'')+((lhb.inst!=null?lhb.inst:0).toFixed(2))+'亿</b> · 游资 <b class="'+((lhb.youzi||0)>=0?'up':'down')+'">'+((lhb.youzi||0)>=0?'+':'')+((lhb.youzi!=null?lhb.youzi:0).toFixed(2))+'亿</b> · 北向 <b class="'+((lhb.north||0)>=0?'up':'down')+'">'+((lhb.north||0)>=0?'+':'')+((lhb.north!=null?lhb.north:0).toFixed(2))+'亿</b>'+(lhb.fundAttr?' · 属性 <b>'+escHtmlF(lhb.fundAttr)+'</b>':'')+(lhb.famousSeats&&lhb.famousSeats.length?'<br>知名席位：'+escHtmlF(lhb.famousSeats.slice(0,2).join('、')):'')+'<br>'+escHtmlF(lhb.explain)
    :'龙虎榜：近期未上榜';
  // 60/15分钟趋势(真实,含MA10/MA5具体价位)
  var m60=(s.minTrend&&s.minTrend.m60)||null;
  var m15=(s.minTrend&&s.minTrend.m15)||null;
  function minLabel(m){if(!m)return '震荡(近似)';var dir=m.trend==='up'?'多头':m.trend==='down'?'空头':'震荡';var ma=m.ma10!=null?('MA10 '+m.ma10):(m.ma5!=null?('MA5 '+m.ma5):'');var fb=m.cached?'·缓存':(m.approx?'·日线近似':'');return ma?(dir+'('+ma+')'+fb):(dir+fb);}
  function minApprox(m){return !m||m.approx;}
  function minWrap(m){var txt=minLabel(m);if(minApprox(m))return '<span class="min-approx" title="分钟级数据缺失，此为由日线推算的近似趋势，仅供参考">'+txt+'<i class="min-approx-ico">ⓘ</i></span>';return '<span>'+txt+'</span>';}
  var minTxt='60分 '+minWrap(m60)+' · 15分 '+minWrap(m15);
  // 事件风险(真实:东财财报/解禁 + 巨潮减持/增发/回购/股东大会/监管问询;3天内高影响标红)
  var evs=s.events||null;
  var evStatus=s.eventsStatus||{};
  var evEmpty=(evStatus.cninfo==='fail')?'<span class="ev">数据源暂时不可用，请自行前往巨潮资讯网查询</span>':'<span class="ev">近期无重大事件公告</span>';
  var evHtml=(evs&&evs.length)
    ?evs.slice(0,5).map(function(e){var red=(e.level==='高'&&e.left>=-3&&e.left<=3)?' ev-red-alert':'';var cnt=e.left>0?(' T-'+e.left+'天'):(e.left<0?(' '+Math.abs(e.left)+'天前'):' 今日');var short=(e.name&&e.name.length>14)?(e.name.slice(0,14)+'…'):(e.name||'');return '<span class="ev ev-'+(e.level==='高'?'h':e.level==='中'?'m':'l')+' '+(e.dir==='利好'?'ev-good':e.dir==='利空'?'ev-bad':'')+red+'" title="'+escHtmlF(e.detail||e.date||'')+'">'+escHtmlF(e.type)+(short?'·'+escHtmlF(short):'')+cnt+(e.dir!=='中性'?'·'+escHtmlF(e.dir):'')+(e.source?'〔'+escHtmlF(e.source)+'〕':'')+'</span>';}).join('')
    :evEmpty;
  var evNote=(evStatus.cninfo==='fail')?'⚠ 巨潮公告源暂时不可用，减持/增发/回购/问询等已降级；财报/解禁来自东财':'来源：巨潮公告(减持/增发/回购/股东大会/问询) + 东财事件日历(财报/解禁)';
  // 交易计划表(方案A/B/C;未触发方案盈亏比置灰+未触发标签;做T用ATR动态止损)
  var planBEntry=pre?pre.price:(price*1.05);
  var planBStop=planBEntry*0.97, planBTarget=planBEntry*1.08;
  var planBRR=(planBTarget-planBEntry)/(planBEntry-planBStop);
  var atrC=p.atr||(price*0.03);
  // 对称止损止盈 → 盈亏比恒为 1.00;用同一 tDist 避免浮点误差导致个别股票 tRR 略>1 而误显 C 行
  var tDist=Math.max(0.5*atrC,price*0.01);
  var tStop=price-tDist;
  var tTgt=price+tDist;
  var tRR=1;
  var tRRBad=tRR<1.5;
  var tRRHide=tRR<=1.0;
  var trigA=price<=p.entry, trigB=price>=planBEntry, trigC=price>0;
  // 情绪周期与硬逆势判定(提前到此,供状态覆盖与折叠使用)
  var isHardTrade=(emotionCycle==='冰点'&&t.trend==='down'&&(ff.d1||0)<0);
  // 复盘形态:长上影线/大幅冲高回落识别 —— (最高-现价)>3% 且 现价<开盘价(提前到此,供状态降级与形态/资金文案使用)
  var upperShadow=(s.high>0&&price>0&&s.open>0&&((s.high-price)/price*100>3)&&price<s.open);
  // 状态机强制覆盖(致命防呆):现价盈亏比不合格 或 方案A/B均未触发 → 禁止"可交易/轻仓试错",强制"等待触发/高风险观察"
  var rrNowBad=p.rrNow<1.5;
  var abUnTriggered=!trigA&&!trigB;
  var riskDowngrade=tRRBad&&(ff.d1||0)<0;
  var effStatusLabel, effConfTone;
  if(isHardTrade){effStatusLabel='不建议参与';effConfTone='down';}
  else if(upperShadow){effStatusLabel='高风险观察';effConfTone='down';}
  else if(riskDowngrade){effStatusLabel='高风险观察';effConfTone='down';}
  else if(rrNowBad||abUnTriggered){effStatusLabel='等待触发';effConfTone='down';}
  else{effStatusLabel=statusLabel;effConfTone=confTone;}
  // 盈亏比状态绑定:未触发/非"可交易" → 置灰 + "预案盈亏比"提示;仅"可交易"显示绿色
  var rrActionable=(effStatusLabel==='可交易');
  var rrHeadCls=rrActionable?('rr-'+rrToneVal):'rr-muted';
  var rrHeadTitle=rrActionable?'':' title="为预案盈亏比，需回踩触发后生效，现价买入无效"';
  var shouldCollapsePlan=isHardTrade||abUnTriggered;
  var collapseLabel=isHardTrade?'⛔ 破位·严禁现价抄底':'⛔ 等待触发·未达入场条件';
  function planRow(name,trig,entryV,stopV,tgtV,rrVal,triggered,tone,bad){return '<tr class="'+(triggered?'':'tp-notrig')+'"><td class="tp-name">'+name+'</td><td class="tp-trig">'+escHtmlF(trig)+'</td><td class="tp-num">'+f2(entryV)+'</td><td class="tp-num stop">'+f2(stopV)+'</td><td class="tp-num">'+f2(tgtV)+'</td><td class="tp-rr '+(!triggered?'tp-rr-muted':(bad?'rr-bad':'rr-'+tone))+'">'+(triggered?rrVal.toFixed(2):'未触发')+'</td></tr>';}
  var planTable='<table class="tp-table"><tr><th>方案</th><th>触发条件</th><th>入场</th><th>止损</th><th>止盈</th><th>盈亏比</th></tr>'+
    planRow('A 回踩低吸','回踩'+f2(p.entry)+'企稳',p.entry,p.stop,p.target,p.rr,trigA,rrTone(p.rr))+
    planRow('B 突破确认','放量突破'+f2(planBEntry),planBEntry,planBStop,planBTarget,planBRR,trigB,rrTone(planBRR))+
    (tRRHide?'':planRow('C 日内做T','现价'+f2(price)+'·ATR'+f2(atrC)+'动态止损',price,tStop,tTgt,tRR,trigC,rrTone(tRR),tRRBad))+
    '</table>';
  var nowWarn=p.rrNow<1.5
    ?'<div class="tp-warn">⚠ 现价直接买入盈亏比 '+p.rrNow.toFixed(2)+'(<1.5),不合格 —— 等待回踩至 '+f2(p.entry)+' 再执行,当前仅观察。</div>'
    :'<div class="tp-warn tp-ok">现价盈亏比 '+p.rrNow.toFixed(2)+',可执行计划。</div>';
  var tRRBadWarn=tRRBad?'<div class="tp-warn tp-warn-bad">⚠ 盈亏比不合格，做T风险极高，建议放弃。</div>':'';
  // 复盘
  var keyVerify='最高'+f2(s.high)+' '+((pre&&s.high>=pre.price)?('触及压力'+f2(pre.price)):'未触及压力')+' · 最低'+f2(s.low)+' '+((sup&&s.low<=sup.price)?('触及支撑'+f2(sup.price)):'未触及支撑');
  var secChg=s.sectorChange||null;
  var stockPctN=Number(s.pct)||0;
  // 主力净流入极小(<0.1亿)且缩量滞涨 → "微幅流入,买方承接极弱,需警惕滞涨"(替代"符合做多预期"的乐观误读)
  var isMicroInflow=(ff.d1!=null&&ff.d1>0&&ff.d1<0.1);
  var isShrinking=(t.volRatio!=null&&t.volRatio<0.75);
  var isFlatPrice=Math.abs(stockPctN)<=0.3;
  // 数据缺失致命防呆:d1 为 null/-- 时禁止"符合做多预期"误判
  var d1Missing=(ff.d1==null||isNaN(ff.d1));
  var fundVerify;
  if(d1Missing){
    fundVerify='资金数据加载失败/暂缺（数据源抽风，已降级读取本地缓存仍无数据），无法验证做多预期，当前仅观察';
  }else if(upperShadow&&(ff.d1||0)>0){
    fundVerify='主力净流入当日'+sign(ff.d1)+ff.d1.toFixed(2)+'亿，资金逆势流入，存在试盘可能';
  }else if(isMicroInflow&&isShrinking&&isFlatPrice){
    fundVerify='主力净流入当日'+sign(ff.d1)+ff.d1.toFixed(2)+'亿，微幅流入，买方承接极弱，需警惕滞涨';
  }else{
    fundVerify='主力净流入当日'+sign(ff.d1)+(ff.d1!=null?ff.d1.toFixed(2):'--')+'亿，'+(((ff.d1||0)>=0)?'符合做多预期':'与做多预期背离，需复核');
  }
  if(secChg&&secChg.changePct!=null&&!isNaN(secChg.changePct)){
    var diff=stockPctN-secChg.changePct;
    var cmp=diff<=-0.5?'弱于板块，弱势特征明显':(diff>=0.5?'强于板块，具备相对强度':'与板块基本同步');
    fundVerify+='；个股 '+(stockPctN>0?'+':'')+stockPctN.toFixed(2)+'% vs '+escHtmlF(secChg.boardName)+'板块 '+(secChg.changePct>0?'+':'')+secChg.changePct.toFixed(2)+'%，'+cmp;
  }
  // 资金数据来自本地缓存时,明确提示滞后(避免把 stale 数据当实时做多预期)
  if(ff.fromCache){
    fundVerify+='；资金数据来自本地缓存'+(ff.cacheDate?'（'+ff.cacheDate+'）':'')+'，可能滞后';
  }
  var nextDayFocus;
  if(t.ma5&&price){
    var ma5GapPct=Math.abs(price-t.ma5)/t.ma5*100;
    if(ma5GapPct>3){
      var supRef=(p.sup&&p.sup.price)?p.sup.price:(t.ma20||price*0.97);
      nextDayFocus='明日观察能否在'+f2(supRef)+'（支撑位）止跌企稳，否则继续观望。';
    }else if(price<t.ma5){
      nextDayFocus='明日观察能否放量收复MA5（'+f2(t.ma5)+'），若不能，继续观望。';
    }else{
      nextDayFocus='明日观察能否站稳MA5（'+f2(t.ma5)+'）并放量上攻，若失守则减仓。';
    }
  }else{
    nextDayFocus='明日观察量能与MA5得失，方向未明前继续观望。';
  }
  // 复盘形态判定(资金方向区分):长上影线 + 主力净流入 = 冲高回落但资金逆势流入(试盘);长上影线 + 净流出 = 抛压极重空头占优
  var patternHtml='';
  if(upperShadow){
    if((ff.d1||0)>0){
      patternHtml='<div class="dc-line dc-pattern">形态判定：今日冲高回落收长上影线，但资金逆势流入，存在试盘可能，需警惕次日的低开或补跌。</div>';
    }else{
      patternHtml='<div class="dc-line dc-pattern">形态判定：今日大幅冲高回落，收长上影线，上方抛压极重，空头占优。</div>';
    }
  }

  // 情绪总纲建议(硬逆势):强烈建议不参与(emotionCycle/isHardTrade 已在上面状态机处计算)
  var summaryHtml=isHardTrade?'<div class="dc-summary">⛔ 情绪冰点+趋势空头+主力流出，属于高难度逆势标的，系统强烈建议不参与，仅作观察。</div>':'';
  // 数据完整性校验(资金/关键位/龙虎榜/分钟线 任一缺失 → 标黄)
  var diMissing=[];
  if(d1Missing)diMissing.push('资金');
  if(!t.ma5)diMissing.push('关键位');
  if(!s.lhb)diMissing.push('龙虎榜');
  if(s.minTrend&&((s.minTrend.m60&&s.minTrend.m60.approx)||(s.minTrend.m15&&s.minTrend.m15.approx)))diMissing.push('分钟线');
  var integrityBadge=diMissing.length===0
    ?'<span class="dc-integrity ok" title="资金/关键位/龙虎榜/分钟线均已加载">✓ 数据完整</span>'
    :'<span class="dc-integrity warn" title="缺失:'+diMissing.join('、')+' · 决策受限,谨慎交易">⚠ 数据暂缺·'+diMissing.join('/')+'</span>';

  return '<div class="dc-head">'+
    '<span class="dc-pri">'+priority+'</span>'+
    '<span class="dc-name">'+escHtmlF(s.name)+' <i>'+escHtmlF(s.code)+'</i></span>'+
    '<span class="dc-status '+((effConfTone==='good')?'up':(effConfTone==='ok')?'':'down')+'">'+effStatusLabel+'</span>'+
    integrityBadge+
    '<span class="dc-conf">置信度 '+confTotal+'</span>'+
    '<span class="dc-rr '+rrHeadCls+'"'+rrHeadTitle+'>盈亏比 '+p.rr.toFixed(2)+'</span>'+
    '<span class="dc-time">'+new Date().toLocaleString('zh-CN',{hour12:false})+'</span>'+
    '</div>'+summaryHtml+
    '<div class="dc-tags">'+(s.category?'<span class="dc-tag">'+escHtmlF(s.category)+'</span>':'')+tagsArr.map(function(x){return '<span class="dc-tag">'+escHtmlF(x)+'</span>';}).join('')+'<span class="dc-tag">催化:'+escHtmlF(catalyst)+'</span><span class="dc-tag">时效:'+escHtmlF(catalystTime)+'</span><span class="dc-tag">阶段:'+escHtmlF(ferment)+'</span><span class="dc-tag">情绪:'+escHtmlF(emotionCycle)+'</span><span class="dc-tag">地位:'+escHtmlF(boardStatus)+'</span><span class="dc-tag">'+escHtmlF(tolerance)+'</span></div>'+
    (s.logic?'<div class="dc-block"><div class="dc-h">📐 逻辑与催化</div><div class="dc-line">'+escHtmlF(s.logic)+'</div></div>':'')+
    '<div class="dc-block"><div class="dc-h">💰 资金与量能</div>'+
      '<div class="dc-line">'+fundHtml+'</div>'+
      '<div class="dc-line">'+volHtml+'</div>'+
      '<div class="dc-line">'+auctionHtml+'</div>'+
      '<div class="dc-line">'+sealHtml+'</div>'+
      '<div class="dc-line">'+lhbHtml+'</div>'+
    '</div>'+
    '<div class="dc-block"><div class="dc-h">🎯 关键位与多周期</div>'+
      '<div class="dc-line">支撑 '+supHtml+'</div>'+
      '<div class="dc-line">压力 '+preHtml+'</div>'+
      '<div class="dc-line">缺口 '+escHtmlF(gapHtml)+' · ATR '+f2(t.atr14)+' · '+escHtmlF(trendLabel)+' · '+escHtmlF(weeklyLabel)+' · '+minTxt+'</div>'+
      '<div class="dc-line">开盘预期 '+escHtmlF(openExpect)+'</div>'+
    '</div>'+
    '<div class="dc-block"><div class="dc-h">📅 事件风险</div><div class="dc-line dc-events">'+evHtml+'</div><div class="dc-line dc-src-note">'+evNote+'</div></div>'+
    '<div class="dc-block dc-plan '+(shouldCollapsePlan?'dc-plan-collapsed':'')+'">'+
      '<div class="dc-h dc-plan-toggle" onclick="togglePlanBlock(this)">📋 今日交易计划（量化）<span class="dc-plan-caret">'+(shouldCollapsePlan?'▸':'▾')+'</span>'+(shouldCollapsePlan?'<span class="dc-plan-lock">'+collapseLabel+'</span><span class="dc-plan-expand">👆 点击展开</span>':'')+'</div>'+
      '<div class="dc-plan-body">'+planTable+tRRBadWarn+nowWarn+
      '<div class="dc-line">仓位:单笔风险0.5%-1% ÷ 止损'+pos.stopPct+'% → 建议仓位 <b>'+pos.low+'%-'+pos.high+'%</b>'+(pos.capped?'（受单股上限压制，实际最高仓位15%）':'（单股≤15%、单题材≤30%）')+'</div>'+
      '<div class="dc-line dc-disc">执行纪律：跌破'+f2(p.stop)+'无条件止损 · 到达'+f2(p.target)+'无条件止盈 · 日内做T当日必须平T不隔夜</div>'+
      '</div>'+
    '</div>'+
    '<div class="dc-block"><div class="dc-h">🛡 风控与证伪</div>'+
      (riskSignals.length?'<div class="dc-line dc-risk">'+riskSignals.map(function(r){return '<span class="risk-alert">⚠ '+escHtmlF(r)+(/跌破MA5|跌破MA20/.test(r)?'<i class="risk-guide">空仓者观望，持仓者减仓/清仓</i>':'')+'</span>';}).join('')+'</div>':'')+
      (conflicts.length?'<div class="dc-line dc-risk">'+conflicts.map(function(r){return '<span class="risk-alert risk-conflict">⚡ '+escHtmlF(r)+'</span>';}).join('')+'</div>':'')+
      '<div class="dc-line">证伪条件：'+escHtmlF(falsify)+'</div>'+
      '<div class="dc-line">移动止损：盈利5%止损上移成本线；盈利12%上移至+8%；跌破趋势线清仓；连续亏损3次强制降仓</div>'+
      '<div class="dc-line">仓位约束：单股≤15% · 单题材≤30% · 总仓位≤'+mr.capPct+'%（'+escHtmlF(mr.label)+'市）· 单笔风险0.5%-1%</div>'+
      '<div class="dc-line">置信度构成：趋势'+trendScore+'/30 + 资金'+fundScore+'/25 + 题材'+themeScore+'/20 + 关键位'+keyScore+'/15 + 盈亏比'+rrScore+'/10</div>'+
    '</div>'+
    '<div class="dc-block dc-review" data-review-code="'+escHtmlF(s.code)+'" data-name="'+escHtmlF(s.name)+'" data-price="'+price+'" data-entry="'+p.entry+'" data-stop="'+p.stop+'" data-target="'+p.target+'"><div class="dc-h">📊 盘后复盘（当日验证）</div>'+
      '<div class="dc-line">关键位验证：'+keyVerify+'</div>'+patternHtml+
      '<div class="dc-line">资金验证：'+fundVerify+'</div>'+
      '<div class="dc-line dc-trade-status">交易状态：'+
        '<button class="ts-btn" data-code="'+escHtmlF(s.code)+'" data-status="bought" onclick="setTradeStatus(this,\'bought\')">已买入</button>'+
        '<button class="ts-btn" data-code="'+escHtmlF(s.code)+'" data-status="not_bought" onclick="setTradeStatus(this,\'not_bought\')">未买入</button>'+
        '<button class="ts-btn" data-code="'+escHtmlF(s.code)+'" data-status="sold" onclick="setTradeStatus(this,\'sold\')">已卖出</button>'+
        '<button class="ts-btn ts-t-btn" data-code="'+escHtmlF(s.code)+'" onclick="recordTTrade(this)">记做T</button>'+
      '</div>'+
      '<div class="dc-line dc-shadow"><label class="ts-shadow"><input type="checkbox" class="ts-shadow-check" data-code="'+escHtmlF(s.code)+'" onchange="toggleShadowTrack(this)"> 系统模拟跟踪（观察未买入 → 若触发入场则虚拟结算盈亏，累计策略胜率样本）</label></div>'+
      '<div class="dc-line">策略执行/归因：待人工复盘 <span class="ts-hint" title="需积累10笔以上真实或模拟交易，系统才会展示胜率与回撤；波段与做T胜率分开展示">?</span> <span class="ts-progress-badge">进度 <b class="ts-progress">0/10</b></span> <span class="ts-winrate"></span></div>'+
      '<div class="dc-line dc-next-day">🎯 明日核心观察点：'+nextDayFocus+'</div>'+
    '</div>';
}
function buildWatchlistDetailHtml(data){ return buildDecisionCardHtml(data); }
/* 主行徽章:置信度 + 盈亏比(与决策卡同源计算,供 addToWatchlistUI / refreshWatchlistQuotes 复用) */
function dcBadges(s){
  var t=s.tech||{}, ff=s.fundFlow||{}, price=Number(s.price)||0;
  function supStrong(){var seen={},a=Array.isArray(t.supports)?t.supports:[],out=[];for(var i=0;i<a.length;i++){var x=a[i];if(!x||x.price==null||isNaN(x.price))continue;var k=x.price.toFixed(2);if(seen[k])continue;seen[k]=1;if(price>0&&Math.abs(x.price-price)/price>0.20)continue;out.push(x);}out.sort(function(a,b){return b.price-a.price;});for(var j=0;j<out.length;j++){if(out[j].weight==='strong')return out[j];}return out[0]||null;}
  function preStrong(){var seen={},a=Array.isArray(t.pressures)?t.pressures:[],out=[];for(var i=0;i<a.length;i++){var x=a[i];if(!x||x.price==null||isNaN(x.price))continue;var k=x.price.toFixed(2);if(seen[k])continue;seen[k]=1;if(price>0&&Math.abs(x.price-price)/price>0.20)continue;out.push(x);}out.sort(function(a,b){return a.price-b.price;});for(var j=0;j<out.length;j++){if(out[j].weight==='strong')return out[j];}return out[0]||null;}
  var sup=supStrong(),pre=preStrong();
  var supPrice=sup?sup.price:(t.ma20||price*0.96);
  var prePrice=pre?pre.price:(t.ma5||price*1.05);
  var entry=(supPrice<price)?supPrice:price;
  var atr=t.atr14||(price*0.03);
  var stop=entry-Math.max(atr,entry*0.03);
  var target=prePrice>entry?prePrice:(entry*1.06);
  var rr=(target-entry)/(entry-stop);
  function rrTone(r){return r>=2?'good':r>=1.5?'ok':r>=1?'warn':'bad';}
  var trendScore=t.trend==='up'?30:t.trend==='repair'?20:t.trend==='flat'?12:5;
  var fundScore=12;if((ff.d1||0)>0)fundScore+=6;if((ff.d3||0)>0)fundScore+=4;
  var vr=Number(s.volRatio)||(t.volRatio||1);if(vr>=1.3)fundScore+=3;fundScore=Math.min(25,fundScore);
  var themeScore=8;if(s.category)themeScore+=6;if(Array.isArray(s.tags)&&s.tags.length)themeScore+=4;themeScore=Math.min(20,themeScore);
  var keyScore=6;if(sup&&price<=sup.price*1.03)keyScore+=6;if(pre&&price>=pre.price*0.97)keyScore+=3;keyScore=Math.min(15,keyScore);
  var rrScore=rr>=2?10:rr>=1.5?7:rr>=1?4:0;
  var confTotal=Math.round(trendScore+fundScore+themeScore+keyScore+rrScore);
  return {rr:rr,rrTone:rrTone(rr),confTotal:confTotal,confTone:confTotal>=75?'good':confTotal>=60?'ok':'warn'};
}
function addToWatchlistUI(s){
  var card=document.querySelector(".watchlist-card");
  if(!card)return;
  if(s&&s.code&&document.querySelector('.wl-stock[data-stock-code="'+String(s.code).replace(/"/g,'\\"')+'"]'))return;
  // v8.1 修复: 优先找 .wl-stocks-scroll(蓝色滚动容器),手动新增的股票也要在容器内
  // 找不到时 fallback 到 .wl-stocks(老结构兼容)
  var stocksWrap=card.querySelector(".wl-stocks-scroll")||card.querySelector(".wl-stocks");
  if(!stocksWrap){
    stocksWrap=document.createElement("div");
    stocksWrap.className="wl-stocks-scroll";
    var wlStocks=card.querySelector(".wl-stocks");
    if(wlStocks){wlStocks.appendChild(stocksWrap);}
    else{var head=card.querySelector(".wl-stocks-head");if(head&&head.nextSibling){card.insertBefore(stocksWrap,head.nextSibling);}else{card.appendChild(stocksWrap);}}
  }
  var n=stocksWrap.querySelectorAll(".wl-stock").length+1;
  var v=Number(s.pct)||0;
  var cls=v>=0?"up":"down";
  var m=dcBadges(s);
  var rrTxt=m.rr>=1.5?(m.rr.toFixed(2)+' ✓'):m.rr.toFixed(2);
  var detailHtml=buildDecisionCardHtml(s);
  var techJson=s.tech?JSON.stringify(s.tech):'null';
  var ffJson=s.fundFlow?JSON.stringify(s.fundFlow):'null';
  var stock=document.createElement('div');
  stock.className='wl-stock';
  stock.setAttribute('data-stock-code',s.code);
  var headRowHtml='<div class="wl-stock-row wl-stock-head">'+
    '<span class="wl-cell wl-cell-rank"><b>排名/标的</b></span>'+
    '<span class="wl-cell wl-cell-price"><b>最新价</b></span>'+
    '<span class="wl-cell wl-cell-pct"><b>涨跌幅</b></span>'+
    '<span class="wl-cell wl-cell-amt"><b>成交额</b></span>'+
    '<span class="wl-cell wl-cell-atds"><b>置信度</b></span>'+
    '<span class="wl-cell wl-cell-sig"><b>盈亏比</b></span>'+
    '<span class="wl-cell wl-cell-act"><b>操作</b></span>'+
    '</div>';
  stock.innerHTML='<div class="wl-stock-scroll">'+
    headRowHtml+
    '<div class="wl-stock-row" data-code="'+escHtmlF(s.code)+'" data-tech=\''+techJson+'\' data-ff=\''+ffJson+'\'>'+
    '<span class="wl-cell wl-cell-rank"><span class="rank-no">'+n+'</span><span class="wl-name">'+escHtmlF(s.name)+'</span><span class="wl-code">'+escHtmlF(s.code)+'</span></span>'+
    '<span class="wl-cell wl-cell-price"><span class="price '+cls+'">'+Number(s.price).toFixed(2)+'</span></span>'+
    '<span class="wl-cell wl-cell-pct '+cls+'">'+(v>0?"+":"")+v.toFixed(2)+'%</span>'+
    '<span class="wl-cell wl-cell-amt">'+escHtmlF(s.amount||'--')+'</span>'+
    '<span class="wl-cell wl-cell-atds"><span class="conf conf-'+m.confTone+'">'+m.confTotal+'</span></span>'+
    '<span class="wl-cell wl-cell-sig"><span class="rr rr-'+m.rrTone+'">'+rrTxt+'</span></span>'+
    '<span class="wl-cell wl-cell-act"><button class="wl-btn wl-btn-primary" data-code="'+escHtmlF(s.code)+'" onclick="openStockResearch(this.dataset.code)">分析</button><button class="wl-btn wl-btn-del" data-code="'+escHtmlF(s.code)+'" onclick="removeWatchlistRow(this.dataset.code)">删</button></span>'+
    '</div>'+
    '</div>'+
    '<div class="wl-detail auto-detail" data-detail-code="'+escHtmlF(s.code)+'">'+
      detailHtml+
    '</div>';
  stocksWrap.appendChild(stock);
}
function removeWatchlistRow(code){var s=document.querySelector('.wl-stock[data-stock-code="'+code+'"]');if(s)s.remove();var m=document.getElementById("modal-"+code);if(m)m.remove();try{var w=localStorage.getItem("atds_watchlist");var arr=w?JSON.parse(w):[];arr=arr.filter(function(c){return String(c)!==String(code);});localStorage.setItem("atds_watchlist",JSON.stringify(arr));}catch(e){}try{var wd=JSON.parse(localStorage.getItem('atds_watchlist_data')||'{}');if(wd[code]){delete wd[code];localStorage.setItem('atds_watchlist_data',JSON.stringify(wd));}}catch(e){}try{var h=localStorage.getItem("atds_watchlist_hidden");var hidden=h?JSON.parse(h):[];if(hidden.indexOf(code)<0)hidden.push(code);localStorage.setItem("atds_watchlist_hidden",JSON.stringify(hidden));}catch(e){}}
// 保存单只股票的全量数据(供退出重登时立即渲染,不依赖网络)
function saveWatchlistStockData(code,data){try{var wd=JSON.parse(localStorage.getItem('atds_watchlist_data')||'{}');wd[code]=data;localStorage.setItem('atds_watchlist_data',JSON.stringify(wd));}catch(e){}}
// 读取缓存的全量数据(供 restoreSavedWatchlist 立即渲染)
function loadWatchlistStockData(code){try{var wd=JSON.parse(localStorage.getItem('atds_watchlist_data')||'{}');return wd[code]||null;}catch(e){return null;}}
function saveWatchlist(){
  // 合并保存:DOM 收集的 codes + 之前 localStorage 中额外手动添加的 codes
  // (避免全量覆盖丢失用户手动添加的股票)
  try{
    var codes=[];
    document.querySelectorAll(".wl-stock-row[data-code]").forEach(function(r){var cd=r.getAttribute("data-code");if(cd)codes.push(cd);});
    var prev=localStorage.getItem("atds_watchlist");
    var prevCodes=[];
    try{prevCodes=JSON.parse(prev)||[];}catch(e){}
    var merged=codes.slice();
    prevCodes.forEach(function(c){if(merged.indexOf(c)<0&&/^\d{6}$/.test(String(c)))merged.push(c);});
    localStorage.setItem("atds_watchlist",JSON.stringify(merged));
  }catch(e){}
}
function renderStockModalFront(s){
  var pct=Number(s.pct)||0,turn=Number(s.turnover)||0;
  var atds=70+Math.min(25,Math.max(-15,Math.round(pct*2+turn*0.5)));
  var rating=atds>=88?5:(atds>=78?4:(atds>=68?3:2));
  var stars="\u2605".repeat(rating)+"\u2606".repeat(5-rating);
  var cls=pct>=0?"up":"down";
  var priceText=Number(s.price||0).toFixed(2);
  var pctText=(pct>0?"+":"")+pct.toFixed(2)+"%";
  var amt=s.amount||"--";
  var posView,negView;
  if(pct>=3){posView="股价处于相对高位且涨幅较大，强势特征明显，需结合后续承接与板块持续性判断趋势延续。";negView="若放量长上影线或次日明显回吐，需警惕阶段性见顶；当前涨幅较高，建议观察板块轮动与板块带动。";}
  else if(pct>=0.5){posView="震荡上行趋势中，量能温和放大，可关注板块带动与回踩确认。";negView="若跌破短期均线或量能萎缩，需警惕趋势走弱。";}
  else if(pct>=-1){posView="价格横盘整理，等待主线确认或放量突破。";negView="若跌破支撑位且量能放大，趋势转弱风险加大。";}
  else if(pct>=-3){posView="短线走势承压，关注支撑位与量能变化。";negView="若跌破关键支撑且无资金承接，存在进一步下行风险。";}
  else{posView="弱势回调阶段，建议观察资金承接与风险释放程度。";negView="若持续放量下跌且无政策或业绩催化，需警惕进一步估值压缩。";}
  var st=Math.max(5,Math.min(25,Math.round(15+pct*1.5)));var sc=8;var sf=Math.max(10,Math.min(30,Math.round(20+pct*1.2)));var sv=10;var se=Math.max(3,Math.min(15,Math.round(8+pct*0.5)));var sg=Math.max(3,Math.min(15,Math.round(7+pct*0.6)));var sca=Math.max(3,Math.min(15,Math.round(6+turn*0.5)));var sr=pct<0?-8:-3;
  var total=st+sc+sf+sv+se+sg+sca+sr;
  var rt=rating>=4?"重点研究":(rating>=3?"三星":"弱观望");
  var esc2=function(x){return String(x==null?"":x).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");};
  var c=esc2(s.code),n=esc2(s.name),a=esc2(amt),t=esc2(s.turnover);
  var q=String.fromCharCode(39);
  var html="<div class=\"modal-mask\" id=\"modal-"+c+"\" onclick=\"if(event.target===this)closeModal("+q+c+q+")\">"+
    "<div class=\"modal\">"+
    "<div class=\"modal-header\"><div class=\"modal-title\">ATDS STOCK RESEARCH V1.1</div><button class=\"modal-close\" onclick=\"closeModal("+q+c+q+")\">&times;</button></div>"+
    "<div class=\"modal-body\">"+
    "<h2 class=\"modal-h1\">个股深度研究</h2>"+
    "<div class=\"modal-sub\">读取实时量价、业务结构、财务质量、估值与情景验证，提炼八项核心结论后自动加入观察池。</div>"+
    "<div class=\"modal-score\"><div><div class=\"modal-score-num\">"+total+"</div><div class=\"modal-score-label\">ATDS 证据分</div></div><div style=\"text-align:right;\"><div class=\"modal-score-stars\">"+stars+"</div><div class=\"modal-score-label\">"+rt+"</div></div></div>"+
    "<div class=\"modal-section\"><div class=\"modal-section-h\">核心定位 <small>事实与判断分层</small></div><div class=\"modal-info\">"+n+"（"+c+"）当前价 "+priceText+" 元，"+pctText+"；成交额 "+a+"，换手率 "+t+"%。"+posView+"</div></div>"+
    "<div class=\"modal-section\"><div class=\"modal-section-h\">ATDS 核心研判</div><div class=\"modal-grid\"><div class=\"modal-card\"><div class=\"modal-card-label\">产业位置</div>所属行业景气度跟随大盘节奏；具体板块地位需结合主营结构进一步确认。</div><div class=\"modal-card\"><div class=\"modal-card-label\">财务拐点</div>近期价格变动 "+pctText+"，反映短期资金行为；详细财务拐点需结合最近季报/年报判断。</div><div class=\"modal-card\"><div class=\"modal-card-label\">增长引擎</div>增长方向取决于主营业务的景气与扩张节奏，需结合主营分项收入与毛利率识别。</div><div class=\"modal-card\"><div class=\"modal-card-label\">估值判断</div>当前市值与价格对应估值水位；缺少历史分位与同业比较时采用中性分。</div></div></div>"+
    "<div class=\"modal-section\"><div class=\"modal-section-h\">核心增长证据 <small>最多保留关键项</small></div><table class=\"modal-table\"><thead><tr><th>主营分项</th><th>收入</th><th>占比</th><th>毛利率</th></tr></thead><tbody><tr><td>主营业务（汇总）</td><td>"+a+"</td><td>--</td><td>--</td></tr><tr><td colspan=\"4\" style=\"font-size:9px;color:#999;padding:6px;\">详细主营分项数据需接入财务接口（通达信 F10 / 财报披露）。当前快照基于公开行情数据。</td></tr></tbody></table></div>"+
    "<div class=\"modal-section\"><div class=\"modal-section-h\">公司与产业定位 <small>抓业务本质</small></div><div class=\"modal-grid\"><div class=\"modal-card\"><div class=\"modal-card-label\">股票代码</div>"+c+"</div><div class=\"modal-card\"><div class=\"modal-card-label\">研究类型</div>"+cls+"</div></div></div>"+
    "<div class=\"modal-section\"><div class=\"modal-section-h\">情景分析 <small>升级 / 降级验证</small></div><table class=\"modal-table\"><thead><tr><th>情景</th><th>核心假设</th><th>升级/降级验证</th></tr></thead><tbody><tr><td><strong>保守</strong></td><td>核心业务增速回落，结构与产能改善不及预期</td><td>扣非利润或毛利率连续走弱</td></tr><tr><td><strong>中性</strong></td><td>主营增速延续，结构与产能按已披露节奏改善</td><td>收入、扣非利润和现金流保持同向</td></tr><tr><td><strong>乐观</strong></td><td>需求、产品升级与产能利用率同步超预期</td><td>高成长业务增速与整体盈利能力继续抬升</td></tr></tbody></table></div>"+
    "<div class=\"modal-section\"><div class=\"modal-section-h\">机构应跟踪什么</div><div class=\"modal-cta\"><span class=\"modal-cta-item\">✓ 新增与在手订单</span><span class=\"modal-cta-item\">✓ 订单兑现节奏</span><span class=\"modal-cta-item\">✓ 毛利率与现金流</span><span class=\"modal-cta-item\">✓ 海外业务</span></div></div>"+
    "<div class=\"modal-section\"><div class=\"modal-section-h\">活跃资金怎么看</div><div class=\"modal-val-row\"><div class=\"modal-val-cell\"><div class=\"modal-val-label\">成交额</div><div class=\"modal-val-value\">"+a+"</div></div><div class=\"modal-val-cell\"><div class=\"modal-val-label\">换手率</div><div class=\"modal-val-value\">"+t+"%</div></div><div class=\"modal-val-cell\"><div class=\"modal-val-label\">量比</div><div class=\"modal-val-value\">"+(pct>=0?"1.0+":"--")+"</div></div><div class=\"modal-val-cell\"><div class=\"modal-val-label\">日内强度</div><div class=\"modal-val-value "+cls+"\">"+pctText+"</div></div></div><div class=\"modal-info\" style=\"border-left:2px solid #c33;\">"+negView+"</div></div>"+
    "<div class=\"modal-section\"><div class=\"modal-section-h\">风险与下一步验证</div><div class=\"modal-grid\"><div class=\"modal-card\"><div class=\"modal-card-label\">主要风险</div><span class=\"modal-tag\">关注</span>短期涨幅较大后存在回吐压力<br><span class=\"modal-tag\">关注</span>板块轮动可能导致资金切换<br><span class=\"modal-tag\">关注</span>外部环境或政策面变化</div><div class=\"modal-card\"><div class=\"modal-card-label\">下一步只看</div><span class=\"modal-tag\">验证</span>后续 1-2 个交易日量能<br><span class=\"modal-tag\">验证</span>所属板块持续性<br><span class=\"modal-tag\">验证</span>资金承接强度</div></div></div>"+
    "<div class=\"modal-section\"><div class=\"modal-section-h\">ATDS 评分与评级</div><div class=\"modal-grid\"><div class=\"modal-card\"><div class=\"modal-card-label\">产业趋势规则</div><strong>+"+st+"</strong></div><div class=\"modal-card\"><div class=\"modal-card-label\">公司资料完整度</div><strong>+"+sc+"</strong></div><div class=\"modal-card\"><div class=\"modal-card-label\">财务质量</div><strong>+"+sf+"</strong></div><div class=\"modal-card\"><div class=\"modal-card-label\">估值（中性）</div><strong>+"+sv+"</strong></div><div class=\"modal-card\"><div class=\"modal-card-label\">分项证据完整度</div><strong>+"+se+"</strong></div><div class=\"modal-card\"><div class=\"modal-card-label\">成长证据</div><strong>+"+sg+"</strong></div><div class=\"modal-card\"><div class=\"modal-card-label\">资金行为</div><strong>+"+sca+"</strong></div><div class=\"modal-card\"><div class=\"modal-card-label\">风险扣分</div><strong>"+sr+"</strong></div></div>"+
    "<div class=\"modal-rating\"><span class=\"modal-rating-stars\">"+stars+"</span><span class=\"modal-rating-text\">"+rt+" · 88+ 五星 | 78-87 四星 | 68-77 三星；缺少同业、历史分位与一致预期时，估值采用中性分。</span></div></div>"+
    "</div>"+
    "<div class=\"modal-footer\" style=\"display:flex;justify-content:space-between;align-items:center;\"><span>✓ 深度研究完成，已更新观察池中的该股票</span><button class=\"wl-btn wl-btn-primary\" data-code=\"'+c+'\" onclick=\"addFetchedToWatchlist(this.dataset.code)\" style=\"font-size:11px;padding:6px 12px;\">+ 加入观察池</button></div>"+
    "</div></div>";
  return html;
}
function showDynamicResearch(s){var old=document.getElementById("modal-"+(s.code||""));if(old)old.remove();var html=renderStockModalFront(s);var tmp=document.createElement("div");tmp.innerHTML=html;var modal=tmp.firstElementChild;document.body.appendChild(modal);modal.classList.add("show");document.body.style.overflow="hidden";}
function downloadMd(){var el=document.getElementById("knowledge-md");if(!el){alert("暂无内容");return;}var blob=new Blob([el.textContent],{type:"text/markdown"});var a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="atds-"+new Date().toISOString().slice(0,10)+".md";a.click();}
function copyMd(){var el=document.getElementById("knowledge-md");if(!el||!navigator.clipboard){alert("复制失败");return;}navigator.clipboard.writeText(el.textContent).then(function(){alert("已复制到剪贴板");});}
function loadSavedWatchlist(){try{var raw=localStorage.getItem("atds_watchlist");return raw?JSON.parse(raw):[];}catch(e){return [];}}
function restoreSavedWatchlist(){
  // 合并模式:后端 config 静态渲染 + localStorage 额外添加,取并集
  // - config 里的股票始终显示(除非用户删除过 → 记入 atds_watchlist_hidden)
  // - localStorage atds_watchlist 中不属于 config 的代码(用户手动添加)追加显示
  // 关键:先读 atds_watchlist_data 缓存立即渲染(不等网络),再异步刷新
  var raw=null,hiddenRaw=null;
  try{raw=localStorage.getItem("atds_watchlist");}catch(e){}
  try{hiddenRaw=localStorage.getItem("atds_watchlist_hidden");}catch(e){}
  var hidden=[];
  try{hidden=JSON.parse(hiddenRaw)||[];}catch(e){}
  var card=document.querySelector('.watchlist-card');
  if(!card)return;
  var configCodes=[];
  document.querySelectorAll('.wl-stock-row[data-code]').forEach(function(r){var cd=r.getAttribute("data-code");if(cd&&configCodes.indexOf(cd)<0)configCodes.push(cd);});
  hidden.forEach(function(c){if(configCodes.indexOf(c)>=0){var el=document.querySelector('.wl-stock[data-stock-code="'+c+'"]');if(el)el.remove();}});
  configCodes=[];
  document.querySelectorAll('.wl-stock-row[data-code]').forEach(function(r){var cd=r.getAttribute("data-code");if(cd&&configCodes.indexOf(cd)<0)configCodes.push(cd);});
  var extraCodes=[];
  if(raw!==null){
    try{extraCodes=JSON.parse(raw)||[];}catch(e){}
    extraCodes=extraCodes.filter(function(c){return /^\d{6}$/.test(String(c))&&configCodes.indexOf(c)<0&&hidden.indexOf(c)<0;});
  }
  if(!extraCodes.length)return;
  // 先用 atds_watchlist_data 缓存立即渲染(不等网络,避免网络/CORS失败导致"新股丢失")
  var renderedFromCache=0;
  for(var i=0;i<extraCodes.length;i++){
    var c=String(extraCodes[i]);
    var cached=loadWatchlistStockData(c);
    if(cached&&cached.code&&!document.querySelector('.wl-stock[data-stock-code="'+c+'"]')){
      addToWatchlistUI(cached);
      renderedFromCache++;
    }
  }
  if(renderedFromCache){
    // 缓存渲染完成后强制刷新一次行情(价/涨跌)
    setTimeout(function(){try{refreshWatchlistQuotes();}catch(e){}}, 200);
  }
  // 再异步拉取最新行情/补齐缺失字段(CORS/失败不阻塞,缓存已可见)
  (async function(){
    for(var i=0;i<extraCodes.length;i++){
      var rawCode=String(extraCodes[i]);
      if(document.querySelector('.wl-stock[data-stock-code="'+rawCode+'"]')){
        // 已有(来自缓存),跳过网络拉取(避免重复)
        continue;
      }
      var c0=rawCode.charAt(0);var sc;if(c0==="6"){sc="sh";}else if(c0==="4"||c0==="8"||c0==="92"){sc="bj";}else{sc="sz";}
      try{
        var res=await fetch("https://qt.gtimg.cn/q="+sc+rawCode);
        var buf=await res.arrayBuffer();var text=new TextDecoder("gbk").decode(buf);
        var m=text.match(/="([^"]+)"/);if(!m)continue;
        var f=m[1].split("~");if(f.length<40)continue;
        var data={code:rawCode,name:f[1],price:parseFloat(f[3]),pct:parseFloat(f[32])||0,amount:((parseFloat(f[37])||0)/10000).toFixed(1)+"亿",turnover:f[38]||"--",setcode:sc,
          prevClose:parseFloat(f[4])||0,open:parseFloat(f[5])||0,high:parseFloat(f[33])||0,low:parseFloat(f[34])||0,
          amplitude:parseFloat(f[43])||0,volRatio:parseFloat(f[49])||0,avgPrice:parseFloat(f[51])||0,
          floatMcap:parseFloat(f[44])||0,totalMcap:parseFloat(f[45])||0};
        if(!data.name)continue;
        try{var full=(c0==="6"||c0==="5")?("sh"+rawCode):((c0==="4"||c0==="8"||c0==="92")?("bj"+rawCode):("sz"+rawCode));var kl=await fetchKlineF(full,90);if(kl&&kl.length>=30){data.tech=calcDecisionTech(kl);}}catch(e){/* 缓存兜底 */}
        try{var ff=await fetchStockFundFlowF(rawCode);if(ff)data.fundFlow=ff;}catch(e){}
        addToWatchlistUI(data);
        saveWatchlistStockData(rawCode,data);
      }catch(e){}
    }
  })();
}
if(document.readyState==="complete"||document.readyState==="interactive"){setTimeout(restoreSavedWatchlist,600);}else{document.addEventListener("DOMContentLoaded",function(){setTimeout(restoreSavedWatchlist,600);});}

/* ============ 观察池实时行情刷新(电脑关机后手机端仍可刷新) ============ */
function escHtmlR(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function deriveSigR(v){if(v>=5)return{name:'强势突破',tone:'break'};if(v>=2)return{name:'强势承接',tone:'strong'};if(v>=0.5)return{name:'震荡上行',tone:'up'};if(v>=-1)return{name:'等待确认',tone:'wait'};if(v>=-3)return{name:'走势承压',tone:'press'};return{name:'弱势回调',tone:'weak'};}
async function refreshWatchlistQuotes(){
  var rows=document.querySelectorAll('.wl-stock-row[data-code]');
  if(!rows.length)return;
  var btn=document.getElementById('wl-refresh-btn');
  if(btn){btn.disabled=true;btn.textContent='↻ 刷新中…';}
  var codes=[];var map={};
  rows.forEach(function(r){var c=r.getAttribute('data-code');if(c){codes.push(c);map[c]=r;}});
  try{
    // 批量腾讯行情:sh/sz/bj 前缀区分,一次请求多个
    var batch=[];
    codes.forEach(function(raw){var c0=raw.charAt(0);if(c0==='6'){batch.push('sh'+raw);}else if(c0==='4'||c0==='8'||c0==='92'){batch.push('bj'+raw);}else{batch.push('sz'+raw);}});
    var res=await fetch('https://qt.gtimg.cn/q='+batch.join(','),{cache:'no-store'});
    if(!res.ok)throw new Error('HTTP '+res.status);
    var buf=await res.arrayBuffer();
    var text=new TextDecoder('gbk').decode(buf);
    text.split(';').forEach(function(line){
      var m=line.trim().match(/^v_[a-z]+\d+="(.*)"$/);if(!m)return;
      var f=m[1].split('~');if(f.length<40)return;
      var code=String(f[2]||'').trim();if(!map[code])return;
      var price=parseFloat(f[3])||0,pct=parseFloat(f[32])||0;
      var amount=((parseFloat(f[37])||0)/10000).toFixed(1)+'亿';
      var turnover=f[38]||'--';
      var prevClose=parseFloat(f[4])||0,open=parseFloat(f[5])||0;
      var high=parseFloat(f[33])||0,low=parseFloat(f[34])||0;
      var amplitude=parseFloat(f[43])||0,volRatio=parseFloat(f[49])||0;
      var r=map[code];
      var cls=pct>=0?'up':'down';
      // 主行:价/涨跌/成交额(全部标的实时更新)
      var priceEl=r.querySelector('.wl-cell-price .price');
      if(priceEl){priceEl.className='price '+cls;priceEl.textContent=price.toFixed(2);}
      var pctEl=r.querySelector('.wl-cell-pct');
      if(pctEl){pctEl.className='wl-cell wl-cell-pct '+cls;pctEl.textContent=(pct>0?'+':'')+pct.toFixed(2)+'%';}
      var amtEl=r.querySelector('.wl-cell-amt');
      if(amtEl)amtEl.textContent=amount;
      // 读回技术画像/资金流(data-tech/data-ff,手动股写入)
      var tech=null,ff=null;
      try{var tj=r.getAttribute('data-tech');if(tj&&tj!=='null')tech=JSON.parse(tj);}catch(e){}
      try{var fj=r.getAttribute('data-ff');if(fj&&fj!=='null')ff=JSON.parse(fj);}catch(e){}
      var sObj={code:code,name:f[1],price:price,pct:pct,amount:amount,turnover:turnover,prevClose:prevClose,open:open,high:high,low:low,amplitude:amplitude,volRatio:volRatio,tech:tech,fundFlow:ff};
      // 手动新增股(auto-detail):整体重建决策卡 + 置信度/盈亏比徽章,让所有字段跟随最新行情
      var d=document.querySelector('.wl-detail[data-detail-code="'+code+'"]');
      if(d&&d.classList.contains('auto-detail')){
        var bd=dcBadges(sObj);
        var confEl=r.querySelector('.wl-cell-atds .conf');
        if(confEl){confEl.className='conf conf-'+bd.confTone;confEl.textContent=bd.confTotal;}
        var rrEl=r.querySelector('.wl-cell-sig .rr');
        if(rrEl){rrEl.className='rr rr-'+bd.rrTone;rrEl.textContent=(bd.rr>=1.5?(bd.rr.toFixed(2)+' ✓'):bd.rr.toFixed(2));}
        d.innerHTML=buildDecisionCardHtml(sObj);
        applyReviewState(d.querySelector('.dc-review'));   // 重建后恢复勾选/交易状态,避免 5 秒刷新清空
      }
    });
    var timeEl=document.querySelector('.wl-time');
    if(timeEl)timeEl.textContent='● '+new Date().toLocaleString('zh-CN',{hour12:false});
  }catch(e){}
  if(btn){btn.disabled=false;btn.textContent='↻ 刷新';}
  // 异步补丁:对没有 tech 数据的手动行补拉 K 线 → 写入 data-tech/data-ff → 重建决策卡
  try{
    var noTechRows=document.querySelectorAll('.wl-stock-row[data-code]:not([data-tech]),.wl-stock-row[data-code][data-tech="null"]');
    if(noTechRows.length){
      (async function(){
        for(var k=0;k<noTechRows.length;k++){
          var rEl=noTechRows[k];
          var c=rEl.getAttribute('data-code');if(!c)continue;
          var d=document.querySelector('.wl-detail[data-detail-code="'+c+'"]');
          if(d&&!d.classList.contains('auto-detail'))continue;  // 配置股不重建,保留其题材/逻辑文案
          try{
            var c0=c.charAt(0);
            var full=(c0==="6"||c0==="5")?("sh"+c):((c0==="4"||c0==="8"||c0==="92")?("bj"+c):("sz"+c));
            var kl=await fetchKlineF(full,90);
            if(!kl||kl.length<30)continue;
            var t=calcDecisionTech(kl);
            rEl.setAttribute('data-tech',JSON.stringify(t));
            var ff=await fetchStockFundFlowF(c);
            if(ff)rEl.setAttribute('data-ff',JSON.stringify(ff));
            var priceEl=rEl.querySelector('.wl-cell-price .price');
            var pctEl=rEl.querySelector('.wl-cell-pct');
            var amtEl=rEl.querySelector('.wl-cell-amt');
            var price=priceEl?parseFloat(priceEl.textContent)||0:0;
            var pct=0;
            if(pctEl){var pm=pctEl.textContent.match(/([+\-]?[\d.]+)%/);if(pm)pct=parseFloat(pm[1])||0;}
            var amount=amtEl?amtEl.textContent:'--';
            var name=rEl.querySelector('.wl-name')?rEl.querySelector('.wl-name').textContent:c;
            if(d){
              d.innerHTML=buildDecisionCardHtml({code:c,name:name,price:price,pct:pct,amount:amount,turnover:'--',prevClose:0,open:0,high:0,low:0,amplitude:0,volRatio:0,tech:t,fundFlow:ff});
              applyReviewState(d.querySelector('.dc-review'));   // 补拉后重建,恢复勾选/交易状态
            }
          }catch(e){}
        }
      })();
    }
  }catch(e){}
}
function addWatchlistRefreshBtn(){
  var tools=document.querySelector('.watchlist-card .wl-tools');
  if(!tools||document.getElementById('wl-refresh-btn'))return;
  var b=document.createElement('button');
  b.id='wl-refresh-btn';b.className='wl-tool wl-tool-red';
  b.textContent='↻ 刷新';
  b.style.marginLeft='4px';
  b.onclick=refreshWatchlistQuotes;
  tools.appendChild(b);
}
function initWatchlistAutoRefresh(){
  addWatchlistRefreshBtn();
  setTimeout(refreshWatchlistQuotes,800);             // 打开页面 0.8s 后自动刷一次
  _wlStartAutoRefresh();
}
// 受控自动刷新:悬停在"盘后复盘"交互区时暂停,避免打断用户勾选/点击
var _wlRefreshTimer=null,_wlRefreshPaused=false;
function _wlStartAutoRefresh(){
  if(_wlRefreshTimer)return;
  _wlRefreshTimer=setInterval(function(){ if(_wlRefreshPaused)return; try{refreshWatchlistQuotes();}catch(e){} },5000);
}
(function(){var card=document.querySelector('.watchlist-card');if(card){addWatchlistRefreshBtn();setTimeout(refreshWatchlistQuotes,800);_wlStartAutoRefresh();}})();

/* ============ 波背离选股:刷新行情 ============ */
async function refreshWaveQuotes(){
  var items=document.querySelectorAll('.wave-item[data-code]');
  if(!items.length)return;
  var btn=document.getElementById('wave-refresh-btn');
  if(btn){btn.disabled=true;btn.textContent='↻ 刷新中…';}
  var codes=[];var map={};
  items.forEach(function(it){var c=it.getAttribute('data-code');if(c){codes.push(c);map[c]=it;}});
  try{
    var batch=[];
    codes.forEach(function(raw){var c0=raw.charAt(0);if(c0==='6'){batch.push('sh'+raw);}else if(c0==='4'||c0==='8'||c0==='92'){batch.push('bj'+raw);}else{batch.push('sz'+raw);}});
    var res=await fetch('https://qt.gtimg.cn/q='+batch.join(','),{cache:'no-store'});
    if(!res.ok)throw new Error('HTTP '+res.status);
    var buf=await res.arrayBuffer();
    var text=new TextDecoder('gbk').decode(buf);
    text.split(';').forEach(function(line){
      var m=line.trim().match(/^v_[a-z]+\d+="(.*)"$/);if(!m)return;
      var f=m[1].split('~');if(f.length<40)return;
      var code=String(f[2]||'').trim();if(!map[code])return;
      var price=parseFloat(f[3])||0,pct=parseFloat(f[32])||0;
      var it=map[code];
      var cls=pct>=0?'up':'down';
      var priceEl=it.querySelector('.wave-price');
      if(priceEl){priceEl.className='wave-price '+cls;priceEl.textContent=price.toFixed(2);}
      var pctEl=it.querySelector('.wave-pct');
      if(pctEl){pctEl.className='wave-pct '+cls;pctEl.textContent=(pct>0?'+':'')+pct.toFixed(2)+'%';}
    });
  }catch(e){}
  if(btn){btn.disabled=false;btn.textContent='↻ 刷新行情';}
}
/* ============ 一键批量加入观察池(波背离 / 60日新高通用) ============ */
async function bulkAddToWatchlist(codes, label){
  var hasCard = !!document.querySelector('.watchlist-card');
  var added = 0;
  for (var i = 0; i < codes.length; i++) {
    var code = String(codes[i] || '').trim();
    if (!/^\d{6}$/.test(code)) continue;
    if (document.querySelector('.wl-stock[data-stock-code="'+code+'"]')) continue;
    if (hasCard) {
      try {
        var d = await fetchStockData(code);
        if (d) { addToWatchlistUI(d); added++; }
      } catch(e){}
    } else {
      added++;
    }
  }
  // 无论是否有观察池卡片,都写入 localStorage(午盘隐藏观察池时,收盘复盘会自动恢复)
  try {
    var existing = loadSavedWatchlist();
    var merged = existing.slice();
    codes.forEach(function(c){ if (/^\d{6}$/.test(String(c)) && merged.indexOf(String(c)) < 0) merged.push(String(c)); });
    localStorage.setItem('atds_watchlist', JSON.stringify(merged));
  } catch(e){}
  alert('已加入 ' + added + ' 只' + (label || '') + '到观察池' + (hasCard ? '' : '（午盘已隐藏观察池卡片，收盘复盘中可查看）'));
}
function bulkAddWaveToWatchlist(){
  var codes = [];
  document.querySelectorAll('.wave-item[data-code]').forEach(function(it){ codes.push(it.getAttribute('data-code')); });
  bulkAddToWatchlist(codes, ' 波背离个股');
}

/* ============ 超短核心选股(午盘): 弹窗 / 刷新 / 一键加入 ============ */
function openShortCoreModal(){
  var m = document.getElementById('short-core-modal');
  if (!m) return;
  m.classList.add('show');
  document.body.style.overflow = 'hidden';
}
function closeShortCoreModal(){
  var m = document.getElementById('short-core-modal');
  if (m) m.classList.remove('show');
  document.body.style.overflow = '';
}
async function refreshShortCoreQuotes(){
  var items = document.querySelectorAll('#short-core-modal .sc-item[data-code]');
  if (!items.length) return;
  var btn = document.getElementById('sc-refresh-btn');
  if (btn) { btn.disabled = true; btn.textContent = '↻ 刷新中…'; }
  var codes = []; var map = {};
  items.forEach(function(it){ var c = it.getAttribute('data-code'); if (c) { codes.push(c); map[c] = it; } });
  try {
    var batch = [];
    codes.forEach(function(raw){ var c0 = raw.charAt(0); if (c0 === '6') batch.push('sh' + raw); else if (c0 === '4' || c0 === '8' || c0 === '92') batch.push('bj' + raw); else batch.push('sz' + raw); });
    var res = await fetch('https://qt.gtimg.cn/q=' + batch.join(','), { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    var buf = await res.arrayBuffer();
    var text = new TextDecoder('gbk').decode(buf);
    text.split(';').forEach(function(line){
      var m = line.trim().match(/^v_[a-z]+\d+="(.*)"$/); if (!m) return;
      var f = m[1].split('~'); if (f.length < 40) return;
      var code = String(f[2] || '').trim(); if (!map[code]) return;
      var price = parseFloat(f[3]) || 0, pct = parseFloat(f[32]) || 0;
      var it = map[code];
      var cls = pct >= 0 ? 'up' : 'down';
      var priceEl = it.querySelector('.sc-price');
      if (priceEl) { priceEl.className = 'sc-price ' + cls; priceEl.textContent = price.toFixed(2); }
      var pctEl = it.querySelector('.sc-pct');
      if (pctEl) { pctEl.className = 'sc-pct ' + cls; pctEl.textContent = (pct > 0 ? '+' : '') + pct.toFixed(2) + '%'; }
    });
  } catch(e) {}
  if (btn) { btn.disabled = false; btn.textContent = '↻ 刷新行情'; }
}
function bulkAddShortCoreToWatchlist(){
  var codes = [];
  document.querySelectorAll('#short-core-modal .sc-item[data-code]').forEach(function(it){ codes.push(it.getAttribute('data-code')); });
  bulkAddToWatchlist(codes, ' 超短核心个股');
}

/* ============ 形态扫描 / 波背离 弹窗模式 ============ */
function openMarketScanModal(){
  var m = document.getElementById('market-scan-modal');
  if (!m) return;
  m.classList.add('show');
  document.body.style.overflow = 'hidden';
}
function closeMarketScanModal(){
  var m = document.getElementById('market-scan-modal');
  if (m) m.classList.remove('show');
  document.body.style.overflow = '';
}
function openWaveDivergenceModal(){
  var m = document.getElementById('wave-divergence-modal');
  if (!m) return;
  m.classList.add('show');
  document.body.style.overflow = 'hidden';
}
function closeWaveDivergenceModal(){
  var m = document.getElementById('wave-divergence-modal');
  if (m) m.classList.remove('show');
  document.body.style.overflow = '';
}
function bulkAddAllPicks(){
  var codes = [];
  document.querySelectorAll('#market-scan-modal .ms-row [data-code], #market-scan-modal .ms-row').forEach(function(el){
    var c = el.getAttribute('data-code');
    if (c && codes.indexOf(c) < 0) codes.push(c);
  });
  if (!codes.length) { alert('当前形态扫描名单为空'); return; }
  bulkAddToWatchlist(codes, ' 形态扫描个股');
}

/* ============ 强势股选股(午盘): 弹窗 / 刷新 / 一键加入 ============ */
function openStrongStockModal(){
  var m = document.getElementById('strong-stock-modal');
  if (!m) return;
  m.classList.add('show');
  document.body.style.overflow = 'hidden';
}
function closeStrongStockModal(){
  var m = document.getElementById('strong-stock-modal');
  if (m) m.classList.remove('show');
  document.body.style.overflow = '';
}
async function refreshStrongStockQuotes(){
  var items = document.querySelectorAll('#strong-stock-modal .ss-item[data-code]');
  if (!items.length) return;
  var btn = document.getElementById('ss-refresh-btn');
  if (btn) { btn.disabled = true; btn.textContent = '↻ 刷新中…'; }
  var codes = []; var map = {};
  items.forEach(function(it){ var c = it.getAttribute('data-code'); if (c) { codes.push(c); map[c] = it; } });
  try {
    var batch = [];
    codes.forEach(function(raw){ var c0 = raw.charAt(0); if (c0 === '6') batch.push('sh' + raw); else if (c0 === '4' || c0 === '8' || c0 === '92') batch.push('bj' + raw); else batch.push('sz' + raw); });
    var res = await fetch('https://qt.gtimg.cn/q=' + batch.join(','), { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    var buf = await res.arrayBuffer();
    var text = new TextDecoder('gbk').decode(buf);
    text.split(';').forEach(function(line){
      var m = line.trim().match(/^v_[a-z]+\d+="(.*)"$/); if (!m) return;
      var f = m[1].split('~'); if (f.length < 40) return;
      var code = String(f[2] || '').trim(); if (!map[code]) return;
      var price = parseFloat(f[3]) || 0, pct = parseFloat(f[32]) || 0;
      var it = map[code];
      var cls = pct >= 0 ? 'up' : 'down';
      var priceEl = it.querySelector('.ss-price');
      if (priceEl) { priceEl.className = 'ss-price ' + cls; priceEl.textContent = price.toFixed(2); }
      var pctEl = it.querySelector('.ss-pct');
      if (pctEl) { pctEl.className = 'ss-pct ' + cls; pctEl.textContent = (pct > 0 ? '+' : '') + pct.toFixed(2) + '%'; }
    });
  } catch(e) {}
  if (btn) { btn.disabled = false; btn.textContent = '↻ 刷新行情'; }
}
function bulkAddStrongStockToWatchlist(){
  var codes = [];
  document.querySelectorAll('#strong-stock-modal .ss-item[data-code]').forEach(function(it){ codes.push(it.getAttribute('data-code')); });
  bulkAddToWatchlist(codes, ' 强势股个股');
}

/* ============ 观察池统一横滑:表头拉杆为主,数据行隐藏滚动条并联动 scrollLeft ============ */
(function bindWatchlistScrollSync(){
  function bind(){
    var head = document.querySelector('.wl-stocks-head .wl-stock-row');
    var rows = document.querySelectorAll('.wl-stocks .wl-stock-row');
    if (!head || !rows.length) return false;
    var syncing = false;
    function syncFrom(src){
      if (syncing) return;
      syncing = true;
      var x = src.scrollLeft;
      if (head !== src && head.scrollLeft !== x) head.scrollLeft = x;
      for (var i = 0; i < rows.length; i++){
        if (rows[i] !== src && rows[i].scrollLeft !== x) rows[i].scrollLeft = x;
      }
      syncing = false;
    }
    head.addEventListener('scroll', function(){ syncFrom(head); });
    for (var i = 0; i < rows.length; i++) rows[i].addEventListener('scroll', (function(r){ return function(){ syncFrom(r); }; })(rows[i]));
    return true;
  }
  function tryBind(){
    if (bind()) return;
    setTimeout(tryBind, 400);
  }
  if (document.readyState === 'complete' || document.readyState === 'interactive') setTimeout(tryBind, 300);
  else document.addEventListener('DOMContentLoaded', function(){ setTimeout(tryBind, 300); });
  // addToWatchlistUI 新增股票后重新绑定
  var _orig = window.addToWatchlistUI;
  if (typeof _orig === 'function'){
    window.addToWatchlistUI = function(){
      var r = _orig.apply(this, arguments);
      setTimeout(bind, 50);
      return r;
    };
  }
})();

/* ============ 午盘/收盘实时刷新:核心指数 + 顶部实时时间 ============ */
function pad2F(n){return (n<10?'0':'')+n;}
function bjTimeF(d){d=d||new Date();return pad2F(d.getHours())+':'+pad2F(d.getMinutes());}
async function refreshCoreQuotes(){
  var items=document.querySelectorAll('.index-item[data-code]');
  if(!items.length)return;
  var codes=[];var map={};
  items.forEach(function(it){
    var c=it.getAttribute('data-code');if(!c)return;
    var p=it.getAttribute('data-prefix')||'sh';
    codes.push(p+c);map[c]=it;   // 腾讯返回 f[2] 是 6 位代码,map 用纯数字作 key
  });
  try{
    var res=await fetch('https://qt.gtimg.cn/q='+codes.join(','),{cache:'no-store'});
    var buf=await res.arrayBuffer();
    var text=new TextDecoder('gbk').decode(buf);
    text.split(';').forEach(function(line){
      var m=line.trim().match(/^v_[a-z]+\d+="(.*)"$/);if(!m)return;
      var f=m[1].split('~');if(f.length<40)return;
      var full=String(f[2]||'').trim();
      var it=map[full];if(!it)return;
      var price=parseFloat(f[3])||0,pct=parseFloat(f[32])||0;
      var cls=pct>=0?'up':'down';
      var vEl=it.querySelector('.index-value');
      if(vEl){vEl.className='index-value '+cls;vEl.textContent=price.toFixed(2);}
      var cEl=it.querySelector('.index-change');
      if(cEl){cEl.className='index-change '+cls;cEl.textContent=(pct>0?'+':'')+pct.toFixed(2)+'%';}
    });
  }catch(e){}
}
function initRealtimeClock(){
  var t=document.getElementById('rt-hero-time');
  if(t){var tick=function(){t.textContent=bjTimeF();};tick();setInterval(tick,1000);}
}
function initRealtimeRefresh(){
  initRealtimeClock();
  // 午盘/收盘页面每 60 秒刷新核心指数
  if(document.querySelector('.index-item[data-code]')){
    setTimeout(refreshCoreQuotes,800);
    setInterval(refreshCoreQuotes,60000);
  }
}
(function(){
  if(document.querySelector('#rt-hero-time')||document.querySelector('.index-item[data-code]')){
    if(document.readyState==='complete'||document.readyState==='interactive'){setTimeout(initRealtimeRefresh,300);}
    else{document.addEventListener('DOMContentLoaded',function(){setTimeout(initRealtimeRefresh,300);});}
  }
})();

/* ============ 一键刷新最新数据(实时行情 + 报告日期检测) ============ */
function pad2F(n){return (n<10?'0':'')+n;}
async function refreshAllData(){
  var btn = document.querySelector('.hero-refresh .wl-btn');
  if (btn) { btn.disabled = true; btn.textContent = '↻ 刷新中…'; }
  // 1) 刷新核心指数行情
  try { await refreshCoreQuotes(); } catch(e){}
  // 2) 刷新观察池行情(盘前)
  try { await refreshWatchlistQuotes(); } catch(e){}
  // 3) 刷新各选股模块行情(午盘)
  try { await refreshWaveQuotes(); } catch(e){}
  try { await refreshShortCoreQuotes(); } catch(e){}
  try { await refreshStrongStockQuotes(); } catch(e){}
  if (btn) { btn.disabled = false; btn.textContent = '🔄 一键刷新最新数据'; }
  // 4) 检测报告日期是否今天
  var hero = document.querySelector('.hero-title');
  var dateTxt = hero ? hero.textContent : '';
  var m = dateTxt.match(/(\d{4}-\d{2}-\d{2})/);
  var now = new Date();
  var todayStr = now.getFullYear() + '-' + pad2F(now.getMonth() + 1) + '-' + pad2F(now.getDate());
  if (m && m[1] !== todayStr) {
    alert('当前报告日期为 ' + m[1] + ',尚未更新到今日。\n请打开首页查看最新报告,或稍后再点一次。');
  } else {
    alert('已刷新最新行情数据 ✓\n(报告内容由每日定时任务更新,非交易日/收盘后可能仍为最近交易日数据)');
  }
}

/* ==================== 交易复盘 / 交易行为复盘 (2026-08-20) ==================== */
function computeTechMetrics(klines){
  if (!Array.isArray(klines) || klines.length < 20) return null;
  var closes = klines.map(function(k){ return parseFloat(k[2]); });
  var vols = klines.map(function(k){ return parseFloat(k[5]) || 0; });
  var n = closes.length;
  var sma = function(arr, m){ if (arr.length < m) return null; var s = 0; for (var i = arr.length - m; i < arr.length; i++) s += arr[i]; return s / m; };
  var ma5 = sma(closes, 5), ma10 = sma(closes, 10), ma20 = sma(closes, 20), ma60 = sma(closes, 60);
  var last = closes[n - 1];
  var lastVol = vols[n - 1] || 0;
  var vol20 = sma(vols, 20) || 0;
  var pct5 = closes.length >= 6 ? (last / closes[n - 6] - 1) * 100 : 0;
  var seg = closes.slice(-20);
  var high20 = Math.max.apply(null, seg), low20 = Math.min.apply(null, seg);
  var rangePos = high20 > low20 ? (last - low20) / (high20 - low20) * 100 : 50;
  var amp20 = low20 > 0 ? (high20 - low20) / low20 * 100 : 0;
  return {
    last: last, ma5: ma5, ma10: ma10, ma20: ma20, ma60: ma60,
    bias5: ma5 ? (last - ma5) / ma5 * 100 : null,
    bias20: ma20 ? (last - ma20) / ma20 * 100 : null,
    volRatio: vol20 ? lastVol / vol20 : null,
    pct5: pct5, high20: high20, low20: low20, rangePos: rangePos, amp20: amp20,
    bullArrange: ma5 && ma10 && ma20 && ma60 ? (ma5 > ma10 && ma10 > ma20 && ma20 > ma60) : false,
    nearMa20: ma20 ? Math.abs(last - ma20) / ma20 * 100 <= 2 : false
  };
}
/* A股交易时间进度(0~1):盘中放量缩量折算 */
function tradeProgressF(){
  var bj=new Date(Date.now()+8*3600*1000);
  var day=bj.getUTCDay();
  if(day===0||day===6)return 1;
  var mins=bj.getUTCHours()*60+bj.getUTCMinutes();
  var traded=0;
  if(mins>=570&&mins<=690)traded=mins-570;
  else if(mins>690&&mins<780)traded=120;
  else if(mins>=780&&mins<=900)traded=120+(mins-780);
  else if(mins>900)traded=240;
  return Math.min(1,Math.max(0,traded/240));
}
/* 交易决策技术画像:镜像云端 calcTechFromKline(ATR14/支撑压力/缺口/多周期),真实K线计算 */
function calcDecisionTech(klines){
  if(!Array.isArray(klines)||klines.length<30)return null;
  var closes=klines.map(function(k){return parseFloat(k[2]);}).filter(function(n){return !isNaN(n);});
  var vols=klines.map(function(k){return parseFloat(k[5])||0;});
  var n=closes.length;
  if(n<30)return null;
  var last=closes[n-1];
  function sma(m){return n>=m?closes.slice(-m).reduce(function(a,b){return a+b;},0)/m:null;}
  var ma5=sma(5),ma10=sma(10),ma20=sma(20),ma60=sma(60);
  var last5v=vols.slice(-5).reduce(function(a,b){return a+b;},0)/5;
  var prev15v=vols.slice(-20,-5).reduce(function(a,b){return a+b;},0)/15;
  var volRatio=prev15v>0?last5v/prev15v:null;
  var ma20Prev=n>=25?closes.slice(-25,-5).reduce(function(a,b){return a+b;},0)/20:null;
  var ma20Slope=(ma20!=null&&ma20Prev!=null)?(ma20>ma20Prev*1.002?'up':ma20<ma20Prev*0.998?'down':'flat'):'flat';
  var bullArrange=!!(ma5&&ma10&&ma20&&ma60&&ma5>ma10&&ma10>ma20&&ma20>ma60);
  var trend=bullArrange?'up':(!bullArrange&&ma10&&ma20&&ma10>ma20&&last>ma20&&ma20Slope!=='down')?'repair':(ma20!=null&&last<ma20)?'down':'flat';
  function r2(x){return x==null?null:Math.round(x*100)/100;}
  var atr14=null;
  if(n>=15){
    var trs=[];
    for(var i=n-14;i<n;i++){
      var h=parseFloat(klines[i][3]),l=parseFloat(klines[i][4]),pc=parseFloat(klines[i-1][2]);
      if(isNaN(h)||isNaN(l)||isNaN(pc))continue;
      trs.push(Math.max(h-l,Math.abs(h-pc),Math.abs(l-pc)));
    }
    if(trs.length)atr14=trs.reduce(function(a,b){return a+b;},0)/trs.length;
  }
  var highs60=klines.slice(-60,-1).map(function(k){return parseFloat(k[3]);}).filter(function(x){return !isNaN(x);});
  var lows60=klines.slice(-60,-1).map(function(k){return parseFloat(k[4]);}).filter(function(x){return !isNaN(x);});
  var high60=highs60.length?Math.max.apply(null,highs60):null;
  var low60=lows60.length?Math.min.apply(null,lows60):null;
  var gapUp=null,gapDown=null;
  if(n>=2){
    var prevH=parseFloat(klines[n-2][3]),prevL=parseFloat(klines[n-2][4]);
    var curO=parseFloat(klines[n-1][1]),curL=parseFloat(klines[n-1][4]),curH=parseFloat(klines[n-1][3]);
    if(!isNaN(prevH)&&!isNaN(curO)&&!isNaN(curL)&&curO>prevH)gapUp={level:r2(prevH),filled:curL<=prevH};
    else if(!isNaN(prevL)&&!isNaN(curO)&&!isNaN(curH)&&curO<prevL)gapDown={level:r2(prevL),filled:curH>=prevL};
  }
  // 较昨日放量/缩量%(盘中按交易时间进度折算)
  var volToday=vols[n-1]||0,volYesterday=vols[n-2]||0;
  var volChgPct=null;
  if(volYesterday>0){
    var prog=tradeProgressF();
    var ratio=volToday/volYesterday;
    var adj=(prog>0&&prog<1)?ratio/prog:ratio;
    volChgPct=Math.round((adj-1)*1000)/10;
  }
  var supports=[],pressures=[];
  function addLvl(price,label,weight){
    if(price==null||isNaN(price))return;
    var item={price:r2(price),label:label,weight:weight};
    if(price<last)supports.push(item);else if(price>last)pressures.push(item);
  }
  addLvl(ma5,'MA5','weak');addLvl(ma10,'MA10','weak');
  addLvl(ma20,'MA20','strong');addLvl(ma60,'MA60','strong');
  addLvl(low60,'近60日前低','strong');addLvl(high60,'近60日前高','strong');
  [10,50,100,200,500].forEach(function(step){
    var up=Math.ceil(last/step)*step,down=Math.floor(last/step)*step;
    if(up>last)addLvl(up,'整数关口','weak');
    if(down<last&&down>0)addLvl(down,'整数关口','weak');
  });
  supports.sort(function(a,b){return b.price-a.price;});
  pressures.sort(function(a,b){return a.price-b.price;});
  var weeklyCloses=[];
  for(var w=0;w<n;w+=5)weeklyCloses.push(closes[w]);
  var wkLast=weeklyCloses[weeklyCloses.length-1];
  var wk5=weeklyCloses.length>=5?weeklyCloses.slice(-5).reduce(function(a,b){return a+b;},0)/5:null;
  var weeklyTrend=(wkLast!=null&&wk5!=null)?(wkLast>wk5*1.005?'up':wkLast<wk5*0.995?'down':'flat'):'flat';
  return {price:r2(last),ma5:r2(ma5),ma10:r2(ma10),ma20:r2(ma20),ma60:r2(ma60),ma20Slope:ma20Slope,trend:trend,
    atr14:r2(atr14),high60:r2(high60),low60:r2(low60),gapUp:gapUp,gapDown:gapDown,supports:supports,pressures:pressures,
    weeklyTrend:weeklyTrend,volRatio:volRatio!=null?Math.round(volRatio*100)/100:null,
    volChgPct:volChgPct,volToday:volToday,volYesterday:volYesterday,
    bias20:ma20?Math.round((last/ma20-1)*1000)/10:null};
}
/* 个股主力资金流(东财 fflow/kline):主力净流入 当日/3日/5日,单位亿元;主源3次重试→降级实时→本地缓存兜底(fromCache 标记),失败返回 null 不阻塞 */
async function fetchStockFundFlowF(code){
  var num=String(code).replace(/^(sh|sz|bj)/,'');
  var mkt=String(code).charAt(0)==='6'?'1':'0';
  function yi(v){return Math.round(v/1e6)/100;}
  function writeCache(ff){try{var fc=JSON.parse(localStorage.getItem('atds_ff_cache')||'{}'); fc[code]={d1:ff.d1,d3:ff.d3,d5:ff.d5,date:new Date().toISOString().slice(0,10)}; localStorage.setItem('atds_ff_cache',JSON.stringify(fc));}catch(e){}}
  // 主源:历史资金流(120天),重试 3 次(东财偶发超时/限流)
  for(var attempt=0;attempt<3;attempt++){
    try{
      var url='https://push2his.eastmoney.com/api/qt/stock/fflow/daykline/get?lmt=0&klt=101&secid='+mkt+'.'+num+'&fields1=f1,f2,f3,f7&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f62,f63';
      var res=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0','Referer':'https://quote.eastmoney.com/'}});
      var j=await res.json();
      var kl=(j&&j.data&&j.data.klines)||[];
      if(kl.length>=3){
        var vals=kl.map(function(line){return parseFloat((line.split(',')[1])||0)||0;});
        function sum(k){return vals.slice(-k).reduce(function(a,b){return a+b;},0);}
        var ff={d1:yi(sum(1)),d3:yi(sum(3)),d5:yi(sum(5))};
        writeCache(ff);
        return ff;
      }
    }catch(e){/* 重试 */}
  }
  // 降级:实时接口(仅当日),d3/d5 置 null 避免重复
  try{
    var url2='https://push2.eastmoney.com/api/qt/stock/fflow/kline/get?secid='+mkt+'.'+num+'&fields1=f1,f2,f3,f7&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f62,f63&klt=101&lmt=5';
    var res2=await fetch(url2,{headers:{'User-Agent':'Mozilla/5.0','Referer':'https://quote.eastmoney.com/'}});
    var j2=await res2.json();
    var kl2=(j2&&j2.data&&j2.data.klines)||[];
    if(kl2.length){
      var d1=yi(parseFloat((kl2[kl2.length-1].split(',')[1])||0)||0);
      var ff2={d1:d1,d3:null,d5:null};
      writeCache(ff2);
      return ff2;
    }
  }catch(e){/* 降级到缓存 */}
  // 失败兜底:浏览器本地缓存(标记 fromCache)
  try{var fc=JSON.parse(localStorage.getItem('atds_ff_cache')||'{}'); if(fc[code]&&fc[code].d1!=null) return {d1:fc[code].d1,d3:fc[code].d3!=null?fc[code].d3:null,d5:fc[code].d5!=null?fc[code].d5:null,fromCache:true,cacheDate:fc[code].date||null};}catch(e){}
  return null;
}
/* 分钟级趋势:60/15分钟 多空;腾讯 mkline 优先,新浪 getKLineData 兜底;失败返回 null */
function computeMinTrendFromClosesF(closes){
  var last=closes[closes.length-1];
  var ma5=closes.slice(-5).reduce(function(a,b){return a+b;},0)/5;
  var ma10=closes.length>=10?closes.slice(-10).reduce(function(a,b){return a+b;},0)/10:null;
  var trend=(ma10!=null)?(last>ma10*1.005?'up':last<ma10*0.995?'down':'flat'):(last>ma5?'up':'down');
  return {trend:trend,ma5:Math.round(ma5*100)/100,ma10:ma10!=null?Math.round(ma10*100)/100:null};
}
/* 日线级别近似趋势:MA20斜率 + 现价相对MA20位置 替代分钟线(无法抓取时的最终兜底,绝不返回空) */
function approxMinFromTechF(tech){
  var slope=(tech&&tech.ma20Slope)||'flat';
  var price=tech&&tech.price;
  var ma20=tech&&tech.ma20;
  var trend='flat';
  if(price!=null&&ma20!=null){
    if(price>ma20&&slope!=='down')trend='up';
    else if(price<ma20)trend='down';
    else trend=(slope==='up')?'up':(slope==='down')?'down':'flat';
  }else if(slope!=='flat'){
    trend=slope;
  }
  return {trend:trend,ma5:(tech&&tech.ma5!=null)?tech.ma5:null,ma10:(tech&&tech.ma10!=null)?tech.ma10:null,approx:true};
}
async function fetchMinuteTrendF(code,klt){
  var num=String(code).replace(/^(sh|sz|bj)/,'');
  var full=/^(4|8|92)/.test(num)?('bj'+num):(num.charAt(0)==='6'||num.charAt(0)==='9'?('sh'+num):('sz'+num));
  try{
    var url='https://ifzq.gtimg.cn/appstock/app/kline/mkline?param='+full+','+klt+',,30';
    var res=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0','Referer':'https://gu.qq.com/'}});
    var j=await res.json();
    var d=(j&&j.data&&j.data[full])||{};
    var arr=d[klt]||[];
    if(Array.isArray(arr)&&arr.length>=5){
      var closes=arr.map(function(k){return parseFloat(k[2]);}).filter(function(x){return !isNaN(x);});
      if(closes.length>=5)return computeMinTrendFromClosesF(closes);
    }
  }catch(e){/* 降级新浪 */}
  try{
    var scale=klt==='m60'?60:15;
    var sinaUrl='https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol='+full+'&scale='+scale+'&ma=no&datalen=30';
    var r2=await fetch(sinaUrl,{headers:{'User-Agent':'Mozilla/5.0','Referer':'https://finance.sina.com.cn/'}});
    var txt=await r2.text();
    if(txt&&txt.trim().charAt(0)==='['){
      var a2=JSON.parse(txt);
      if(Array.isArray(a2)&&a2.length>=5){
        var c2=a2.map(function(k){return parseFloat(k.close);}).filter(function(x){return !isNaN(x);});
        if(c2.length>=5)return computeMinTrendFromClosesF(c2);
      }
    }
  }catch(e){/* 双源均失败 */}
  return null;
}
/* 涨停封单(东财涨停池):匹配单只,非涨停返回 null */
async function fetchLimitUpSealF(code){
  try{
    var num=String(code).replace(/^(sh|sz|bj)/,'');
    var bj=new Date(Date.now()+8*3600*1000);
    var dateStr=bj.toISOString().slice(0,10).replace(/-/g,'');
    var url='https://push2ex.eastmoney.com/getTopicZTPool?ut=7eea3edcaed734bea9cbfc24409ed989&dpt=wz.ztzt&Pageindex=0&pagesize=320&sort=fbt%3Aasc&date='+dateStr;
    var res=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0','Referer':'https://quote.eastmoney.com/'}});
    var j=await res.json();
    var pool=(j&&j.data&&j.data.pool)||[];
    for(var i=0;i<pool.length;i++){
      if(String(pool[i].c)===num){
        var s=pool[i];
        return {sealFund:s.fund||0,zbc:s.zbc||0,lbc:s.lbc||1,fbt:s.fbt||0,lbt:s.lbt||0,days:(s.zttj&&s.zttj.days)||1};
      }
    }
    return null;
  }catch(e){return null;}
}
/* 龙虎榜(东财):聚合机构/游资/北向净买,未上榜返回 null */
async function fetchLhbDetailF(code){
  try{
    var num=String(code).replace(/^(sh|sz|bj)/,'');
    var flt='(SECURITY_CODE%3D%22'+num+'%22)';
    var base='https://datacenter-web.eastmoney.com/api/data/v1/get';
    var hdr={'User-Agent':'Mozilla/5.0','Referer':'https://data.eastmoney.com/'};
    var rb=await fetch(base+'?reportName=RPT_BILLBOARD_DAILYDETAILSBUY&columns=ALL&filter='+flt+'&pageSize=30&sortColumns=TRADE_DATE&sortTypes=-1',{headers:hdr});
    var rs=await fetch(base+'?reportName=RPT_BILLBOARD_DAILYDETAILSSELL&columns=ALL&filter='+flt+'&pageSize=30&sortColumns=TRADE_DATE&sortTypes=-1',{headers:hdr});
    var jb=await rb.json(),js=await rs.json();
    var rows=[].concat(((jb&&jb.result&&jb.result.data)||[]),((js&&js.result&&js.result.data)||[]));
    if(!rows.length)return null;
    var latest=rows.map(function(r){return r.TRADE_DATE;}).filter(Boolean).sort().slice(-1)[0]||'';
    var dayRows=rows.filter(function(r){return r.TRADE_DATE===latest;});
    var inst=0,north=0,youzi=0;
    for(var i=0;i<dayRows.length;i++){
      var net=dayRows[i].NET||0;
      var nm=dayRows[i].OPERATEDEPT_NAME||'';
      if(nm.indexOf('机构')>=0)inst+=net;
      else if(nm.indexOf('沪股通')>=0||nm.indexOf('深股通')>=0)north+=net;
      else youzi+=net;
    }
    function yi(v){return Math.round(v/1e6)/100;}   // 元 → 亿(与 fflow 同基数;原 /1e4 致 100x 放大)
    var attr=[];
    if(inst>0)attr.push('机构');
    if(north>0)attr.push('北向');
    if(youzi>0)attr.push('游资');
    var fundAttr=attr.length>=2?'混合资金':attr.length===1?(attr[0]==='机构'?'机构主导':attr[0]==='北向'?'北向主导':'游资主导'):null;
    var famousKw=['华鑫','东方财富','拉萨','绍兴','江苏路','溧阳路','益田路','淮海中路','佛山','解放南','共和新路','小鳄鱼','章盟主','炒股养家','作手新一','赵老哥'];
    var seen={},famousSeats=[];
    for(var j=0;j<dayRows.length;j++){
      var nm2=dayRows[j].OPERATEDEPT_NAME||'';
      for(var k=0;k<famousKw.length;k++){
        if(nm2.indexOf(famousKw[k])>=0&&!seen[nm2]){seen[nm2]=1;famousSeats.push(nm2);break;}
      }
    }
    return {date:latest.slice(0,10),explain:(dayRows[0]&&dayRows[0].EXPLANATION)||'',changeRate:(dayRows[0]&&dayRows[0].CHANGE_RATE)||0,inst:yi(inst),north:yi(north),youzi:yi(youzi),fundAttr:fundAttr,famousSeats:famousSeats};
  }catch(e){return null;}
}
/* 事件日历(东财):财报预约+业绩预告+解禁;无则返回 null */
async function fetchEventsF(code){
  var num=String(code).replace(/^(sh|sz|bj)/,'');
  var base='https://datacenter-web.eastmoney.com/api/data/v1/get';
  var hdr={'User-Agent':'Mozilla/5.0','Referer':'https://data.eastmoney.com/'};
  var bj=new Date(Date.now()+8*3600*1000);
  var today=bj.toISOString().slice(0,10);
  var events=[];
  function daysLeft(d){return Math.round((new Date(d)-new Date(today))/86400000);}
  async function fjson(reportName,filter,pageSize,sortColumns,sortTypes){
    try{
      var res=await fetch(base+'?reportName='+reportName+'&columns=ALL&filter='+filter+'&pageSize='+pageSize+'&sortColumns='+sortColumns+'&sortTypes='+sortTypes,{headers:hdr});
      var j=await res.json();
      return (j&&j.result&&j.result.data)||[];
    }catch(e){return [];}
  }
  var flt='(SECURITY_CODE%3D%22'+num+'%22)';
  try{
    var appt=await fjson('RPT_PUBLIC_BS_APPOIN',flt,3,'FIRST_APPOINT_DATE',-1);
    for(var i=0;i<appt.length;i++){
      var a=appt[i];var d=(a.FIRST_APPOINT_DATE||'').slice(0,10);
      if(!d||d<today)continue;
      var left=daysLeft(d);
      events.push({type:'财报披露',eventType:'财报披露',name:a.REPORT_TYPE_NAME||(a.REPORT_YEAR+'财报'),date:d,eventDate:d,left:left,countdown:'T-'+left+'天',dir:'中性',direction:'中性',level:left<=3?'高':left<=7?'中':'低',impactLevel:left<=3?'高':left<=7?'中':'低',source:'东财'});
    }
    var pred=await fjson('RPT_PUBLIC_OP_NEWPREDICT',flt,1,'NOTICE_DATE',-1);
    for(var j2=0;j2<pred.length;j2++){
      var p=pred[j2];var amp=(p.ADD_AMP_LOWER||0);
      var dd=(p.NOTICE_DATE||'').slice(0,10);
      if(dd&&daysLeft(dd)<-90)continue;
      events.push({type:'业绩预告',eventType:'业绩预告',name:'',date:dd,eventDate:dd,left:daysLeft(dd||today),countdown:'今日',dir:amp>0?'利好':'利空',direction:amp>0?'利好':'利空',level:'中',impactLevel:'中',detail:(p.PREDICT_CONTENT||'').slice(0,48),source:'东财'});
    }
    var lift=await fjson('RPT_LIFT_STAGE',flt+'(FREE_DATE%3E%3D%27'+today+'%27)',3,'FREE_DATE',1);
    for(var k=0;k<lift.length;k++){
      var l=lift[k];var d2=(l.FREE_DATE||'').slice(0,10);
      if(!d2)continue;
      var left2=daysLeft(d2);
      var cap=(l.LIFT_MARKET_CAP||0);
      events.push({type:'解禁',eventType:'解禁',name:l.FREE_SHARES_TYPE||'限售解禁',date:d2,eventDate:d2,left:left2,countdown:'T-'+left2+'天',dir:'利空',direction:'利空',level:cap>50000?'高':cap>10000?'中':'低',impactLevel:cap>50000?'高':cap>10000?'中':'低',detail:'解禁市值约'+Math.round(cap/10000*100)/100+'亿',source:'东财'});
    }
  }catch(e){}
  return events.length?events:null;
}
function techPosText(t){
  if (!t) return 'K线数据不足';
  var p = [];
  p.push('MA5 ' + (t.ma5 ? (t.last >= t.ma5 ? '上方' : '下方') : '--'));
  p.push('MA10 ' + (t.ma10 ? (t.last >= t.ma10 ? '上方' : '下方') : '--'));
  p.push('MA20 ' + (t.ma20 ? (t.last >= t.ma20 ? '上方' : '下方') : '--'));
  p.push('MA60 ' + (t.ma60 ? (t.last >= t.ma60 ? '上方' : '下方') : '--'));
  var zone = t.rangePos < 35 ? '低位区间' : (t.rangePos > 70 ? '高位区间' : '中位区间');
  return p.join(' · ') + '；20日区间位置 ' + Math.round(t.rangePos) + '%（' + zone + '）';
}
function scoreSystemFit(t){
  if (!t) return { score: 0, level: '数据不足', reasons: ['K线数据不足,无法完整评估'] };
  var score = 0, reasons = [];
  if (t.bullArrange) { score += 40; reasons.push('均线多头排列(+40)'); }
  else if (t.ma10 && t.ma20 && t.ma10 > t.ma20) { score += 25; reasons.push('中短期均线向上(+25)'); }
  else reasons.push('均线尚未多头排列(+0)');
  if (t.rangePos >= 30 && t.rangePos <= 70) { score += 20; reasons.push('20日区间中段,位置适中(+20)'); }
  else if (t.rangePos < 30) { score += 15; reasons.push('低位区间,位置偏低(+15)'); }
  else reasons.push('位置偏高,追高风险(+5)');
  if (t.volRatio && t.volRatio > 1.2) { score += 20; reasons.push('量能放大配合(+20)'); }
  else if (t.volRatio && t.volRatio > 0.8) { score += 12; reasons.push('量能温和(+12)'); }
  else reasons.push('量能不足(+0)');
  if (t.bias20 != null && Math.abs(t.bias20) <= 8) { score += 20; reasons.push('乖离适中,回踩可控(+20)'); }
  else if (t.bias20 != null && t.bias20 > 8) reasons.push('乖离过大,短期回吐压力(+5)');
  else reasons.push('乖离过小,动能待观察(+10)');
  var level = score >= 80 ? '符合' : (score >= 60 ? '部分符合' : '不符合');
  return { score: score, level: level, reasons: reasons };
}
function genBuyReason(t, data){
  if (!t) return 'K线数据不足,暂无法给出买点建议。';
  var r = [];
  if (t.bullArrange && t.rangePos > 50) r.push('趋势多头向上');
  if (t.nearMa20) r.push('回踩至20日均线附近,属低吸区间');
  else if (t.bias20 != null && t.bias20 > 8) r.push('短期乖离偏大,不宜追高,等待回踩');
  else if (t.rangePos < 35) r.push('处于20日低位区间,具备低位布局条件');
  if (t.volRatio && t.volRatio > 1.2 && t.pct5 > 0) r.push('量能放大配合上涨');
  if (t.pct5 > 10) r.push('近5日涨幅已超10%,注意控制节奏');
  return r.length ? r.join(';') + '。' : '当前量价信号中性,建议等待明确信号再介入。';
}
function genSellSignal(t, data){
  if (!t) return 'K线数据不足,暂无法给出卖出信号。';
  var r = [];
  if (t.last < t.ma20) r.push('现价已跌破20日均线,趋势转弱,考虑减仓/止损');
  if (t.bias20 != null && t.bias20 > 15) r.push('乖离率超15%,短期过热,可分批止盈');
  if (t.volRatio && t.volRatio > 2 && t.pct5 < 0) r.push('放量下跌,警惕破位风险');
  if (!r.length) r.push('趋势仍健康,持有观察;跌破20日均线或触及止损位再执行卖出');
  return r.join(';') + '。';
}
function renderTradeReviewResult(data, t){
  var fit = scoreSystemFit(t);
  var fitCls = fit.level === '符合' ? 'ok' : (fit.level === '部分符合' ? 'mid' : 'no');
  return '<div class="modal-section"><div class="modal-section-h">① 股票 <small>实时行情</small></div>' +
    '<div class="modal-info">' + data.name + '（' + data.code + '）现价 ' + data.price + ' 元，' + (data.pct >= 0 ? '+' : '') + data.pct + '%；成交额 ' + data.amount + '，换手 ' + data.turnover + '%</div></div>' +
    '<div class="modal-section"><div class="modal-section-h">② 买点K线位置 <small>技术位置</small></div>' +
    '<div class="modal-card">' + techPosText(t) + '</div></div>' +
    '<div class="modal-section"><div class="modal-section-h">③ 买入理由 <small>自动生成</small></div>' +
    '<div class="modal-card">' + genBuyReason(t, data) + '</div></div>' +
    '<div class="modal-section"><div class="modal-section-h">④ 是否符合系统 <small>ATDS 规则评分</small></div>' +
    '<div class="modal-score"><div><div class="modal-score-num">' + fit.score + '</div><div class="modal-score-label">系统符合分</div></div>' +
    '<div style="text-align:right;"><div class="modal-score-stars">' + fit.level + '</div><div class="modal-score-label ' + fitCls + '">' + (fit.score >= 80 ? '可执行' : (fit.score >= 60 ? '谨慎执行' : '暂不参与')) + '</div></div></div>' +
    '<div class="modal-card">' + fit.reasons.join('；') + '</div></div>' +
    '<div class="modal-section"><div class="modal-section-h">⑤ 卖出原因 <small>信号提示</small></div>' +
    '<div class="modal-card">' + genSellSignal(t, data) + '</div></div>' +
    '<div class="modal-section"><div class="modal-info" style="border-left:2px solid #c33;">仅供复盘参考,不构成投资建议。' + (t ? '' : 'K线获取失败,请检查网络后重试。') + '</div></div>';
}
function openTradeReview(){
  var exists = document.getElementById('trade-review-modal');
  if (exists) { exists.classList.add('show'); document.body.style.overflow = 'hidden'; return; }
  var modal = document.createElement('div');
  modal.className = 'modal-mask'; modal.id = 'trade-review-modal';
  modal.onclick = function(e){ if (e.target === modal) closeTradeReview(); };
  modal.innerHTML = '<div class="modal" onclick="event.stopPropagation()">' +
    '<div class="modal-header"><div class="modal-eyebrow">📒 交易复盘 · 个股分析</div><span class="modal-close" onclick="closeTradeReview()">×</span></div>' +
    '<div class="modal-body">' +
      '<div class="modal-section"><div class="modal-section-h">输入股票代码</div>' +
        '<div class="modal-input-row"><input id="tr-code-input" class="modal-code-input" placeholder="如 600519" maxlength="6" onkeydown="if(event.key===\'Enter\')runTradeReview()"/><button class="wl-btn wl-btn-primary" onclick="runTradeReview()">开始分析</button></div>' +
        '<div class="modal-info">自动生成：买点K线位置 / 买入理由 / 系统符合度 / 卖出原因</div>' +
      '</div><div id="tr-result"></div>' +
    '</div></div>';
  document.body.appendChild(modal); modal.classList.add('show'); document.body.style.overflow = 'hidden';
  setTimeout(function(){ var i = document.getElementById('tr-code-input'); if (i) i.focus(); }, 100);
}
function closeTradeReview(){ var m = document.getElementById('trade-review-modal'); if (m) { m.classList.remove('show'); document.body.style.overflow = ''; } }
async function runTradeReview(){
  var input = document.getElementById('tr-code-input');
  var res = document.getElementById('tr-result');
  if (!input || !res) return;
  var code = (input.value || '').trim().replace(/\D/g, '');
  if (!/^\d{6}$/.test(code)) { res.innerHTML = '<div class="modal-info">请输入 6 位股票代码</div>'; return; }
  res.innerHTML = '<div class="modal-info">⏳ 正在获取行情与K线...</div>';
  var data = await fetchStockData(code);
  if (!data) { res.innerHTML = '<div class="modal-info">未找到该股票，请检查代码或网络</div>'; return; }
  var c0 = code.charAt(0);
  var full = (c0 === '6' ? 'sh' : (c0 === '4' || c0 === '8' || c0 === '9' ? 'bj' : 'sz')) + code;
  var kl = await fetchKlineF(full, 70);
  var t = computeTechMetrics(kl);
  res.innerHTML = renderTradeReviewResult(data, t);
}
function openBehaviorReview(){
  var exists = document.getElementById('behavior-review-modal');
  if (exists) { exists.classList.add('show'); document.body.style.overflow = 'hidden'; return; }
  var modal = document.createElement('div');
  modal.className = 'modal-mask'; modal.id = 'behavior-review-modal';
  modal.onclick = function(e){ if (e.target === modal) closeBehaviorReview(); };
  modal.innerHTML = '<div class="modal" onclick="event.stopPropagation()">' +
    '<div class="modal-header"><div class="modal-eyebrow">📊 交易行为复盘 · 行为偏差</div><span class="modal-close" onclick="closeBehaviorReview()">×</span></div>' +
    '<div class="modal-body">' +
      '<div class="modal-section"><div class="modal-section-h">输入股票与成本价 <small>成本价选填</small></div>' +
        '<div class="modal-input-row"><input id="br-code-input" class="modal-code-input" placeholder="代码 如 600519" maxlength="6"/>' +
        '<input id="br-cost-input" class="modal-code-input" style="width:88px" placeholder="成本价 选填" onkeydown="if(event.key===\'Enter\')runBehaviorReview()"/></div>' +
        '<div style="margin-top:8px;"><button class="wl-btn wl-btn-primary" onclick="runBehaviorReview()">开始行为分析</button></div>' +
        '<div class="modal-info">自动分析：追高 / 杀跌 / 持仓周期 / 情绪化交易 与优化规则</div>' +
      '</div><div id="br-result"></div>' +
    '</div></div>';
  document.body.appendChild(modal); modal.classList.add('show'); document.body.style.overflow = 'hidden';
  setTimeout(function(){ var i = document.getElementById('br-code-input'); if (i) i.focus(); }, 100);
}
function closeBehaviorReview(){ var m = document.getElementById('behavior-review-modal'); if (m) { m.classList.remove('show'); document.body.style.overflow = ''; } }
function renderBehaviorResult(data, t, cost){
  if (!t) return '<div class="modal-info">K线获取失败,请检查网络后重试。</div>';
  var buyPos = null, loss = null;
  if (cost && t.high20 > t.low20) buyPos = (cost - t.low20) / (t.high20 - t.low20) * 100;
  if (cost) loss = (data.price / cost - 1) * 100;
  // 追高
  var chaseLevel, chaseTip;
  var refPos = buyPos != null ? buyPos : t.rangePos;
  if (refPos > 90) { chaseLevel = '严重追高'; chaseTip = '买入价位于20日区间极高位,风险大'; }
  else if (refPos > 70) { chaseLevel = '偏高追高'; chaseTip = '买入价位于区间偏高位,注意回调'; }
  else { chaseLevel = '正常'; chaseTip = '买入位置尚可'; }
  // 杀跌
  var killLevel = '无法评估', killTip = '未填成本价,无法评估盈亏与杀跌风险';
  if (loss != null) {
    if (loss <= -8) { killLevel = '深套区'; killTip = '当前浮亏约 ' + Math.round(loss) + '%,处于恐慌杀跌高风险区'; }
    else if (loss <= -3) { killLevel = '浮亏区'; killTip = '当前浮亏约 ' + Math.round(loss) + '%,注意止损纪律'; }
    else if (loss < 0) { killLevel = '微亏区'; killTip = '当前浮亏约 ' + Math.round(loss) + '%,关注企稳信号'; }
    else { killLevel = '盈利区'; killTip = '当前盈利约 ' + Math.round(loss) + '%,可执行止盈规则'; }
  }
  // 持仓周期
  var cycle = t.amp20 < 15 ? '波段/趋势' : (t.amp20 > 25 ? '短线为主' : '短线-波段兼顾');
  var cycleTip = t.amp20 < 15 ? '20日振幅约 ' + Math.round(t.amp20) + '%,波动温和,适合波段持有,不宜频繁进出' :
    (t.amp20 > 25 ? '20日振幅约 ' + Math.round(t.amp20) + '%,波动剧烈,短线机会多但必须严格止损' : '20日振幅约 ' + Math.round(t.amp20) + '%,中波动态,建议明确周期后按计划执行');
  // 情绪化特征
  var emo = [];
  if (refPos > 85) emo.push('追高特征明显');
  if (loss != null && loss <= -8) emo.push('深跌中易恐慌割肉');
  if (t.volRatio && t.volRatio > 1.8 && t.pct5 < 2) emo.push('放量滞涨,情绪化交易迹象');
  if (t.pct5 > 15) emo.push('近5日涨幅过大,存在情绪化追涨风险');
  if (!emo.length) emo.push('未见明显情绪化特征,执行纪律较好');
  // 优化规则
  var rules = [];
  if (refPos > 70) rules.push('避免在高位区间追入;等待回调至均线支撑附近再介入');
  if (loss != null && loss <= -3) rules.push('设定止损位并严格执行,跌破即离场,不因恐慌情绪补仓或清仓');
  rules.push('明确持仓周期(' + cycle + '),按周期持有,不随意切换策略');
  rules.push('按 ATDS 系统信号执行,把规则写进交易计划,减少盘中临时决策');
  var buyPosText = buyPos != null ? '成本价在20日区间位置 ' + Math.round(buyPos) + '%' : '未填成本价,以现价在区间位置 ' + Math.round(t.rangePos) + '% 参照评估';
  var lossText = loss != null ? '当前盈亏 ' + (loss >= 0 ? '+' : '') + Math.round(loss) + '%' : '未填成本价';
  return '<div class="modal-section"><div class="modal-section-h">① 追高评估 <small>买入位置</small></div>' +
    '<div class="modal-card"><b class="' + (refPos > 70 ? 'no' : 'ok') + '">' + chaseLevel + '</b> · ' + buyPosText + '（' + chaseTip + '）</div></div>' +
    '<div class="modal-section"><div class="modal-section-h">② 杀跌评估 <small>盈亏与风险</small></div>' +
    '<div class="modal-card"><b>' + killLevel + '</b> · ' + lossText + '（' + killTip + '）</div></div>' +
    '<div class="modal-section"><div class="modal-section-h">③ 持仓周期匹配 <small>波动结构</small></div>' +
    '<div class="modal-card">适配周期：<b>' + cycle + '</b> · ' + cycleTip + '</div></div>' +
    '<div class="modal-section"><div class="modal-section-h">④ 情绪化交易检测</div>' +
    '<div class="modal-card">' + emo.join('；') + '</div></div>' +
    '<div class="modal-section"><div class="modal-section-h">⑤ 优化规则 <small>行为改进</small></div>' +
    '<div class="modal-card">' + rules.map(function(r){ return '· ' + r; }).join('<br>') + '</div></div>' +
    '<div class="modal-section"><div class="modal-info" style="border-left:2px solid #c33;">仅供行为复盘参考,不构成投资建议。</div></div>';
}
async function runBehaviorReview(){
  var codeInput = document.getElementById('br-code-input');
  var costInput = document.getElementById('br-cost-input');
  var res = document.getElementById('br-result');
  if (!codeInput || !res) return;
  var code = (codeInput.value || '').trim().replace(/\D/g, '');
  if (!/^\d{6}$/.test(code)) { res.innerHTML = '<div class="modal-info">请输入 6 位股票代码</div>'; return; }
  var costRaw = (costInput.value || '').trim();
  var cost = costRaw ? parseFloat(costRaw) : null;
  if (costRaw && !(cost > 0)) { res.innerHTML = '<div class="modal-info">成本价格式不正确</div>'; return; }
  res.innerHTML = '<div class="modal-info">⏳ 正在获取行情与K线...</div>';
  var data = await fetchStockData(code);
  if (!data) { res.innerHTML = '<div class="modal-info">未找到该股票,请检查代码或网络</div>'; return; }
  var c0 = code.charAt(0);
  var full = (c0 === '6' ? 'sh' : (c0 === '4' || c0 === '8' || c0 === '9' ? 'bj' : 'sz')) + code;
  var kl = await fetchKlineF(full, 70);
  var t = computeTechMetrics(kl);
  res.innerHTML = renderBehaviorResult(data, t, cost);
}

/* ==================== 观察池 Pro 交互层(第十二轮:手动标签/筛选排序/红绿切换/倒计时/复盘日志/移动端折叠) ==================== */
/* 手动标签:催化时效/情绪周期/容错率 —— localStorage 持久化,不依赖 API */
function getManualTags(){ try{return JSON.parse(localStorage.getItem('atds_manual_tags')||'{}');}catch(e){return {};} }
function setManualTag(code,field,val){
  try{var t=getManualTags(); if(!t[code])t[code]={}; t[code][field]=val; localStorage.setItem('atds_manual_tags',JSON.stringify(t));}catch(e){}
}
/* 红涨绿跌切换(默认国内红涨绿跌;切换为国际绿涨红跌) */
function toggleColorScheme(){
  var cur=localStorage.getItem('atds_color_scheme')||'cn';
  var next=cur==='cn'?'intl':'cn';
  localStorage.setItem('atds_color_scheme',next);
  applyColorScheme(next);
  var btn=document.getElementById('wl-pro-color-btn');
  if(btn)btn.textContent=next==='cn'?'🎨 红涨绿跌':'🎨 绿涨红跌';
}
function applyColorScheme(scheme){
  var id='atds-color-scheme-style',el=document.getElementById(id);
  if(!el){el=document.createElement('style');el.id=id;document.head.appendChild(el);}
  el.textContent=(scheme==='intl')?'.up,.up *{color:#16a34a!important}.down,.down *{color:#e11d48!important}':'';
}
/* 按优先级排序(★★★→★★→★) */
function sortWatchlistByPriority(){
  var wrap=document.querySelector('.wl-stocks-scroll')||document.querySelector('.wl-stocks');
  if(!wrap)return;
  var stocks=Array.prototype.slice.call(wrap.querySelectorAll('.wl-stock'));
  stocks.sort(function(a,b){
    function pri(el){var d=el.querySelector('.dc-pri');return d?(d.textContent.replace(/[^★]/g,'').length):0;}
    return pri(b)-pri(a);
  });
  stocks.forEach(function(el){wrap.appendChild(el);});
}
/* 手动标签编辑器:为每只股票决策卡注入三个下拉(催化时效/情绪周期/容错率) */
function showTagEditor(){
  var cards=document.querySelectorAll('.wl-detail');
  var tags=getManualTags();
  var timeOpts=['短线1-3天','波段1-2周','中线逻辑'];
  var emoOpts=['冰点','修复','加速','分歧','退潮'];
  var tolOpts=['容错高','容错中','容错低'];
  function sel(field,opts,cur,label){
    var o='<select class="dc-te-select" data-field="'+field+'" data-label="'+label+'"><option value="">'+label+'</option>';
    for(var i=0;i<opts.length;i++){var v=opts[i];o+='<option value="'+v+'"'+(cur===v?' selected':'')+'>'+v+'</option>';}
    return o+'</select>';
  }
  for(var i=0;i<cards.length;i++){
    var d=cards[i];
    var code=d.getAttribute('data-detail-code'); if(!code)continue;
    if(d.querySelector('.dc-tag-editor'))continue;
    var t=tags[code]||{};
    var ed=document.createElement('div');
    ed.className='dc-tag-editor';
    ed.innerHTML='<span class="dc-te-label">手动标签:</span>'+sel('time',timeOpts,t.time,'催化时效')+sel('emotion',emoOpts,t.emotion,'情绪周期')+sel('tolerance',tolOpts,t.tolerance,'容错率');
    var tagsRow=d.querySelector('.dc-tags');
    if(tagsRow)tagsRow.parentNode.insertBefore(ed,tagsRow.nextSibling);
    else d.appendChild(ed);
  }
  var selects=document.querySelectorAll('.dc-te-select');
  for(var j=0;j<selects.length;j++){
    selects[j].onchange=function(){
      var d=this.closest('.wl-detail');
      var code=d?d.getAttribute('data-detail-code'):null;
      if(!code)return;
      setManualTag(code,this.getAttribute('data-field'),this.value);
      updateManualTagLabel(code);
    };
  }
}
function updateManualTagLabel(code){
  var tags=getManualTags();var t=tags[code]||{};
  var d=document.querySelector('.wl-detail[data-detail-code="'+code+'"]');
  if(!d)return;
  var all=d.querySelectorAll('.dc-tags .dc-tag');
  for(var i=0;i<all.length;i++){
    var sp=all[i],txt=sp.textContent;
    if(t.time&&txt.indexOf('时效:')===0)sp.textContent='时效:'+t.time;
    if(t.emotion&&txt.indexOf('情绪:')===0)sp.textContent='情绪:'+t.emotion;
    if(t.tolerance&&/^容错[高中低]$/.test(txt))sp.textContent=t.tolerance;
  }
}
/* 刷新倒计时进度条(5秒) */
var wlCdTimer=null;
function startRefreshCountdown(){
  var bar=document.getElementById('wl-refresh-bar'); if(!bar)return;
  var total=5,left=total;
  if(wlCdTimer)clearInterval(wlCdTimer);
  wlCdTimer=setInterval(function(){
    left-=0.1; if(left<=0)left=total;
    bar.style.width=Math.round(left/total*52)+'px';
    var txt=document.getElementById('wl-refresh-time');
    if(txt)txt.textContent=left.toFixed(1)+'s';
  },100);
}
/* 复盘交易日志(localStorage):统计胜率/平均盈亏/连续亏损 */
function getJournal(){ try{return JSON.parse(localStorage.getItem('atds_trade_journal')||'[]');}catch(e){return [];} }
function addJournalEntry(entry){ try{var j=getJournal();j.push(entry);localStorage.setItem('atds_trade_journal',JSON.stringify(j));}catch(e){} }
function recordTrade(code,name,entry,stop,target){
  var price=Number(document.querySelector('.wl-stock-row[data-code="'+code+'"] .price')||{})||0;
  var pnl=null;
  if(price&&entry&&price!==entry)pnl=Math.round((price-entry)/entry*10000)/100;
  addJournalEntry({code:code,name:name||code,date:new Date().toISOString().slice(0,10),entry:entry,stop:stop,target:target,close:price,pnl:pnl,strategy:'swing'});
  renderJournalStats();
  var pnlTxt=pnl==null?'--':((pnl>0?'+':'')+pnl+'%');
  alert('已记录交易:'+name+'('+code+') 入场'+entry+' 现价'+price+' 盈亏'+pnlTxt);
}
function renderJournalStats(){
  var el=document.getElementById('wl-journal-stats'); if(!el)return;
  var j=getJournal();
  if(!j.length){el.innerHTML='复盘统计:暂无交易记录';return;}
  function calcStats(arr){
    var wins=0,losses=0,sumWin=0,sumLoss=0;
    for(var i=0;i<arr.length;i++){var p=arr[i].pnl||0;if(p>0){wins++;sumWin+=p;}else if(p<0){losses++;sumLoss+=p;}}
    return {winRate:arr.length?Math.round(wins/arr.length*100)+'%':'--',avgWin:wins?Math.round(sumWin/wins*100)/100:'--',avgLoss:losses?Math.round(sumLoss/losses*100)/100:'--',n:arr.length};
  }
  var swing=calcStats(j.filter(function(x){return x.strategy!=='tTrade';}));
  var tT=calcStats(j.filter(function(x){return x.strategy==='tTrade';}));
  var html='复盘统计：波段策略胜率 <b>'+swing.winRate+'</b>（'+swing.n+'笔 · 均盈 '+swing.avgWin+'% / 均亏 '+swing.avgLoss+'%）'+
    ' ｜ 日内做T胜率 <b>'+(tT.n?tT.winRate:'--')+'</b>（'+tT.n+'笔'+(tT.n?' · 均盈 '+tT.avgWin+'% / 均亏 '+tT.avgLoss+'%':'')+'）';
  el.innerHTML=html;
}
// 记录日内做T(方案C)盈亏,独立计入"做T胜率"样本
function recordTTrade(btn){
  var code=btn.getAttribute('data-code');
  var block=btn.closest('.dc-review');
  var name=(block?block.getAttribute('data-name'):'')||code;
  var price=block?parseFloat(block.getAttribute('data-price'))||0:0;
  var input=null;
  try{input=prompt('记录日内做T（方案C）盈亏：\n请输入盈亏百分比，例如 +1.2 或 -0.5','+1.0');}catch(e){}
  if(input==null)return;
  var pnl=parseFloat(String(input).replace('%',''));
  if(isNaN(pnl)){try{alert('请输入有效数字，如 +1.2 或 -0.5');}catch(e){}return;}
  addJournalEntry({code:code,name:name,date:new Date().toISOString().slice(0,10),entry:price,stop:null,target:null,close:price,pnl:pnl,shadow:false,result:(pnl>=0?'win':'loss'),strategy:'tTrade'});
  updateReviewProgress();
  renderJournalStats();
  try{alert('已记录做T：'+name+'('+code+') 盈亏 '+(pnl>0?'+':'')+pnl+'%');}catch(e){}
}
/* ===== 盘后复盘:交易状态 + 系统模拟跟踪(Shadow Tracking) + 胜率进度 ===== */
function getTradeStatusMap(){ try{return JSON.parse(localStorage.getItem('atds_trade_status')||'{}');}catch(e){return {};} }
function setTradeStatusMap(m){ try{localStorage.setItem('atds_trade_status',JSON.stringify(m));}catch(e){} }
function getShadowMap(){ try{return JSON.parse(localStorage.getItem('atds_shadow')||'{}');}catch(e){return {};} }
function setShadowMap(m){ try{localStorage.setItem('atds_shadow',JSON.stringify(m));}catch(e){} }

function togglePlanBlock(h){
  var block=h.closest('.dc-plan');
  if(!block)return;
  var collapsed=block.classList.toggle('dc-plan-collapsed');
  var caret=block.querySelector('.dc-plan-caret');
  if(caret)caret.textContent=collapsed?'▸':'▾';
}

function setTradeStatus(btn,status){
  var code=btn.getAttribute('data-code');
  var block=btn.closest('.dc-review');
  var m=getTradeStatusMap();
  var rec=m[code]||{};
  rec.status=status;
  rec.name=rec.name||(block?block.getAttribute('data-name'):'')||code;
  if(status==='bought'&&block){
    rec.entry=parseFloat(block.getAttribute('data-entry'))||null;
    rec.stop=parseFloat(block.getAttribute('data-stop'))||null;
    rec.target=parseFloat(block.getAttribute('data-target'))||null;
    rec.date=new Date().toISOString().slice(0,10);
    rec.settled=false;
  }
  if(status==='sold'&&block&&rec.entry&&!rec.settled){
    var price=parseFloat(block.getAttribute('data-price'))||0;
    var pnl=price?Math.round((price-rec.entry)/rec.entry*10000)/100:null;
    addJournalEntry({code:code,name:rec.name,date:new Date().toISOString().slice(0,10),entry:rec.entry,stop:rec.stop,target:rec.target,close:price,pnl:pnl,shadow:false,result:pnl!=null?(pnl>=0?'win':'loss'):null});
    rec.settled=true;
  }
  m[code]=rec;
  setTradeStatusMap(m);
  if(block){
    var btns=block.querySelectorAll('.ts-btn');
    for(var i=0;i<btns.length;i++)btns[i].classList.remove('ts-active');
    btn.classList.add('ts-active');
  }
  // 联动交互:点击"未买入" → 自动勾选"系统模拟跟踪"(toggleShadowTrack 内部会弹绿色 Toast)
  if(status==='not_bought'&&block){
    var shadowCb=block.querySelector('.ts-shadow-check');
    if(shadowCb&&!shadowCb.checked){
      shadowCb.checked=true;
      toggleShadowTrack(shadowCb);
    }
  }
  updateReviewProgress();
  try{renderJournalStats();}catch(e){}
}

function toggleShadowTrack(cb){
  var code=cb.getAttribute('data-code');
  var block=cb.closest('.dc-review');
  var m=getShadowMap();
  if(cb.checked&&block){
    m[code]={enabled:true,name:block.getAttribute('data-name')||code,entry:parseFloat(block.getAttribute('data-entry'))||null,stop:parseFloat(block.getAttribute('data-stop'))||null,target:parseFloat(block.getAttribute('data-target'))||null,openedDate:new Date().toISOString().slice(0,10),settled:false};
    try{localStorage.setItem('sim_track_'+code,'true');}catch(e){}
    showToast('已加入模拟跟踪队列，开始累积样本');
  }else{
    if(m[code])delete m[code];
    try{localStorage.removeItem('sim_track_'+code);}catch(e){}
  }
  setShadowMap(m);
  updateReviewProgress();
}

function settleShadowTrade(code){
  var sm=getShadowMap();
  var rec=sm[code];
  if(!rec||!rec.enabled||rec.settled)return;
  var block=document.querySelector('.dc-review[data-review-code="'+code+'"]');
  if(!block)return;
  var price=parseFloat(block.getAttribute('data-price'));
  var entry=rec.entry,stop=rec.stop,target=rec.target;
  if(isNaN(price)||!entry||!stop||!target)return;
  var result=null,pnl=null;
  if(price>=target){result='win';pnl=Math.round((target-entry)/entry*10000)/100;}
  else if(price<=stop){result='loss';pnl=Math.round((stop-entry)/entry*10000)/100;}
  if(result){
    rec.settled=true;rec.result=result;rec.pnl=pnl;
    setShadowMap(sm);
    addJournalEntry({code:code,name:rec.name||code,date:new Date().toISOString().slice(0,10),entry:entry,stop:stop,target:target,close:price,pnl:pnl,shadow:true,result:result,strategy:'swing'});
  }
}

function settleAllShadowTrades(){
  var sm=getShadowMap();
  for(var code in sm){ if(sm[code]&&sm[code].enabled&&!sm[code].settled)settleShadowTrade(code); }
  updateReviewProgress();
}

function updateReviewProgress(){
  var j=getJournal();
  var total=j.length;
  var wins=0;
  for(var i=0;i<j.length;i++){ if((j[i].pnl||0)>0)wins++; }
  var els=document.querySelectorAll('.ts-progress');
  for(var k=0;k<els.length;k++)els[k].textContent=total+'/10';
  var statEls=document.querySelectorAll('.ts-winrate');
  var txt=total>=10?(' · 已积累 '+total+' 笔，模拟/真实胜率 '+Math.round(wins/total*100)+'%'):'';
  for(var m2=0;m2<statEls.length;m2++)statEls[m2].textContent=txt;
}

// 绿色 Toast 反馈(复用单例,避免反复建 DOM)
function showToast(msg,type){
  try{
    var t=document.getElementById('atds-toast');
    if(!t){
      t=document.createElement('div');
      t.id='atds-toast';
      t.className='atds-toast';
      document.body.appendChild(t);
    }
    t.textContent=msg;
    t.style.background=(type==='warn')?'#d49000':'#2e7d32';
    t.classList.add('show');
    clearTimeout(t.__timer);
    t.__timer=setTimeout(function(){t.classList.remove('show');},2200);
  }catch(e){}
}
// 恢复单个 .dc-review 块的勾选/交易状态(供 initReviewState 与 refreshWatchlistQuotes 重建后复用)
function applyReviewState(block){
  if(!block)return;
  var code=block.getAttribute('data-review-code');
  if(!code)return;
  var sm=getTradeStatusMap();
  var rec=sm[code];
  if(rec&&rec.status){
    var btns=block.querySelectorAll('.ts-btn');
    for(var j=0;j<btns.length;j++){ if(btns[j].getAttribute('data-status')===rec.status)btns[j].classList.add('ts-active'); }
  }
  var cb=block.querySelector('.ts-shadow-check');
  if(cb){
    var sh=getShadowMap();
    var enabled=sh[code]&&sh[code].enabled;
    if(!enabled){ try{ enabled=localStorage.getItem('sim_track_'+code)==='true'; }catch(e){} }
    cb.checked=!!enabled;
  }
  bindReviewHoverPause(block);   // 重建后的块重新挂悬停暂停,避免刷新打断交互
}
// 悬停在复盘区时暂停自动刷新,离开后恢复(避免刷新打断勾选/点击)
function bindReviewHoverPause(block){
  if(!block||block.getAttribute('data-hover-bound'))return;
  block.setAttribute('data-hover-bound','1');
  block.addEventListener('mouseenter',function(){_wlRefreshPaused=true;});
  block.addEventListener('mouseleave',function(){_wlRefreshPaused=false;});
}
function initReviewState(){
  var blocks=document.querySelectorAll('.dc-review');
  for(var i=0;i<blocks.length;i++){
    applyReviewState(blocks[i]);
  }
  settleAllShadowTrades();
}
window.setTradeStatus=setTradeStatus;
window.toggleShadowTrack=toggleShadowTrack;
window.togglePlanBlock=togglePlanBlock;
if(document.readyState==='complete'||document.readyState==='interactive'){setTimeout(initReviewState,500);}else{document.addEventListener('DOMContentLoaded',function(){setTimeout(initReviewState,500);});}
/* 移动端:点击决策卡头部折叠/展开详情 */
function bindMobileCollapse(){
  if(window.innerWidth>768)return;
  var heads=document.querySelectorAll('.wl-detail .dc-head');
  for(var i=0;i<heads.length;i++){
    heads[i].onclick=function(){
      var d=this.closest('.wl-detail');
      if(d)d.classList.toggle('open');
    };
  }
}
/* 初始化观察池 Pro UI(控制条) */
function initWatchlistProUI(){
  var card=document.querySelector('.watchlist-card');
  if(!card)return;
  if(document.getElementById('wl-pro-bar'))return;
  var bar=document.createElement('div');
  bar.className='wl-pro-bar';
  bar.id='wl-pro-bar';
  bar.innerHTML='<span class="wl-pro-title">⚡ 交易决策观察池</span>'+
    '<button id="wl-pro-color-btn" class="wl-pro-btn" onclick="toggleColorScheme()">🎨 红涨绿跌</button>'+
    '<button class="wl-pro-btn" onclick="showTagEditor()">🏷 手动标签</button>'+
    '<button class="wl-pro-btn" onclick="sortWatchlistByPriority()">★ 优先级排序</button>'+
    '<span class="wl-pro-countdown"><span id="wl-refresh-bar" class="wl-refresh-bar"></span><span id="wl-refresh-time">5.0s</span></span>'+
    '<span id="wl-journal-stats" class="wl-journal-stats"></span>';
  card.insertBefore(bar,card.firstChild);
  var scheme=localStorage.getItem('atds_color_scheme')||'cn';
  applyColorScheme(scheme);
  var cb=document.getElementById('wl-pro-color-btn');
  if(cb)cb.textContent=scheme==='cn'?'🎨 红涨绿跌':'🎨 绿涨红跌';
  startRefreshCountdown();
  renderJournalStats();
  bindMobileCollapse();
}
window.recordTrade=recordTrade;
window.recordTTrade=recordTTrade;
window.getManualTags=getManualTags;
window.setManualTag=setManualTag;
if(document.readyState==='complete'||document.readyState==='interactive'){setTimeout(initWatchlistProUI,700);}else{document.addEventListener('DOMContentLoaded',function(){setTimeout(initWatchlistProUI,700);});}
