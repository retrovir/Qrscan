import makeWASocket from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import { useMultiFileAuthState } from "@whiskeysockets/baileys";
import qrcode from "qrcode";
import express from "express";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 10000;

let qrDataURL = null;
let pairingError = null;
let connected = false;
let restarting = false;
let sessionId = null;

// Load auth state
const { state } = await useMultiFileAuthState("wa_auth");

// Function to start socket with auto-restart
async function startSocket() {
  restarting = false;
  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    browser: ["Render", "Chrome", "1.0"],
    connectTimeoutMs: 60000,
    retryRequestDelayMs: 250,
    keepAliveIntervalMs: 25000,
    emitOwnEvents: true
  });

  // Handle connection updates
  sock.ev.on("connection.update", async (update) => {
    const { qr, connection, lastDisconnect } = update;

    if (connection === "open") {
      connected = true;
      qrDataURL = null;
      sessionId = `session-${Date.now()}`;

      console.log(`✅ Device paired: ${sessionId}`);

      await sock.sendMessage(sock.user.id, {
        text: `✅ *WhatsApp Paired Successfully!*\n\n🆔 *Session ID:*\n${sessionId}\n\nYou can now close the page 🚀`
      });
    }

    if (qr && !connected) {
      qrDataURL = await qrcode.toDataURL(qr);
    }

    if (connection === "close") {
      const err = lastDisconnect?.error;
      const boom = Boom.isBoom(err) ? err : new Boom(err);

      console.error(`⚠ Disconnected:`, boom.output?.statusCode);

      if (boom.output?.statusCode !== 401 && !restarting) {
        restarting = true;
        connected = false;
        qrDataURL = null;
        pairingError = `Connection failed (Auto-Restarting...)`;
        console.log("♻ Restarting WA socket in 5 seconds...");
        setTimeout(startSocket, 5000);
      }
    }
  });

  // Stream failure fix — restart if Baileys throws stream error
  sock.ev.on("stream.error", async () => {
    if (!restarting) {
      restarting = true;
      pairingError = "❌ Stream Error (Restarting automatically...)";
      console.log("🔄 Restarting socket due to stream crash...");
      sock.ws.close();
      setTimeout(startSocket, 4000);
    }
  });

  return sock;
}

let sock = await startSocket();

// Auto generate new QR every 30 sec if not connected
setInterval(() => {
  if (!connected && !restarting) {
    console.log("⌛ QR expired — requesting new one...");
    qrDataURL = null;
    restarting = true;
    sock.ws.close();
    setTimeout(async () => {
      sock = await startSocket();
    }, 2000);
  }
}, 30000);

app.get("/", (req, res) => {
  res.send(`
  <html>
  <head>
    <title>WhatsApp QR Login</title>
    <meta http-equiv="refresh" content="30">
  </head>
  <body style="background:#0f172a;color:white;display:flex;justify-content:center;align-items:center;height:90vh;font-family:Poppins;text-align:center;">
    <div style="padding:20px;">
      <h2>🔍 Scan WhatsApp QR</h2>

      ${
        pairingError
          ? `<p style="background:red;padding:12px;border-radius:8px;white-space:pre;">${pairingError}</p>`
          : ""
      }

      ${
        qrDataURL
          ? `<img src="${qrDataURL}" style="width:270px;border-radius:12px;background:white;padding:12px;"/>`
          : `<p>⏳ Generating fresh QR...</p>`
      }

      <p style="opacity:0.6;font-size:13px;">Page will auto-refresh & regenerate QR every 30 sec</p>
      ${
        sessionId && connected
          ? `<h3>✅ Connected! (Check WhatsApp for Session)</h3>`
          : ""
      }
    </div>
  </body>
  </html>
  `);
});

app.get("/health", (req, res) => res.send("OK"));

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
  
