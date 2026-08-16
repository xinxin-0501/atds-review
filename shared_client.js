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
async function openRegimeNHList(){
  var existing = document.getElementById('regime-nh-modal');
  if (existing) { existing.classList.add('show'); refreshRegimeNH(); return; }
  var modal = document.createElement('div');
  modal.className = 'modal-mask show';
  modal.id = 'regime-nh-modal';
  modal.onclick = function(e){ if (e.target === modal) closeRegimeNH(); };
  modal.innerHTML = '<div class="modal" onclick="event.stopPropagation()">'+
    '<div class="modal-header"><div class="modal-eyebrow">60日新高个股清单</div><span class="modal-close" onclick="closeRegimeNH()">×</span></div>'+
    '<div class="modal-body"><div class="nh-summary" id="regime-nh-body">加载中...</div>'+
    '<div style="text-align:center;margin-top:10px"><button class="wl-btn wl-btn-primary" onclick="refreshRegimeNH()">🔄 重新检测</button> <button class="wl-btn" onclick="addAllNHToWatchlist()" style="margin-left:4px;">⚡ 一键全部加入观察池</button> <button class="wl-btn" onclick="closeRegimeNH()" style="margin-left:4px;">关闭</button></div></div>'+
    '</div></div>';
  document.body.appendChild(modal);
  refreshRegimeNH();
}
async function refreshRegimeNH(){
  var body = document.getElementById('regime-nh-body');
  if (!body) return;
  body.innerHTML = '<div style="text-align:center;color:#888">🔄 正在抓取60日K线...</div>';
  var codes = new Set();
  document.querySelectorAll('.stock-code').forEach(function(el){ var m = (el.textContent||'').match(/\d{6}/); if (m) codes.add(m[0]); });
  if (codes.size < 5) {
    document.querySelectorAll('.da-stock').forEach(function(a){ var c = a.getAttribute('data-code'); if (c) codes.add(c); });
    document.querySelectorAll('.wl-stock-row[data-code]').forEach(function(r){ var c = r.getAttribute('data-code'); if (c) codes.add(c); });
  }
  var arr = Array.from(codes).slice(0, 80);
  var list = [];
  for (var i = 0; i < arr.length; i++) {
    var code = arr[i];
    var c0 = code.charAt(0);
    var full = c0 === '6' ? 'sh' + code : 'sz' + code;
    var kl = await fetchKlineF(full, 65);
    if (!kl || kl.length < 30) continue;
    var highs = kl.map(function(k){ return parseFloat(k[3]); });
    var peak60 = Math.max.apply(null, highs);
    var last = parseFloat(kl[kl.length-1][2]);
    if (last >= peak60 * 0.98) list.push({ code: code, last: last, peak60: peak60 });
  }
  // 批量拉取股票名称(腾讯批量行情)
  try {
    var batch = list.map(function(x){ var c0 = x.code.charAt(0); return (c0==='6' ? 'sh' : (c0==='4'||c0==='8'||c0==='92' ? 'bj' : 'sz')) + x.code; });
    if (batch.length) {
      var res = await fetch('https://qt.gtimg.cn/q=' + batch.join(','), { cache: 'no-store' });
      var buf = await res.arrayBuffer();
      var txt = new TextDecoder('gbk').decode(buf);
      txt.split(';').forEach(function(line){
        var m = line.trim().match(/^v_[a-z]+\d+="(.*)"$/); if (!m) return;
        var f = m[1].split('~'); if (f.length < 5) return;
        var c = String(f[2] || '').trim();
        for (var j = 0; j < list.length; j++) { if (list[j].code === c) { list[j].name = f[1]; break; } }
      });
    }
  } catch(e){}
  var html = '<div class="nh-summary">60日新高个股 <b>' + list.length + '</b> 只 / 阈值 100 · 点击行可查看个股分析</div>';
  if (list.length) {
    html += '<div class="nh-list">' + list.map(function(x, i){
      return '<div class="nh-item" data-code="' + escHtmlF(x.code) + '" onclick="openStockResearch(this.dataset.code)"><span class="ms-rank">' + (i+1) + '</span> <b>' + escHtmlF(x.name || x.code) + '</b> <small>' + x.code + '</small> 现价 ' + x.last.toFixed(2) + ' (峰值 ' + x.peak60.toFixed(2) + ')</div>';
    }).join('') + '</div>';
  } else {
    html += '<div class="ms-empty">当前候选中未识别到60日新高个股</div>';
  }
  html += '<div style="text-align:center;margin-top:10px"><button class="wl-btn wl-btn-primary" onclick="refreshRegimeNH()">🔄 重新检测</button> <button class="wl-btn" onclick="addAllNHToWatchlist()" style="margin-left:4px;">⚡ 一键全部加入观察池</button> <button class="wl-btn" onclick="closeRegimeNH()" style="margin-left:4px;">关闭</button></div>';
  body.innerHTML = html;
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
async function handleSearchStock(){var input=document.getElementById("search-input");if(!input)return;var raw=(input.value||"").trim();window.__atdsUnlocked=true;if(!/^\d{6}$/.test(raw)){alert("请输入 6 位数字股票代码（如 600519）");return;}try{var data=await fetchStockData(raw);if(!data){alert("未找到股票代码 "+raw);return;}closeAllModals();if(!document.querySelector('.wl-stock-row[data-code="'+data.code+'"]')){try{await addFetchedToWatchlist(data.code);}catch(e){}}showDynamicResearch(data);input.value="";}catch(e){alert("网络异常："+e.message);}}
function closeAllModals(){var list=document.querySelectorAll(".modal-mask.show");for(var i=0;i<list.length;i++){list[i].classList.remove("show");}document.body.style.overflow="";}
function deriveRiskLevelF(pct){var v=Number(pct)||0;if(v>=5||v<=-5)return{name:'高风险',tone:'high'};if(v>=2||v<=-2)return{name:'中风险',tone:'mid'};return{name:'低风险',tone:'low'};}
function deriveTimeHorizonF(pct,turnover){var v=Number(pct)||0,t=Number(turnover)||0;if(v>=3&&t>=2)return{name:'短线',tone:'short'};if(v>=-1&&v<=3&&t>=0.5)return{name:'波段',tone:'wave'};return{name:'长线',tone:'long'};}
function deriveAdviceF(pct,atds,riskTone){var v=Number(pct)||0,a=Number(atds)||0;if(v<=-5)return{name:'减仓规避',tone:'cut'};if(a>=85&&riskTone!='high')return{name:'重点关注',tone:'focus'};if(a>=70)return{name:'持有观察',tone:'hold'};if(a<60&&v<=-1)return{name:'观望',tone:'wait'};return{name:'持有观察',tone:'hold'};}
function deriveRiskTextF(pct,turnover){var v=Number(pct)||0,t=Number(turnover)||0,lines=[];if(v>=5)lines.push('涨幅>5%,RSI 超买区');else if(v>=2)lines.push('涨幅 2-5%,技术偏强');else if(v>=-1)lines.push('震荡整理,方向未明');else if(v>=-3)lines.push('回调 2-3%,观察支撑');else lines.push('跌幅>3%,风险增大');if(t>=5)lines.push('放量活跃');else if(t>=2)lines.push('量能温和');else if(t>=0.5)lines.push('量能一般');else lines.push('量能偏低');return lines;}
function deriveHorizonLinesF(pct,turnover){var v=Number(pct)||0,t=Number(turnover)||0,sh=v>=3&&t>=2?'回踩 MA5 不破可继续,跌破减仓':v>=1?'区间震荡,顺势做 T,关注 MA10':v<=-3?'下跌趋势,反弹至 MA5 减仓':'区间震荡,关注 MA10 方向选择';var wa=v>=2?'沿 MA20 运行,跌破 MA60 警惕走弱':v<=-2?'跌至 MA20 下方,关注 MA60 是否扣住':'区间震荡,等待 MA20 方向选择';var lo=v>=0?'站上 MA120 偏多,关注 MA250 突破':'跌破 MA120,长线宜减仓观望';return[{k:'短线',v:sh},{k:'波段',v:wa},{k:'长线',v:lo}];}
function deriveAdviceTextF(pct,atds,riskTone){var v=Number(pct)||0,a=Number(atds)||0;if(v<=-5)return'跌幅较大,建议减仓规避';if(a>=85&&riskTone!='high')return'ATDS 证据强,重点关注';if(a>=75&&v>=0)return'持有观察,等待放量催化';if(a<60&&v<=-1)return'技术偏弱,观望等待企稳';if(v>=5)return'高位震荡,逢高减仓为主';return'持有观察,关注量能配合';}
function escHtmlF(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function addToWatchlistUI(s){
  var card=document.querySelector(".watchlist-card");
  if(!card)return;
  // 已存在则不重复添加(静态 HTML 已有 600392,恢复自选时避免重复行)
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
  var riskL=deriveRiskLevelF(v),horizonL=deriveTimeHorizonF(v,turnover),adviceL=deriveAdviceF(v,atds,riskL.tone);
  var riskLines=deriveRiskTextF(v,turnover);
  var horizons=deriveHorizonLinesF(v,turnover);
  var adviceText=deriveAdviceTextF(v,atds,riskL.tone);
  var stock=document.createElement('div');
  stock.className='wl-stock';
  stock.setAttribute('data-stock-code',s.code);
  stock.innerHTML='<div class="wl-stock-row" data-code="'+escHtmlF(s.code)+'">'+
    '<span class="wl-cell wl-cell-rank"><span class="rank-no">'+n+'</span><span class="wl-name">'+escHtmlF(s.name)+'</span><span class="wl-code">'+escHtmlF(s.code)+'</span></span>'+
    '<span class="wl-cell wl-cell-price"><span class="price '+cls+'">'+Number(s.price).toFixed(2)+'</span></span>'+
    '<span class="wl-cell wl-cell-pct '+cls+'">'+(v>0?"+":"")+v.toFixed(2)+'%</span>'+
    '<span class="wl-cell wl-cell-amt">'+escHtmlF(s.amount||'--')+'</span>'+
    '<span class="wl-cell wl-cell-atds">'+atds+'</span>'+
    '<span class="wl-cell wl-cell-sig"><span class="sig sig-'+sigTone+'">'+sigLabel+'</span></span>'+
    '<span class="wl-cell wl-cell-act"><button class="wl-btn wl-btn-primary" data-code="'+escHtmlF(s.code)+'" onclick="openStockResearch(this.dataset.code)">全面分析</button><button class="wl-btn wl-btn-del" data-code="'+escHtmlF(s.code)+'" onclick="removeWatchlistRow(this.dataset.code)">删</button></span>'+
    '</div>'+
    '<div class="wl-detail" data-detail-code="'+escHtmlF(s.code)+'">'+
    '<div class="detail-grid">'+
    '<div class="detail-block"><div class="detail-h">风险 <span class="risk-tag risk-'+riskL.tone+'">'+escHtmlF(riskL.name)+'</span></div>'+riskLines.map(function(l){return '<div class="detail-line">'+escHtmlF(l)+'</div>';}).join('')+'</div>'+
    '<div class="detail-block"><div class="detail-h">风控 <span class="horizon-tag horizon-'+horizonL.tone+'">'+escHtmlF(horizonL.name)+'</span></div>'+horizons.map(function(h){return '<div class="detail-line"><b>'+escHtmlF(h.k)+'</b>'+escHtmlF(h.v)+'</div>';}).join('')+'</div>'+
    '<div class="detail-block"><div class="detail-h">建议 <span class="advice-tag advice-'+adviceL.tone+'">'+escHtmlF(adviceL.name)+'</span></div><div class="detail-line">'+escHtmlF(adviceText)+'</div></div>'+
    '</div>'+
    '<div class="detail-spb"><span><b>止损</b> '+stopLoss+'</span><span><b>支撑</b> '+support+'</span><span><b>压力</b> '+pressure+'</span></div>'+
    '</div>';
  stocksWrap.appendChild(stock);
}
function removeWatchlistRow(code){var s=document.querySelector('.wl-stock[data-stock-code="'+code+'"]');if(s)s.remove();var m=document.getElementById("modal-"+code);if(m)m.remove();saveWatchlist();}
function saveWatchlist(){try{var codes=[];document.querySelectorAll(".wl-stock-row[data-code]").forEach(function(r){var cd=r.getAttribute("data-code");if(cd)codes.push(cd);});localStorage.setItem("atds_watchlist",JSON.stringify(codes));}catch(e){}}
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
  // 恢复用户加入的自选(如 localStorage 有数据则全量恢复,不再过滤掉非 600392,否则新增股票刷新后会消失)
  var codes=loadSavedWatchlist();
  if(!codes.length)return;
  (async function(){
    for(var i=0;i<codes.length;i++){
      var raw=codes[i];
      if(!/^\d{6}$/.test(raw))continue;
      var c0=raw.charAt(0);var sc;if(c0==="6"){sc="sh";}else if(c0==="4"||c0==="8"||c0==="92"){sc="bj";}else{sc="sz";}
      try{
        var res=await fetch("https://qt.gtimg.cn/q="+sc+raw);
        var buf=await res.arrayBuffer();var text=new TextDecoder("gbk").decode(buf);
        var m=text.match(/="([^"]+)"/);if(!m)continue;
        var f=m[1].split("~");if(f.length<40)continue;
        var data={code:raw,name:f[1],price:parseFloat(f[3]),pct:parseFloat(f[32])||0,amount:((parseFloat(f[37])||0)/10000).toFixed(1)+"亿",turnover:f[38]||"--",setcode:sc};
        if(!data.name)continue;
        addToWatchlistUI(data);
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
      // detail-spb 止损/支撑/压力 基于最新价更新
      var d=document.querySelector('.wl-detail[data-detail-code="'+code+'"]');
      if(d){
        var spb=d.querySelectorAll('.detail-spb span');
        if(spb.length>=3){
          var sl=spb[0].childNodes[1];var su=spb[1].childNodes[1];var pr=spb[2].childNodes[1];
          if(sl)sl.textContent=(price*0.95).toFixed(2);
          if(su)su.textContent=(price*0.92).toFixed(2);
          if(pr)pr.textContent=(price*1.08).toFixed(2);
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
  setInterval(refreshWatchlistQuotes,60000);          // 之后每 60 秒自动刷新
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
