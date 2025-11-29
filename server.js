require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const qrcode = require("qrcode");
const fs = require("fs");

const { default: makeWASocket, useSingleFileAuthState, DisconnectReason } = require("@adiwajshing/baileys");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

const app = express();
app.use(express.json());

// Mongo schema
const SessionSchema = new mongoose.Schema({
  sessionId: String,
  authState: mongoose.Schema.Types.Mixed,
  createdAt: { type: Date, default: Date.now }
});
const Session = mongoose.model("Session", SessionSchema);

// DB connect
mongoose.connect(process.env.MONGO_URI);

// Serve frontend
app.get("/", (req,res)=>res.sendFile(path.join(__dirname,"index.html")));

// Create temporary pairing session
app.post("/api/create-session", (req,res)=>{
  const sessionId = uuidv4();
  startSocket(sessionId);
  res.json({ sessionId });
});

// Stream QR + pairing updates via SSE
app.get("/api/events/:sessionId", (req,res)=>{
  res.set({ "Content-Type":"text/event-stream", "Cache-Control":"no-cache", Connection:"keep-alive" });
  const { sessionId } = req.params;
  const sock = sessions[sessionId]?.sock;
  if(!sock){
    res.write(`data: ${JSON.stringify({type:"status", status:"not-found"})}\n\n`);
    return res.end();
  }
  const push = (payload)=>res.write(`data: ${JSON.stringify(payload)}\n\n`);
  sessions[sessionId].clients.push(push);
  req.on("close", ()=> sessions[sessionId].clients = sessions[sessionId].clients.filter(fn=>fn!==push));
});

// In memory socket storage
const sessions = {};

// Start Baileys socket
function startSocket(sessionId){
  const authFile = path.join(__dirname, "auth-" + sessionId + ".json");
  const { state, saveState } = useSingleFileAuthState(authFile);
  const sock = makeWASocket({ auth: state, printQRInTerminal:false });
  sessions[sessionId] = { sock, authFile, clients:[], saveState };
  sock.ev.on("connection.update", async (update)=>{
    if(update.qr){
      const qrDataURL = await qrcode.toDataURL(update.qr);
      sessions[sessionId].clients.forEach(fn=>fn({ type:"qr", qr:update.qr, qrDataUrl:qrDataURL }));
    }
    if(update.connection === "open"){
      const credsRaw = fs.readFileSync(authFile,"utf8");
      const doc = new Session({ sessionId, authState:JSON.parse(credsRaw) });
      await doc.save();
      sessions[sessionId].clients.forEach(fn=>fn({ type:"status", status:"paired", sessionDbId:doc._id }));
    }
    if(update.connection === "close"){
      try{ sock.end(); }catch(e){}
      delete sessions[sessionId];
    }
  });
  sock.ev.on("creds.update", saveState);
}

// Launch server
app.listen(process.env.PORT || 10000, ()=>console.log("Server Started"));
