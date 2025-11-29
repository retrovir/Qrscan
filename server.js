require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const qrcode = require("qrcode");
const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

const { default: makeWASocket, DisconnectReason, useMultiFileAuthState } = require("baileys");

const app = express();
app.use(express.json());

// Mongo schema
const SessionSchema = new mongoose.Schema({
  sessionId: String,
  authFolder: String,
  createdAt: { type: Date, default: Date.now }
});
const Session = mongoose.model("Session", SessionSchema);

// DB connect
mongoose.connect(process.env.MONGO_URI);

// Serve frontend from same backend
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// Create pairing session
app.post("/api/create-session", (req, res) => {
  const sessionId = uuidv4();
  startSocket(sessionId);
  res.json({ sessionId });
});

// SSE events
app.get("/api/events/:sessionId", (req, res) => {
  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  const { sessionId } = req.params;
  const session = sessions[sessionId];
  if (!session) {
    res.write(`data: ${JSON.stringify({ type: "status", status: "not-found" })}\n\n`);
    return res.end();
  }
  const push = (payload) => res.write(`data: ${JSON.stringify(payload)}\n\n`);
  session.clients.push(push);
  req.on("close", () => {
    session.clients = session.clients.filter((fn) => fn !== push);
  });
});

// In-memory WA sessions
const sessions = {};

async function startSocket(sessionId) {
  const authFolder = path.join(__dirname, "auth-" + sessionId);
  if (!fs.existsSync(authFolder)) fs.mkdirSync(authFolder);

  const { state, saveCreds } = await useMultiFileAuthState(authFolder);
  const sock = makeWASocket({ auth: state, printQRInTerminal: false });

  sessions[sessionId] = { sock, authFolder, clients: [] };

  sock.ev.on("connection.update", async (update) => {
    const session = sessions[sessionId];
    if (update.qr) {
      const dataUrl = await qrcode.toDataURL(update.qr);
      session.clients.forEach((fn) => fn({ type: "qr", qrDataUrl: dataUrl }));
    }
    if (update.connection === "open") {
      await saveCreds();
      await Session.create({ sessionId, authFolder });
      session.clients.forEach((fn) => fn({ type: "status", status: "paired", sessionDbId: sessionId }));
    }
    if (update.connection === "close") {
      try {
        sock.end();
      } catch {}
      delete sessions[sessionId];
    }
  });

  sock.ev.on("creds.update", saveCreds);
}

app.listen(process.env.PORT || 10000, () => console.log("Server Started"));
