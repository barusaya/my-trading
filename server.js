require("dotenv").config();
const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const Database = require("better-sqlite3");
const multer = require("multer");
const fs = require("fs");
const path = require("path");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const uploadDir = path.join(ROOT, "public", "uploads");
fs.mkdirSync(uploadDir, { recursive: true });

app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(ROOT, "public")));
const db = new Database(path.join(ROOT, "trading.db"));
db.pragma("journal_mode = WAL");
db.exec(fs.readFileSync(path.join(ROOT, "database/schema.sql"), "utf8"));

const allowedSymbols = new Set(["BTCUSDT", "ETHUSDT", "SOLUSDT"]);
const intervals = new Set(["1m","3m","5m","15m","30m","1h","2h","4h","6h","12h","1d","1w","1M"]);
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${path.extname(file.originalname).toLowerCase()}`)
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, /^image\/(jpeg|png|webp)$/.test(file.mimetype))
});

function pinGuard(req, res, next) {
  if (!process.env.APP_PIN) return next();
  const supplied = req.get("x-app-pin");
  if (supplied !== process.env.APP_PIN) return res.status(401).json({error:"PIN aplikasi tidak valid."});
  next();
}
app.use("/api/trades", pinGuard);
app.use("/api/backup", pinGuard);
app.use("/api/stats", pinGuard);

app.get("/api/klines", async (req, res) => {
  const symbol = String(req.query.symbol || "BTCUSDT").toUpperCase();
  const interval = String(req.query.interval || "1m");
  const limit = Math.min(Math.max(Number(req.query.limit) || 500, 1), 1000);
  if (!allowedSymbols.has(symbol) || !intervals.has(interval)) return res.status(400).json({error:"Symbol/timeframe tidak didukung."});
  try {
    const url = new URL("https://data-api.binance.vision/api/v3/klines");
    url.search = new URLSearchParams({symbol, interval, limit}).toString();
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Binance HTTP ${response.status}`);
    const rows = await response.json();
    res.json(rows.map(k => ({
      time: Math.floor(k[0]/1000), open:+k[1], high:+k[2], low:+k[3], close:+k[4], volume:+k[5]
    })));
  } catch(e) { res.status(502).json({error:"Tidak dapat mengambil candle Binance.", detail:e.message}); }
});

const tradeSelect = db.prepare("SELECT * FROM trades ORDER BY opened_at DESC, id DESC");
app.get("/api/trades", (_req,res) => res.json(tradeSelect.all()));

