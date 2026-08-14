<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
<script>
function getBaseUrl(){var h=location.href.split("#")[0];if(/index\.html/i.test(h)){return h.replace(/index\.html.*$/i,"");}if(h.slice(-1)==="/"){return h;}var i=h.lastIndexOf("/");return h.slice(0,i+1);}
function showQr(){var u=getBaseUrl();document.getElementById("qr-mask").style.display="flex";document.getElementById("qr-sub").textContent=u;var el=document.getElementById("qrcode");el.innerHTML="";try{new QRCode(el,{text:u,width:200,height:200});}catch(e){el.innerHTML='<div style="font-size:12px;color:#999">二维码生成失败</div>';}}
function hideQr(){document.getElementById("qr-mask").style.display="none";}
function showResearch(code){var m=document.getElementById("modal-"+code);if(m){m.classList.add("show");document.body.style.overflow="hidden";}}
function closeModal(code){var m=document.getElementById("modal-"+code);if(m){m.classList.remove("show");document.body.style.overflow="";}}
async function handleSearchStock(){var input=document.getElementById("search-input");if(!input)return;var raw=(input.value||"").trim();if(!/^\d{6}$/.test(raw)){alert("请输入 6 位数字股票代码（如 600519）");return;}var c0=raw.charAt(0);var sc;if(c0==="6"){sc="sh";}else if(c0==="4"||c0==="8"||c0==="92"){sc="bj";}else{sc="sz";}try{var res=await fetch("https://qt.gtimg.cn/q="+sc+raw);var buf=await res.arrayBuffer();var text=new TextDecoder("gbk").decode(buf);var m=text.match(/="([^"]+)"/);if(!m){alert("未找到股票代码 "+raw);return;}var f=m[1].split("~");if(f.length<40){alert("数据解析失败，请重试");return;}var retCode=String(f[2]||"").trim();if(retCode!==raw){alert("代码 "+raw+" 与返回结果 "+retCode+" 不匹配，请检查输入");return;}var data={code:retCode,name:f[1],price:parseFloat(f[3]),pct:parseFloat(f[32])||0,amount:((parseFloat(f[37])||0)/10000).toFixed(1)+"亿",turnover:f[38]||"--",setcode:sc};if(!data.name){alert("未找到股票代码 "+raw);return;}closeAllModals();if(document.getElementById("modal-"+data.code)){showResearch(data.code);}else{addToWatchlistUI(data);showDynamicResearch(data);saveWatchlist();}input.value="";}catch(e){alert("网络异常："+e.message);}}
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
  var n=card.querySelectorAll(".wl-row").length+1;
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
  var row=document.createElement("div");
  row.className="wl-row wl-row-new";
  row.setAttribute("data-code",s.code);
  var rank=document.createElement("div");
  rank.className="wl-cell wl-cell-rank";
  var no=document.createElement("span");no.className="rank-no";no.textContent=n;
  var nmBox=document.createElement("div");
  var nm=document.createElement("div");nm.className="wl-name";nm.textContent=s.name;
  var cd=document.createElement("div");cd.className="wl-code";cd.textContent=s.code;
  nmBox.appendChild(nm);nmBox.appendChild(cd);
  rank.appendChild(no);rank.appendChild(nmBox);
  var price=document.createElement("div");price.className="wl-cell wl-cell-price";
  var pv=document.createElement("div");pv.className="price "+cls;pv.textContent=Number(s.price).toFixed(2);
  price.appendChild(pv);
  var pct=document.createElement("div");pct.className="wl-cell wl-cell-pct "+cls;pct.textContent=(v>0?"+":"")+v.toFixed(2)+"%";
  var amt=document.createElement("div");amt.className="wl-cell wl-cell-amt";amt.textContent=s.amount;
  var atdsEl=document.createElement("div");atdsEl.className="wl-cell wl-cell-atds";atdsEl.textContent=atds;
  var sigEl=document.createElement("div");sigEl.className="wl-cell wl-cell-sig";
  var sigSp=document.createElement("span");sigSp.className="sig sig-"+sigTone;sigSp.textContent=sigLabel;
  sigEl.appendChild(sigSp);
  var act=document.createElement("div");act.className="wl-cell wl-cell-act";
  var b1=document.createElement("button");b1.className="wl-btn wl-btn-primary";b1.textContent="全面分析";
  b1.onclick=function(){showResearch(s.code);};
  var b2=document.createElement("button");b2.className="wl-btn";b2.textContent="删除自选";
  b2.onclick=function(){removeWatchlistRow(s.code);};
  act.appendChild(b1);act.appendChild(b2);
  row.appendChild(rank);row.appendChild(price);row.appendChild(pct);row.appendChild(amt);row.appendChild(atdsEl);row.appendChild(sigEl);row.appendChild(act);
  var head=card.querySelector(".wl-table-head");
  if(head)head.insertAdjacentElement("afterend",row);

  // 同时插入详情行(风险/风控/建议)
  var pct=Number(s.pct)||0,turnover=Number(s.turnover)||0;
  var atds=70+Math.min(25,Math.max(-15,Math.round(pct*2+turnover*0.5)));
  var riskL=deriveRiskLevelF(pct),horizonL=deriveTimeHorizonF(pct,turnover),adviceL=deriveAdviceF(pct,atds,riskL.tone);
  var riskLines=deriveRiskTextF(pct,turnover);
  var horizons=deriveHorizonLinesF(pct,turnover);
  var adviceText=deriveAdviceTextF(pct,atds,riskL.tone);
  var detail=document.createElement('tr');
  detail.className='wl-detail-row';
  detail.setAttribute('data-detail-code',s.code);
  detail.innerHTML='<td colspan="7" class="wl-detail-cell"><div class="detail-grid">'+
    '<div class="detail-block"><div class="detail-h">风险 <span class="risk-tag risk-'+riskL.tone+'">'+escHtmlF(riskL.name)+'</span></div>'+riskLines.map(function(l){return '<div class="detail-line">'+escHtmlF(l)+'</div>';}).join('')+'</div>'+
    '<div class="detail-block"><div class="detail-h">风控 <span class="horizon-tag horizon-'+horizonL.tone+'">'+escHtmlF(horizonL.name)+'</span></div>'+horizons.map(function(h){return '<div class="detail-line"><b>'+escHtmlF(h.k)+'</b>'+escHtmlF(h.v)+'</div>';}).join('')+'</div>'+
    '<div class="detail-block"><div class="detail-h">建议 <span class="advice-tag advice-'+adviceL.tone+'">'+escHtmlF(adviceL.name)+'</span></div><div class="detail-line">'+escHtmlF(adviceText)+'</div></div>'+
    '</div></td>';
  row.insertAdjacentElement('afterend',detail);
}
function removeWatchlistRow(code){var r=document.querySelector('.wl-row[data-code="'+code+'"]');if(r)r.remove();var m=document.getElementById("modal-"+code);if(m)m.remove();}
function saveWatchlist(){try{var codes=[];document.querySelectorAll(".wl-row").forEach(function(r){var cd=r.getAttribute("data-code");if(cd)codes.push(cd);});localStorage.setItem("atds_watchlist",JSON.stringify(codes));}catch(e){}}
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
    "<div class=\"modal-footer\">✓ 深度研究完成，已更新观察池中的该股票</div>"+
    "</div></div>";
  return html;
}
function showDynamicResearch(s){var html=renderStockModalFront(s);var tmp=document.createElement("div");tmp.innerHTML=html;var modal=tmp.firstElementChild;document.body.appendChild(modal);modal.classList.add("show");document.body.style.overflow="hidden";}
function downloadMd(){var el=document.getElementById("knowledge-md");if(!el){alert("暂无内容");return;}var blob=new Blob([el.textContent],{type:"text/markdown"});var a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="atds-"+new Date().toISOString().slice(0,10)+".md";a.click();}
function copyMd(){var el=document.getElementById("knowledge-md");if(!el||!navigator.clipboard){alert("复制失败");return;}navigator.clipboard.writeText(el.textContent).then(function(){alert("已复制到剪贴板");});}
function loadSavedWatchlist(){try{var raw=localStorage.getItem("atds_watchlist");return raw?JSON.parse(raw):[];}catch(e){return [];}}
function restoreSavedWatchlist(){
  var codes=loadSavedWatchlist().filter(function(cd){
    var existing=document.querySelector('.wl-row[data-code="'+cd+'"]');
    return !existing;
  });
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
        // detail 行由 addToWatchlistUI 内部统一添加
      }catch(e){}
    }
  })();
}
if(document.readyState==="complete"||document.readyState==="interactive"){setTimeout(restoreSavedWatchlist,600);}else{document.addEventListener("DOMContentLoaded",function(){setTimeout(restoreSavedWatchlist,600);});}
</script>