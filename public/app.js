const $=id=>document.getElementById(id);
const money=n=>`${Number(n||0)<0?"−":""}$${Math.abs(Number(n||0)).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}`;
const price=n=>Number(n||0).toLocaleString("en-US",{maximumFractionDigits:8});
const safe=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
let symbol="BTCUSDT", interval="1m", liveSocket=null, reconnectTimer=null, candles=[], allTrades=[], calendarData=[], calendarMonth=new Date();
let deferredInstall=null, priceLines=[], tradeEditId=null, toastTimer;
let mainChart, candleSeries, volumeSeries, fastSeries, slowSeries, rsiChart, rsiSeries, macdChart, macdSeries, signalSeries, equityChart, equitySeries;

function createCharts(){
 const base={layout:{background:{color:"#101d2e"},textColor:"#9aabc0"},grid:{vertLines:{color:"#1c2d42"},horzLines:{color:"#1c2d42"}},rightPriceScale:{borderColor:"#263b54"},timeScale:{borderColor:"#263b54",timeVisible:true},handleScroll:true,handleScale:true};
 const el=$("main-chart");
 mainChart=LightweightCharts.createChart(el,{...base,width:el.clientWidth,height:290});
 candleSeries=mainChart.addSeries(LightweightCharts.CandlestickSeries,{upColor:"#18c58f",downColor:"#f06472",borderVisible:false,wickUpColor:"#18c58f",wickDownColor:"#f06472"});
 volumeSeries=mainChart.addSeries(LightweightCharts.HistogramSeries,{priceFormat:{type:"volume"},priceScaleId:""});
 volumeSeries.priceScale().applyOptions({scaleMargins:{top:.82,bottom:0}});
 fastSeries=mainChart.addSeries(LightweightCharts.LineSeries,{color:"#18c58f",lineWidth:1,priceLineVisible:false,lastValueVisible:false});
 slowSeries=mainChart.addSeries(LightweightCharts.LineSeries,{color:"#65a4ff",lineWidth:1,priceLineVisible:false,lastValueVisible:false});
 const subOpts=id=>{const e=$(id);return {...base,width:e.clientWidth,height:100, rightPriceScale:{borderColor:"#263b54"},timeScale:{visible:false,borderColor:"#263b54"}}};
 rsiChart=LightweightCharts.createChart($("rsi-chart"),subOpts("rsi-chart"));
 rsiSeries=rsiChart.addSeries(LightweightCharts.LineSeries,{color:"#c49aff",lineWidth:2,priceLineVisible:false});
 rsiSeries.createPriceLine({price:70,color:"#f06472",lineStyle:2,lineWidth:1,axisLabelVisible:false});
 rsiSeries.createPriceLine({price:30,color:"#18c58f",lineStyle:2,lineWidth:1,axisLabelVisible:false});
 macdChart=LightweightCharts.createChart($("macd-chart"),subOpts("macd-chart"));
 macdSeries=macdChart.addSeries(LightweightCharts.LineSeries,{color:"#65a4ff",lineWidth:2,priceLineVisible:false});
 signalSeries=macdChart.addSeries(LightweightCharts.LineSeries,{color:"#e6b85c",lineWidth:1,priceLineVisible:false});
 equityChart=LightweightCharts.createChart($("equity-chart"),{...base,width:$("equity-chart").clientWidth,height:190,timeScale:{borderColor:"#263b54",timeVisible:false}});
 equitySeries=equityChart.addSeries(LightweightCharts.AreaSeries,{lineColor:"#18c58f",topColor:"rgba(24,197,143,.25)",bottomColor:"rgba(24,197,143,0)",lineWidth:2,priceLineVisible:false});
 window.addEventListener("resize",resizeCharts);
}
function resizeCharts(){
 if(!mainChart)return;
 [["main-chart",mainChart,290],["rsi-chart",rsiChart,100],["macd-chart",macdChart,100],["equity-chart",equityChart,190]].forEach(([id,c,h])=>c.applyOptions({width:$(id).clientWidth,height:h}));
}
function sma(values,period){return values.map((_,i)=>i<period-1?null:values.slice(i-period+1,i+1).reduce((a,b)=>a+b,0)/period);}
function ema(values,period){
 const out=Array(values.length).fill(null),k=2/(period+1);let prev=null;
 values.forEach((v,i)=>{if(i===period-1){prev=values.slice(0,period).reduce((a,b)=>a+b,0)/period;out[i]=prev;}else if(i>=period){prev=v*k+prev*(1-k);out[i]=prev;}});
 return out;
}
function rsi(values,period=14){
 const out=Array(values.length).fill(null);let gain=0,loss=0;
 for(let i=1;i<=period&&i<values.length;i++){const d=values[i]-values[i-1];gain+=Math.max(d,0);loss+=Math.max(-d,0);}
 if(values.length>period){let ag=gain/period,al=loss/period;out[period]=al===0?100:100-100/(1+ag/al);
 for(let i=period+1;i<values.length;i++){const d=values[i]-values[i-1];ag=(ag*(period-1)+Math.max(d,0))/period;al=(al*(period-1)+Math.max(-d,0))/period;out[i]=al===0?100:100-100/(1+ag/al);}}
 return out;
}
function lineData(vals){return vals.map((v,i)=>v==null?null:{time:candles[i].time,value:v}).filter(Boolean);}
function macd(values){
 const e12=ema(values,12),e26=ema(values,26);
 const raw=values.map((_,i)=>e12[i]!=null&&e26[i]!=null?e12[i]-e26[i]:null);
 const valid=raw.map(v=>v??0),sig=ema(valid,9);
 return {macd:raw,signal:sig.map((v,i)=>raw[i]==null?null:v)};
}
function applyIndicators(){
 const closes=candles.map(c=>c.close),mode=$("chart-indicator").value;
 fastSeries.setData(mode==="none"?[]:lineData(mode==="ema"?ema(closes,20):sma(closes,20)));
 slowSeries.setData(mode==="none"?[]:lineData(mode==="ema"?ema(closes,50):sma(closes,50)));
 const rv=rsi(closes,14),rd=lineData(rv);rsiSeries.setData(rd);
 $("rsi-value").textContent=rv.filter(v=>v!=null).slice(-1)[0]?.toFixed(1)??"—";
 const m=macd(closes);macdSeries.setData(lineData(m.macd));signalSeries.setData(lineData(m.signal));
}
async function loadMarket(){
 symbol=$("page-market").classList.contains("active")?symbol:symbol;
 const r=await fetch(`/api/klines?symbol=${symbol}&interval=${interval}&limit=500`);
 if(!r.ok)throw new Error("Tidak dapat mengambil data candle market.");
 candles=await r.json();
 candleSeries.setData(candles);
 volumeSeries.setData(candles.map(c=>({time:c.time,value:c.volume,color:c.close>=c.open?"rgba(24,197,143,.4)":"rgba(240,100,114,.4)"})));
 applyIndicators();mainChart.timeScale().fitContent();$("pair-title").textContent=symbol;
 $("live-price").textContent=`$${price(candles.at(-1)?.close)}`;
 updateTradeLines();connectLive();
}
function connectLive(){
 if(liveSocket){liveSocket.onclose=null;liveSocket.close();}
 const proto=location.protocol==="https:"?"wss":"ws";
 const ws=new WebSocket(`${proto}://${location.host}`);liveSocket=ws;
 ws.onopen=()=>ws.send(JSON.stringify({symbol,interval}));
 ws.onmessage=e=>{
  const msg=JSON.parse(e.data),k=msg.k;if(!k)return;
  const bar={time:Math.floor(k.t/1000),open:+k.o,high:+k.h,low:+k.l,close:+k.c,volume:+k.v};
  candleSeries.update(bar);volumeSeries.update({time:bar.time,value:bar.volume,color:bar.close>=bar.open?"rgba(24,197,143,.4)":"rgba(240,100,114,.4)"});
  if(candles.length&&candles.at(-1).time===bar.time)candles[candles.length-1]=bar;else candles.push(bar);
  applyIndicators();$("live-price").textContent=`$${price(bar.close)}`;
  const open=+k.o,pct=open?(bar.close-open)/open*100:0;
  $("live-change").textContent=`${pct>=0?"+":""}${pct.toFixed(2)}% candle`;
  updateTicker(k.s,bar.close,pct);
 };
 ws.onclose=()=>{if(liveSocket!==ws)return;clearTimeout(reconnectTimer);reconnectTimer=setTimeout(()=>{if(liveSocket===ws)connectLive()},3000)};
 ws.onerror=()=>ws.close();
}
function updateTicker(sym,p,pct){
 const key=sym.slice(0,3).toLowerCase();
 [`ticker-${key}`,"watch-"+key].forEach(id=>{if($(id))$(id).textContent=`$${price(p)}`});
 const pctEl=$(`ticker-${key}-pct`);if(pctEl){pctEl.textContent=`${pct>=0?"+":""}${pct.toFixed(2)}%`;pctEl.className=pct>=0?"positive":"negative";}
}
function setPair(pair){
 symbol=pair;document.querySelectorAll(".ticker").forEach(b=>b.classList.toggle("active",b.dataset.pair===pair));
 $("form-symbol").value=pair;loadMarket().catch(showToast);
}
document.querySelectorAll(".ticker").forEach(b=>b.addEventListener("click",()=>setPair(b.dataset.pair)));
document.querySelectorAll("[data-tf]").forEach(b=>b.addEventListener("click",()=>{
 interval=b.dataset.tf;document.querySelectorAll("[data-tf]").forEach(x=>x.classList.toggle("selected",x===b));loadMarket().catch(showToast);
}));
$("chart-indicator").addEventListener("change",applyIndicators);
function clearTradeLines(){priceLines.forEach(x=>{try{x.series.removePriceLine(x.line)}catch{}});priceLines=[];}
function updateTradeLines(){
 clearTradeLines();const t=allTrades.find(x=>x.status==="OPEN"&&x.symbol===symbol);if(!t)return;
 [[t.entry_price,"ENTRY","#65a4ff"],[t.stop_loss,"STOP LOSS","#f06472"],[t.take_profit,"TAKE PROFIT","#18c58f"]].forEach(([p,title,color])=>{
  if(p&&Number(p)>0){const line=candleSeries.createPriceLine({price:Number(p),title,color,lineWidth:2,lineStyle:2,axisLabelVisible:true});priceLines.push({series:candleSeries,line});}
 });
}
function pnl(t){if(t.status!=="CLOSED"||!t.exit_price)return null;return (t.direction==="LONG"?t.exit_price-t.entry_price:t.entry_price-t.exit_price)*t.quantity-Number(t.fees||0);}
function showToast(msg){$("toast").textContent=msg;$("toast").classList.add("show");clearTimeout(toastTimer);toastTimer=setTimeout(()=>$("toast").classList.remove("show"),2600);}
function showPage(name){
 document.querySelectorAll(".page").forEach(p=>p.classList.toggle("active",p.id===`page-${name}`));
 document.querySelectorAll(".nav-item").forEach(b=>b.classList.toggle("active",b.dataset.page===name));
 if(name==="analytics")loadAnalytics();if(name==="journal")renderJournal();if(name==="market")setTimeout(resizeCharts,50);
 window.scrollTo({top:0,behavior:"smooth"});
}
document.querySelectorAll(".nav-item").forEach(b=>b.addEventListener("click",()=>showPage(b.dataset.page)));
document.querySelectorAll("[data-go]").forEach(b=>b.addEventListener("click",()=>showPage(b.dataset.go)));
async function loadTrades(){
 const r=await fetch("/api/trades");if(!r.ok)throw new Error("Gagal membaca jurnal.");allTrades=await r.json();
 renderJournal();renderOpenPositions();updateTradeLines();loadAnalytics();
}
function renderJournal(){
 const pair=$("filter-pair").value,status=$("filter-status").value;
 const rows=allTrades.filter(t=>(!pair||t.symbol===pair)&&(!status||t.status===status));
 $("journal-count").textContent=allTrades.length;$("journal-open").textContent=allTrades.filter(t=>t.status==="OPEN").length;
 const closed=allTrades.map(pnl).filter(x=>x!==null).reduce((a,b)=>a+b,0);
 $("journal-pnl").textContent=money(closed);$("journal-pnl").className=closed>=0?"positive":"negative";
 $("trade-list").innerHTML=rows.length?rows.map(t=>{
  const result=pnl(t),resultHtml=result===null?'<span class="muted-label">OPEN</span>':`<b class="${result>=0?"positive":"negative"}">${money(result)}</b>`;
  return `<article class="trade-card"><div class="trade-card-head"><div><div class="trade-pair">${safe(t.symbol)} <span class="direction-pill ${t.direction==="SHORT"?"short":""}">${t.direction}</span></div><div class="trade-meta">${new Date(t.opened_at).toLocaleString()} · ${safe(t.market||"SPOT")}</div></div><div>${resultHtml}</div></div>
  <div class="trade-numbers"><div><span>ENTRY</span><b>${price(t.entry_price)}</b></div><div><span>EXIT</span><b>${t.exit_price?price(t.exit_price):"—"}</b></div><div><span>QTY</span><b>${price(t.quantity)}</b></div></div>
  <div class="trade-card-foot"><small>${safe(t.strategy||"No strategy")} · ${safe(t.emotion||"No emotion")}</small><div class="card-actions">${t.screenshot_path?`<button class="mini-btn" data-photo="${safe(t.screenshot_path)}">Photo</button>`:""}<button class="mini-btn" data-edit="${t.id}">Edit</button><button class="mini-btn" data-delete="${t.id}">Delete</button></div></div>${t.notes?`<p class="trade-meta">${safe(t.notes)}</p>`:""}</article>`;
 }).join(""):'<div class="empty-state panel">Tidak ada transaksi untuk filter ini.</div>';
}
$("filter-pair").addEventListener("change",renderJournal);$("filter-status").addEventListener("change",renderJournal);
$("trade-list").addEventListener("click",async e=>{
 const edit=e.target.closest("[data-edit]"),del=e.target.closest("[data-delete]"),photo=e.target.closest("[data-photo]");
 if(edit){const t=allTrades.find(x=>x.id===Number(edit.dataset.edit));if(t)openModal(t);}
 if(del&&confirm("Hapus catatan transaksi ini?")){const r=await fetch(`/api/trades/${del.dataset.delete}`,{method:"DELETE"});if(r.ok){showToast("Trade dihapus");loadTrades();}}
 if(photo){window.open(photo.dataset.photo,"_blank","noopener");}
});
function renderOpenPositions(){
 const rows=allTrades.filter(t=>t.status==="OPEN");
 $("open-positions").innerHTML=rows.length?rows.map(t=>`<div class="position-row"><span><b>${safe(t.symbol)}</b> · ${t.direction}<small class="trade-meta"> Entry ${price(t.entry_price)}</small></span><span>SL ${t.stop_loss?price(t.stop_loss):"—"} · TP ${t.take_profit?price(t.take_profit):"—"}</span></div>`).join(""):'<div class="empty-state">Belum ada posisi terbuka.</div>';
}
function openModal(t=null){
 tradeEditId=t?.id||null;$("trade-form").reset();$("trade-id").value=t?.id||"";
 $("modal-title").textContent=t?"Edit trade":"Tambah trade";$("form-error").textContent="";
 if(t){
  for(const [k,v] of Object.entries(t)){const el=$(`trade-form`).elements.namedItem(k);if(el&&v!=null)el.value=k==="opened_at"?toLocal(v):v;}
  $("form-symbol").value=t.symbol;$("form-status").value=t.status;
 }
 if(!$("trade-form").elements.namedItem("opened_at").value)$("trade-form").elements.namedItem("opened_at").value=toLocal(new Date().toISOString());
 $("trade-modal").classList.add("open");$("trade-modal").setAttribute("aria-hidden","false");
}
function toLocal(iso){const d=new Date(iso);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);}
function closeModal(){$("trade-modal").classList.remove("open");$("trade-modal").setAttribute("aria-hidden","true");}
$("add-trade-btn").addEventListener("click",()=>openModal());$("close-modal").addEventListener("click",closeModal);
$("trade-modal").addEventListener("click",e=>{if(e.target===$("trade-modal"))closeModal();});
$("form-status").addEventListener("change",()=>{$("form-exit").required=$("form-status").value==="CLOSED";});
$("trade-form").addEventListener("submit",async e=>{
 e.preventDefault();const form=e.currentTarget,fd=new FormData(form);fd.delete("id");
 if($("form-status").value==="OPEN")fd.set("exit_price","");
 try{
  const id=tradeEditId,opts={method:id?"PUT":"POST",body:id?JSON.stringify(Object.fromEntries([...fd].filter(([k,v])=>k!=="screenshot"&&typeof v==="string").map(([k,v])=>[k,v]))):fd};
  if(id)opts.headers={"Content-Type":"application/json"};
  const r=await fetch(id?`/api/trades/${id}`:"/api/trades",opts),data=await r.json();
  if(!r.ok)throw new Error(data.error||"Tidak dapat menyimpan trade.");
  closeModal();showToast("Jurnal berhasil disimpan");await loadTrades();
 }catch(err){$("form-error").textContent=err.message;}
});
async function loadAnalytics(){
 const [sr,cr]=await Promise.all([fetch("/api/stats"),fetch("/api/calendar")]);const s=await sr.json();calendarData=await cr.json();
 $("a-pnl").textContent=money(s.netPnl);$("a-pnl").className=s.netPnl>=0?"positive":"negative";
 $("a-win").textContent=`${s.winRate.toFixed(1)}%`;$("a-record").textContent=`${s.wins}W / ${s.losses}L`;
 $("a-pf").textContent=s.profitFactor===null?"∞":Number(s.profitFactor).toFixed(2);
 $("a-dd").textContent=money(-s.maxDrawdown);$("a-avg").textContent=money(s.averageTrade);$("a-total").textContent=s.total;
 equitySeries.setData(s.equityCurve.map((p,i)=>({time:Math.floor(new Date(p.date).getTime()/1000),value:p.equity})));
 if(s.equityCurve.length)equityChart.timeScale().fitContent();
 renderPairPerformance();renderCalendar();
}
function renderPairPerformance(){
 const pairs=["BTCUSDT","ETHUSDT","SOLUSDT"];
 $("pair-performance").innerHTML=pairs.map(pair=>{
  const ts=allTrades.filter(t=>t.symbol===pair&&t.status==="CLOSED"),v=ts.map(pnl).reduce((a,b)=>a+b,0);
  const max=Math.max(1,...pairs.map(p=>Math.abs(allTrades.filter(t=>t.symbol===p&&t.status==="CLOSED").map(pnl).reduce((a,b)=>a+b,0))));
  return `<div class="pair-bar-row"><b>${pair}</b><div class="bar-track"><div class="bar-fill" style="width:${Math.max(2,Math.abs(v)/max*100)}%;background:${v>=0?"var(--green)":"var(--red)"}"></div></div><strong class="${v>=0?"positive":"negative"}">${money(v)}</strong></div>`;
 }).join("");
}
function renderCalendar(){
 const y=calendarMonth.getFullYear(),m=calendarMonth.getMonth(),first=new Date(y,m,1).getDay(),days=new Date(y,m+1,0).getDate();
 $("cal-month").textContent=calendarMonth.toLocaleDateString("id-ID",{month:"long",year:"numeric"});
 const map=Object.fromEntries(calendarData.map(x=>[x.date,x]));
 const names=["Min","Sen","Sel","Rab","Kam","Jum","Sab"];
 let html=names.map(n=>`<div class="weekday">${n}</div>`).join("");
 for(let i=0;i<first;i++)html+="<div></div>";
 for(let d=1;d<=days;d++){const key=`${y}-${String(m+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`,v=map[key];html+=`<div class="day ${v?(v.pnl>=0?"profit":"loss"):""}" title="${v?`${v.count} trade · ${money(v.pnl)}`:""}">${d}${v?`<br>${v.count}`:""}</div>`;}
 $("calendar-grid").innerHTML=html;
}
$("cal-prev").addEventListener("click",()=>{calendarMonth.setMonth(calendarMonth.getMonth()-1);renderCalendar()});
$("cal-next").addEventListener("click",()=>{calendarMonth.setMonth(calendarMonth.getMonth()+1);renderCalendar()});
$("backup-btn").addEventListener("click",()=>window.location.href="/api/backup");
$("csv-btn").addEventListener("click",()=>{
 const cols=["id","symbol","market","direction","status","entry_price","exit_price","stop_loss","take_profit","quantity","fees","strategy","setup","emotion","rating","notes","opened_at","closed_at"];
 const q=v=>`"${String(v??"").replace(/"/g,'""')}"`;
 const csv=[cols.join(","),...allTrades.map(t=>cols.map(c=>q(t[c])).join(","))].join("\n");
 downloadBlob(new Blob([csv],{type:"text/csv;charset=utf-8"}),"trading-journal.csv");
});
$("pdf-btn").addEventListener("click",()=>window.print());
$("import-file").addEventListener("change",async e=>{
 const f=e.target.files[0];if(!f)return;
 try{const data=JSON.parse(await f.text());if(!Array.isArray(data.trades))throw new Error("File backup tidak valid.");
  const r=await fetch("/api/backup/import",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});
  const out=await r.json();if(!r.ok)throw new Error(out.error);showToast("Backup berhasil diimpor");await loadTrades();
 }catch(err){showToast(err.message);}e.target.value="";
});
function downloadBlob(blob,name){const a=document.createElement("a"),url=URL.createObjectURL(blob);a.href=url;a.download=name;a.click();URL.revokeObjectURL(url);}
$("theme-btn").addEventListener("click",()=>document.body.classList.toggle("light"));
$("chart-fullscreen").addEventListener("click",()=>{const el=$("main-chart");if(el.requestFullscreen)el.requestFullscreen();});
window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();deferredInstall=e;$("install-btn").hidden=false;});
$("install-btn").addEventListener("click",async()=>{if(!deferredInstall)return;deferredInstall.prompt();await deferredInstall.userChoice;deferredInstall=null;$("install-btn").hidden=true;});
if("serviceWorker" in navigator)window.addEventListener("load",()=>navigator.serviceWorker.register("/sw.js").catch(()=>{}));
createCharts();
loadMarket().catch(e=>showToast(e.message));
loadTrades().catch(e=>showToast(e.message));