const insertTrade = db.prepare(`
 INSERT INTO trades(symbol,market,direction,status,entry_price,exit_price,stop_loss,take_profit,quantity,fees,strategy,setup,emotion,rating,notes,screenshot_path,opened_at,closed_at)
 VALUES(@symbol,@market,@direction,@status,@entry_price,@exit_price,@stop_loss,@take_profit,@quantity,@fees,@strategy,@setup,@emotion,@rating,@notes,@screenshot_path,@opened_at,@closed_at)
`);
app.post("/api/trades", upload.single("screenshot"), (req,res) => {
 const b=req.body||{};
 const symbol=String(b.symbol||"").toUpperCase();
 const direction=String(b.direction||"").toUpperCase();
 const status=String(b.status||"CLOSED").toUpperCase();
 const entry=Number(b.entry_price), qty=Number(b.quantity);
 if(!allowedSymbols.has(symbol)||!["LONG","SHORT"].includes(direction)||!["OPEN","CLOSED"].includes(status)||!(entry>0)||!(qty>0)) {
   if(req.file) fs.unlink(req.file.path,()=>{});
   return res.status(400).json({error:"Periksa pair, arah, status, entry dan quantity."});
 }
 const exit = b.exit_price ? Number(b.exit_price) : null;
 if(status==="CLOSED" && !(exit>0)) {
   if(req.file) fs.unlink(req.file.path,()=>{});
   return res.status(400).json({error:"Exit price wajib untuk posisi CLOSED."});
 }
 const row={
  symbol,market:String(b.market||"SPOT").toUpperCase(),direction,status,entry_price:entry,exit_price:exit,
  stop_loss:b.stop_loss?Number(b.stop_loss):null,take_profit:b.take_profit?Number(b.take_profit):null,
  quantity:qty,fees:Number(b.fees||0),strategy:String(b.strategy||""),setup:String(b.setup||""),
  emotion:String(b.emotion||""),rating:Math.min(5,Math.max(0,Number(b.rating||0))),
  notes:String(b.notes||""),screenshot_path:req.file?`/uploads/${req.file.filename}`:"",
  opened_at:b.opened_at||new Date().toISOString(),closed_at:status==="CLOSED"?(b.closed_at||new Date().toISOString()):null
 };
 const result=insertTrade.run(row);
 res.status(201).json(db.prepare("SELECT * FROM trades WHERE id=?").get(result.lastInsertRowid));
});
app.put("/api/trades/:id", (req,res) => {
 const id=Number(req.params.id), b=req.body||{};
 const old=db.prepare("SELECT * FROM trades WHERE id=?").get(id);
 if(!old) return res.status(404).json({error:"Trade tidak ditemukan."});
 const allowed=["status","exit_price","stop_loss","take_profit","fees","strategy","setup","emotion","rating","notes","closed_at"];
 const values={...old};
 for(const k of allowed) if(b[k]!==undefined) values[k]=b[k];
 if(!["OPEN","CLOSED"].includes(values.status)) return res.status(400).json({error:"Status tidak valid."});
 if(values.status==="CLOSED" && !(Number(values.exit_price)>0)) return res.status(400).json({error:"Exit price diperlukan."});
 if(values.status==="CLOSED" && !values.closed_at) values.closed_at=new Date().toISOString();
 db.prepare(`UPDATE trades SET status=@status,exit_price=@exit_price,stop_loss=@stop_loss,take_profit=@take_profit,fees=@fees,strategy=@strategy,setup=@setup,emotion=@emotion,rating=@rating,notes=@notes,closed_at=@closed_at WHERE id=@id`).run({...values,id});
 res.json(db.prepare("SELECT * FROM trades WHERE id=?").get(id));
});
app.delete("/api/trades/:id", (req,res) => {
 const old=db.prepare("SELECT screenshot_path FROM trades WHERE id=?").get(Number(req.params.id));
 if(!old) return res.status(404).json({error:"Trade tidak ditemukan."});
 db.prepare("DELETE FROM trades WHERE id=?").run(Number(req.params.id));
 if(old.screenshot_path) { const p=path.join(ROOT,"public",old.screenshot_path.replace(/^\//,"")); if(p.startsWith(uploadDir)) fs.unlink(p,()=>{}); }
 res.json({success:true});
});

function calc(t) {
 if(t.status!=="CLOSED" || !t.exit_price) return null;
 const gross=(t.direction==="LONG"?t.exit_price-t.entry_price:t.entry_price-t.exit_price)*t.quantity;
 return gross-Number(t.fees||0);
}
app.get("/api/stats", (req,res) => {
 const rows=tradeSelect.all().filter(t=>t.status==="CLOSED");
 let wins=0,losses=0,net=0,gp=0,gl=0,peak=0,maxDD=0,equity=0;
 const curve=[];
 const sorted=[...rows].sort((a,b)=>new Date(a.closed_at)-new Date(b.closed_at));
 for(const t of sorted){
  const pnl=calc(t); net+=pnl; equity+=pnl;
  if(pnl>0){wins++;gp+=pnl;} else if(pnl<0){losses++;gl+=Math.abs(pnl);}
  peak=Math.max(peak,equity); maxDD=Math.max(maxDD,peak-equity);
  curve.push({date:t.closed_at||t.opened_at,pnl:+pnl.toFixed(8),equity:+equity.toFixed(8)});
 }
 const n=rows.length;
 res.json({total:n,wins,losses,breakeven:n-wins-losses,winRate:n?wins/n*100:0,netPnl:net,grossProfit:gp,grossLoss:gl,profitFactor:gl?gp/gl:(gp?null:0),averageTrade:n?net/n:0,maxDrawdown:maxDD,equityCurve:curve});
});
app.get("/api/calendar", (_req,res) => {
 const rows=tradeSelect.all().filter(t=>t.status==="CLOSED");
 const map={};
 for(const t of rows){const date=(t.closed_at||t.opened_at).slice(0,10);map[date]??={date,count:0,pnl:0};map[date].count++;map[date].pnl+=calc(t);}
 res.json(Object.values(map).sort((a,b)=>a.date.localeCompare(b.date)));
});
app.get("/api/backup", (_req,res) => {
 res.setHeader("Content-Disposition",`attachment; filename=trading-journal-backup-${new Date().toISOString().slice(0,10)}.json`);
 res.json({version:1,exportedAt:new Date().toISOString(),trades:tradeSelect.all()});
});
app.post("/api/backup/import", express.json({limit:"10mb"}), (req,res) => {
 const rows=req.body?.trades;
 if(!Array.isArray(rows)) return res.status(400).json({error:"Format backup tidak valid."});
 const tx=db.transaction(items=>{
  for(const t of items){
   if(!allowedSymbols.has(String(t.symbol).toUpperCase())||!["LONG","SHORT"].includes(t.direction)||!(Number(t.entry_price)>0)||!(Number(t.quantity)>0)) continue;
   insertTrade.run({
    symbol:String(t.symbol).toUpperCase(),market:t.market||"SPOT",direction:t.direction,status:t.status==="OPEN"?"OPEN":"CLOSED",
    entry_price:Number(t.entry_price),exit_price:t.exit_price?Number(t.exit_price):null,
    stop_loss:t.stop_loss?Number(t.stop_loss):null,take_profit:t.take_profit?Number(t.take_profit):null,
    quantity:Number(t.quantity),fees:Number(t.fees||0),strategy:t.strategy||"",setup:t.setup||"",emotion:t.emotion||"",
    rating:Number(t.rating||0),notes:t.notes||"",screenshot_path:"",opened_at:t.opened_at||new Date().toISOString(),
    closed_at:t.closed_at||null
   });
  }
 });
 tx(rows); res.json({success:true,received:rows.length});
});

let clientCount=0;
wss.on("connection", client=>{
 let upstream=null, reconnect=null, streamName=null, dead=false;
 clientCount++;
 function subscribe(name){
  streamName=name;
  if(upstream){upstream.removeAllListeners();upstream.terminate();}
  upstream=new WebSocket(`wss://stream.binance.com:9443/ws/${name}`);
  upstream.on("message",data=>{if(client.readyState===WebSocket.OPEN)client.send(data.toString());});
  upstream.on("close",()=>{if(!dead&&streamName===name)reconnect=setTimeout(()=>subscribe(name),2500);});
  upstream.on("error",()=>{});
 }
 client.on("message",raw=>{
  try{
   const m=JSON.parse(raw.toString()),s=String(m.symbol||"").toUpperCase(),i=String(m.interval||"");
   if(allowedSymbols.has(s)&&intervals.has(i))subscribe(`${s.toLowerCase()}@kline_${i.toLowerCase()}`);
  }catch{}
 });
 client.on("close",()=>{dead=true;clearTimeout(reconnect);if(upstream){upstream.removeAllListeners();upstream.terminate();}clientCount--;});
});
server.listen(PORT,()=>console.log(`Mobile Crypto Journal: http://localhost:${PORT}`));
