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
      var data={code:retCode,name:f[1],price:parseFloat(f[3]),pct:parseFloat(f[32])||0,amount:((parseFloat(f[37])||0)/10000).toFixed(1)+"亿",turnover:f[38]||"--",setcode:sc};
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
  if(atds>=85 && !document.querySelector('.wl-stock-row[data-code="'+code+'"]')){addToWatchlistUI(data);saveWatchlist();setTimeout(function(){var el=document.querySelector('.wl-stock-row[data-code="'+code+'"]');if(el)el.style.background="#e8f5e9";},50);}
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
  addToWatchlistUI(data);
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
    return Array.isArray(series) ? series : [];
  } catch (e) { return []; }
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
function deriveRiskLevelF(pct){var v=Number(pct)||0;if(v>=5||v<=-5)return{name:'高风险',tone:'high'};if(v>=2||v<=-2)return{name:'中风险',tone:'mid'};return{name:'低风险',tone:'low'};}
function deriveTimeHorizonF(pct,turnover){var v=Number(pct)||0,t=Number(turnover)||0;if(v>=3&&t>=2)return{name:'短线',tone:'short'};if(v>=-1&&v<=3&&t>=0.5)return{name:'波段',tone:'wave'};return{name:'长线',tone:'long'};}
function deriveAdviceF(pct,atds,riskTone){var v=Number(pct)||0,a=Number(atds)||0;if(v<=-5)return{name:'减仓规避',tone:'cut'};if(a>=85&&riskTone!='high')return{name:'重点关注',tone:'focus'};if(a>=70)return{name:'持有观察',tone:'hold'};if(a<60&&v<=-1)return{name:'观望',tone:'wait'};return{name:'持有观察',tone:'hold'};}
function deriveRiskTextF(pct,turnover){var v=Number(pct)||0,t=Number(turnover)||0,lines=[];if(v>=5)lines.push('涨幅>5%,RSI 超买区');else if(v>=2)lines.push('涨幅 2-5%,技术偏强');else if(v>=-1)lines.push('震荡整理,方向未明');else if(v>=-3)lines.push('回调 2-3%,观察支撑');else lines.push('跌幅>3%,风险增大');if(t>=5)lines.push('放量活跃');else if(t>=2)lines.push('量能温和');else if(t>=0.5)lines.push('量能一般');else lines.push('量能偏低');return lines;}
function deriveHorizonLinesF(pct,turnover){var v=Number(pct)||0,t=Number(turnover)||0,sh=v>=3&&t>=2?'回踩 MA5 不破可继续,跌破减仓':v>=1?'区间震荡,顺势做 T,关注 MA10':v<=-3?'下跌趋势,反弹至 MA5 减仓':'区间震荡,关注 MA10 方向选择';var wa=v>=2?'沿 MA20 运行,跌破 MA60 警惕走弱':v<=-2?'跌至 MA20 下方,关注 MA60 是否扣住':'区间震荡,等待 MA20 方向选择';var lo=v>=0?'站上 MA120 偏多,关注 MA250 突破':'跌破 MA120,长线宜减仓观望';return[{k:'短线',v:sh},{k:'波段',v:wa},{k:'长线',v:lo}];}
function deriveAdviceTextF(pct,atds,riskTone){var v=Number(pct)||0,a=Number(atds)||0;if(v<=-5)return'跌幅较大,建议减仓规避';if(a>=85&&riskTone!='high')return'ATDS 证据强,重点关注';if(a>=75&&v>=0)return'持有观察,等待放量催化';if(a<60&&v<=-1)return'技术偏弱,观望等待企稳';if(v>=5)return'高位震荡,逢高减仓为主';return'持有观察,关注量能配合';}
function escHtmlF(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
// 自动生成 watchlist 字段模板(手动添加个股用,基于实时行情计算)
function autoGenStrategy(s,v,atds,turnover){
  var price=Number(s.price)||0;
  var support=(price*0.92).toFixed(2), pressure=(price*1.08).toFixed(2);
  var stopLoss=(price*0.95).toFixed(2);
  // 策略字段模板
  var logic=v>=5?'强势突破,关注量能持续性':
             v>=2?'强势承接,技术偏强':
             v>=-1?'震荡整理,方向待确认':
             v>=-3?'回调观察,关注支撑位':
             '弱势回调,严格控制仓位';
  var capital=turnover>=5?'主力活跃,换手率 '+s.turnover+'%,资金博弈加剧':
                turnover>=2?'换手温和('+s.turnover+'%),资金参与一般':
                turnover>=0.5?'换手一般('+s.turnover+'%)':
                '换手偏低('+s.turnover+'%),关注资金异动';
  var keyLevels='支撑 '+support+' / 压力 '+pressure;
  // 操作建议:基于 ATDS + 风险等级
  var planEntry=atds>=85?'重点关注,可参与':
                atds>=70?'持有观察,等待催化':
                atds>=60?'中性观望,等放量确认':
                '建议观望,等待企稳';
  var entryPrice=v>=3?'突破当前价 '+price+' 跟进':
                v<=-3?'回踩 '+support+' 附近低吸':
                '区间震荡 '+support+' - '+pressure;
  var entryPos=atds>=85?'中等仓位':
                atds>=70?'轻仓试错':
                '保守仓位';
  var entryNote='参考风险等级与资金面,严格执行止损';
  var stopLossStr=stopLoss+' · 清仓';
  var takeProfitStr=v>=0?'站稳 '+pressure+' 趋势延伸':'跌破 '+support+' 走弱减仓';
  var targetStr=price+' → '+pressure;
  var riskStr='买入区 '+price+',止损 '+stopLoss+',可损约 5%。跌破止损必须走,不恋战。';
  return {
    logic:logic, capital:capital, keyLevels:keyLevels,
    plan:planEntry+',关注 '+entryPrice+' 机会',
    strategy:{entryStrategy:v>=3?'突破追涨':'回踩低吸',entryPrice:entryPrice,entryPosition:entryPos,entryNote:entryNote,stopLoss:stopLossStr,takeProfit:takeProfitStr,target:targetStr,risk:riskStr},
    todayStrategy:{
      core:v>=2?'不追高,等回踩确认后再参与':'已回调,可分批低吸,严控仓位',
      planA:{title:'求稳回踩',content:'回踩 '+support+' 附近低吸,严控仓位在 20-30%'},
      planB:{title:'突破确认',content:'放量突破 '+pressure+' 加仓,确认趋势后看高 5-8%'},
      choice:'先做方案 A 求稳,跌破 '+stopLoss+' 立即止损',
      position:'总仓位控制在回笼资金的 20% 以内,单股严控',
      alert:'若板块整体走弱或大盘破位,放弃买入等待'
    }
  };
}
// 单独渲染 detail 区(供 refreshWatchlistQuotes 复用,保证手动添加个股 detail 也跟随最新行情)
function buildWatchlistDetailHtml(data){
  var v=Number(data.pct)||0;
  var atds=70+Math.min(25,Math.max(-15,Math.round(v*2+(Number(data.turnover)||0)*0.5)));
  var stopLoss=(Number(data.price)*0.95).toFixed(2);
  var support=(Number(data.price)*0.92).toFixed(2);
  var pressure=(Number(data.price)*1.08).toFixed(2);
  var turnover=Number(data.turnover)||0;
  var riskL=deriveRiskLevelF(v),horizonL=deriveTimeHorizonF(v,turnover),adviceL=deriveAdviceF(v,atds,riskL.tone);
  var riskLines=deriveRiskTextF(v,turnover);
  var adviceText=deriveAdviceTextF(v,atds,riskL.tone);
  var autoS=autoGenStrategy(data,v,atds,turnover);
  var catTag=v>=5?'强势突破':v>=2?'强势参与':v>=0.5?'震荡观察':v>=-1?'中性观望':v>=-3?'回调关注':'弱势规避';
  var metaHtml='<div class="wl-meta"><span class="wl-cat">自选股</span><span class="wl-tag">'+escHtmlF(catTag)+'</span></div>';
  var blockLogic='<div class="detail-block"><div class="detail-h detail-h-custom">📐 逻辑</div><div class="detail-line">'+escHtmlF(autoS.logic)+'</div></div>';
  var blockCapital='<div class="detail-block"><div class="detail-h detail-h-custom">💰 资金</div><div class="detail-line">'+escHtmlF(autoS.capital)+'</div></div>';
  var blockKey='<div class="detail-block"><div class="detail-h detail-h-custom">🎯 关键位</div><div class="detail-line">'+escHtmlF(autoS.keyLevels)+'</div></div>';
  var parHtml='<div class="detail-block detail-block-par">'+
    '<div class="detail-h detail-h-custom">⚡ 操作 + 建议 + 风险</div>'+
    '<div class="par-body">'+
      '<div class="par-line"><span class="par-tag par-tag-plan">操作</span><span class="par-content">'+escHtmlF(autoS.plan)+'</span></div>'+
      '<div class="par-line"><span class="par-tag par-tag-advice">建议</span><span class="par-content">'+escHtmlF(adviceText)+'<span class="advice-tag-mini advice-'+adviceL.tone+'">'+escHtmlF(adviceL.name)+'</span></span></div>'+
      '<div class="par-risk"><span class="par-tag par-tag-risk">风险</span><span class="par-risk-content"><span class="risk-tag risk-'+riskL.tone+'">'+escHtmlF(riskL.name)+'</span><ul>'+riskLines.map(function(l){return '<li>'+escHtmlF(l)+'</li>';}).join('')+'</ul></span></div>'+
    '</div></div>';
  var strategyBlocks='<div class="detail-grid detail-grid-strategy">'+blockLogic+blockCapital+blockKey+parHtml+'</div>';
  var st=autoS.strategy;
  var todayStHtml='<div class="wl-st-table">'+
    '<div class="wl-st-title">🎯 个股风控</div>'+
    '<div class="wl-st-line"><span class="par-tag par-tag-plan">入场</span><span class="wl-st-content">策略:'+escHtmlF(st.entryStrategy)+' · 价格:<span class="wl-st-num">'+escHtmlF(st.entryPrice)+'</span> · 仓位:'+escHtmlF(st.entryPosition)+'</span></div>'+
    '<div class="wl-st-line"><span class="par-tag par-tag-advice">风控</span><span class="wl-st-content">止损:'+escHtmlF(st.stopLoss)+' · 止盈:'+escHtmlF(st.takeProfit)+' · 目标:<span class="wl-st-num">'+escHtmlF(st.target)+'</span></span></div>'+
    (st.entryNote ? '<div class="wl-st-line"><span class="par-tag par-tag-plan">入场说明</span><span class="wl-st-content">'+escHtmlF(st.entryNote)+'</span></div>' : '')+
    '<div class="wl-st-line wl-st-risk-line"><span class="par-tag par-tag-risk">风险</span><span class="wl-st-content">'+escHtmlF(st.risk)+'</span></div>'+
  '</div>';
  var ts=autoS.todayStrategy;
  var todayStrategyCard='<div class="card ts-stock-card">'+
    '<div class="ts-title">🎯 今日执行策略 <span class="ts-sub">(二选一或分批)</span></div>'+
    '<div class="ts-core"><span class="ts-core-tag">核心</span>'+escHtmlF(ts.core)+'</div>'+
    '<ul class="ts-plans">'+
      '<li><span class="ts-dot ts-dot-a"></span><b>方案A ('+escHtmlF(ts.planA.title)+')</b>: '+escHtmlF(ts.planA.content)+'</li>'+
      '<li><span class="ts-dot ts-dot-b"></span><b>方案B ('+escHtmlF(ts.planB.title)+')</b>: '+escHtmlF(ts.planB.content)+'</li>'+
    '</ul>'+
    '<ul class="ts-plans">'+
      '<li><span class="ts-dot"></span><b>二选一建议</b>: '+escHtmlF(ts.choice)+'</li>'+
      '<li><span class="ts-dot"></span><b>仓位控制</b>: '+escHtmlF(ts.position)+'</li>'+
    '</ul>'+
    '<div class="ts-alert"><b>关键提醒</b>: '+escHtmlF(ts.alert)+'</div>'+
  '</div>';
  return metaHtml+strategyBlocks+todayStHtml+todayStrategyCard;
}
function addToWatchlistUI(s){
  var card=document.querySelector(".watchlist-card");
  if(!card)return;
  if(s&&s.code&&document.querySelector('.wl-stock[data-stock-code="'+String(s.code).replace(/"/g,'\\"')+'"]'))return;
  var stocksWrap=card.querySelector(".wl-stocks");
  if(!stocksWrap){stocksWrap=document.createElement("div");stocksWrap.className="wl-stocks";var head=card.querySelector(".wl-stocks-head");if(head&&head.nextSibling){card.insertBefore(stocksWrap,head.nextSibling);}else{card.appendChild(stocksWrap);}}
  var n=stocksWrap.querySelectorAll(".wl-stock").length+1;
  var v=Number(s.pct)||0;
  var cls=v>=0?"up":"down";
  var sigLabel, sigTone;
  if(v>=5){sigLabel="强势突破";sigTone="break";}
  else if(v>=2){sigLabel="强势承接";sigTone="strong";}
  else if(v>=0.5){sigLabel="震荡上行";sigTone="up";}
  else if(v>=-1){sigLabel="等待确认";sigTone="wait";}
  else if(v>=-3){sigLabel="走势承压";sigTone="press";}
  else{sigLabel="弱势回调";sigTone="weak";}
  var atds=70+Math.min(25,Math.max(-15,Math.round(v*2+(Number(s.turnover)||0)*0.5)));
  var stopLoss=(Number(s.price)*0.95).toFixed(2);
  var support=(Number(s.price)*0.92).toFixed(2);
  var pressure=(Number(s.price)*1.08).toFixed(2);
  var turnover=Number(s.turnover)||0;
  var detailHtml=buildWatchlistDetailHtml(s);
  var stock=document.createElement('div');
  stock.className='wl-stock';
  stock.setAttribute('data-stock-code',s.code);
  var headRowHtml='<div class="wl-stock-row wl-stock-head">'+
    '<span class="wl-cell wl-cell-rank"><b>排名/标的</b></span>'+
    '<span class="wl-cell wl-cell-price"><b>最新价</b></span>'+
    '<span class="wl-cell wl-cell-pct"><b>涨跌幅</b></span>'+
    '<span class="wl-cell wl-cell-amt"><b>成交额</b></span>'+
    '<span class="wl-cell wl-cell-atds"><b>ATDS</b></span>'+
    '<span class="wl-cell wl-cell-sig"><b>策略信号</b></span>'+
    '<span class="wl-cell wl-cell-act"><b>操作</b></span>'+
    '</div>';
  stock.innerHTML='<div class="wl-stock-scroll">'+
    headRowHtml+
    '<div class="wl-stock-row" data-code="'+escHtmlF(s.code)+'">'+
    '<span class="wl-cell wl-cell-rank"><span class="rank-no">'+n+'</span><span class="wl-name">'+escHtmlF(s.name)+'</span><span class="wl-code">'+escHtmlF(s.code)+'</span></span>'+
    '<span class="wl-cell wl-cell-price"><span class="price '+cls+'">'+Number(s.price).toFixed(2)+'</span></span>'+
    '<span class="wl-cell wl-cell-pct '+cls+'">'+(v>0?"+":"")+v.toFixed(2)+'%</span>'+
    '<span class="wl-cell wl-cell-amt">'+escHtmlF(s.amount||'--')+'</span>'+
    '<span class="wl-cell wl-cell-atds">'+atds+'</span>'+
    '<span class="wl-cell wl-cell-sig"><span class="sig sig-'+sigTone+'">'+sigLabel+'</span></span>'+
    '<span class="wl-cell wl-cell-act"><button class="wl-btn wl-btn-primary" data-code="'+escHtmlF(s.code)+'" onclick="openStockResearch(this.dataset.code)">全面分析</button><button class="wl-btn wl-btn-del" data-code="'+escHtmlF(s.code)+'" onclick="removeWatchlistRow(this.dataset.code)">删</button></span>'+
    '</div>'+
    '</div>'+
    '<div class="wl-detail auto-detail" data-detail-code="'+escHtmlF(s.code)+'">'+
      detailHtml+
    '</div>';
  stocksWrap.appendChild(stock);
}
function removeWatchlistRow(code){var s=document.querySelector('.wl-stock[data-stock-code="'+code+'"]');if(s)s.remove();var m=document.getElementById("modal-"+code);if(m)m.remove();saveWatchlist();try{var h=localStorage.getItem("atds_watchlist_hidden");var hidden=h?JSON.parse(h):[];if(hidden.indexOf(code)<0)hidden.push(code);localStorage.setItem("atds_watchlist_hidden",JSON.stringify(hidden));}catch(e){}}
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
  var raw=null,hiddenRaw=null;
  try{raw=localStorage.getItem("atds_watchlist");}catch(e){}
  try{hiddenRaw=localStorage.getItem("atds_watchlist_hidden");}catch(e){}
  var hidden=[];
  try{hidden=JSON.parse(hiddenRaw)||[];}catch(e){}
  var card=document.querySelector('.watchlist-card');
  if(!card)return;
  // 1. 收集 config 已渲染 codes(hidden 仅作用于 config,不影响手动添加股票)
  var configCodes=[];
  document.querySelectorAll('.wl-stock-row[data-code]').forEach(function(r){var cd=r.getAttribute("data-code");if(cd&&configCodes.indexOf(cd)<0)configCodes.push(cd);});
  // 2. 隐藏用户删除过的 config 股票(防刷新复活)
  hidden.forEach(function(c){if(configCodes.indexOf(c)>=0){var el=document.querySelector('.wl-stock[data-stock-code="'+c+'"]');if(el)el.remove();}});
  // 3. 重新收集 config 已渲染 codes(剔除 hidden 后)
  configCodes=[];
  document.querySelectorAll('.wl-stock-row[data-code]').forEach(function(r){var cd=r.getAttribute("data-code");if(cd&&configCodes.indexOf(cd)<0)configCodes.push(cd);});
  // 4. localStorage 中不在 config 的代码 → 拉最新行情追加
  var extraCodes=[];
  if(raw!==null){
    try{extraCodes=JSON.parse(raw)||[];}catch(e){}
    extraCodes=extraCodes.filter(function(c){return /^\d{6}$/.test(String(c))&&configCodes.indexOf(c)<0;});
  }
  if(!extraCodes.length)return;
  (async function(){
    for(var i=0;i<extraCodes.length;i++){
      var rawCode=String(extraCodes[i]);
      var c0=rawCode.charAt(0);var sc;if(c0==="6"){sc="sh";}else if(c0==="4"||c0==="8"||c0==="92"){sc="bj";}else{sc="sz";}
      try{
        var res=await fetch("https://qt.gtimg.cn/q="+sc+rawCode);
        var buf=await res.arrayBuffer();var text=new TextDecoder("gbk").decode(buf);
        var m=text.match(/="([^"]+)"/);if(!m)continue;
        var f=m[1].split("~");if(f.length<40)continue;
        var data={code:rawCode,name:f[1],price:parseFloat(f[3]),pct:parseFloat(f[32])||0,amount:((parseFloat(f[37])||0)/10000).toFixed(1)+"亿",turnover:f[38]||"--",setcode:sc};
        if(!data.name)continue;
        addToWatchlistUI(data);
      }catch(e){}
    }
  })();
  // 追加完成后强制刷新一次(更新 ATDS/信号等附加字段)
  setTimeout(function(){try{refreshWatchlistQuotes();}catch(e){}}, 200);
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
      var r=map[code];
      var cls=pct>=0?'up':'down';
      var sig=deriveSigR(pct);
      var atds=70+Math.min(25,Math.max(-15,Math.round(pct*2+(Number(turnover)||0)*0.5)));
      var priceEl=r.querySelector('.wl-cell-price .price');
      if(priceEl){priceEl.className='price '+cls;priceEl.textContent=price.toFixed(2);}
      var pctEl=r.querySelector('.wl-cell-pct');
      if(pctEl){pctEl.className='wl-cell wl-cell-pct '+cls;pctEl.textContent=(pct>0?'+':'')+pct.toFixed(2)+'%';}
      var amtEl=r.querySelector('.wl-cell-amt');
      if(amtEl)amtEl.textContent=amount;
      var atdsEl=r.querySelector('.wl-cell-atds');
      if(atdsEl)atdsEl.textContent=atds;
      var sigEl=r.querySelector('.wl-cell-sig .sig');
      if(sigEl){sigEl.className='sig sig-'+sig.tone;sigEl.textContent=sig.name;}
      // detail 区域刷新:止损/支撑/压力 + 风险等级 + 风控时间 + 建议文本
      // 关键修复:之前只更新 detail-spb,detail-grid 内的"风险/风控/建议"文本是添加时的快照
      var d=document.querySelector('.wl-detail[data-detail-code="'+code+'"]');
      if(d){
        // 1. 止损/支撑/压力 基于最新价更新
        var spb=d.querySelectorAll('.detail-spb span');
        if(spb.length>=3){
          var sl=spb[0].childNodes[1];var su=spb[1].childNodes[1];var pr=spb[2].childNodes[1];
          if(sl)sl.textContent=(price*0.95).toFixed(2);
          if(su)su.textContent=(price*0.92).toFixed(2);
          if(pr)pr.textContent=(price*1.08).toFixed(2);
        }
        // 2. 手动添加的 detail(auto-detail class): 整体重新生成(让所有字段跟随最新行情)
        if(d.classList.contains('auto-detail')){
          d.innerHTML=buildWatchlistDetailHtml({code:code,name:f[1],price:price,pct:pct,amount:amount,turnover:turnover,setcode:''});
        }
      }
    });
    var timeEl=document.querySelector('.wl-time');
    if(timeEl)timeEl.textContent='● '+new Date().toLocaleString('zh-CN',{hour12:false});
  }catch(e){}
  if(btn){btn.disabled=false;btn.textContent='↻ 刷新';}
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
  setTimeout(refreshWatchlistQuotes,1500);            // 打开页面 1.5s 后自动刷一次
  setInterval(refreshWatchlistQuotes,30000);          // 每 30 秒自动刷新
}
(function(){var card=document.querySelector('.watchlist-card');if(card){addWatchlistRefreshBtn();setTimeout(refreshWatchlistQuotes,1500);setInterval(refreshWatchlistQuotes,60000);}})();

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
