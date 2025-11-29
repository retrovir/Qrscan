import makeWASocket from "@whiskeysockets/baileys";
import qrcode from "qrcode";
import express from "express";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 10000;

let latestQR = null;
let pairingError = null;
let sessionId = null;

const sock = makeWASocket({
  printQRInTerminal: false,
  browser: ["Render", "Chrome", "1.0"]
});

sock.ev.on("connection.update", async (update) => {
  const { qr, connection, lastDisconnect } = update;

  if (qr) {
    latestQR = await qrcode.toDataURL(qr);
  }

  if (connection === "open") {
    sessionId = `session-${Date.now()}`; // auto-generated session id
    latestQR = null;
  }

  if (lastDisconnect?.error) {
    pairingError = lastDisconnect.error?.message || "Unknown disconnect error";
  }
});

app.get("/", (req, res) => {
  res.send(`
  <html>
  <head>
    <title>WhatsApp Pairing Portal</title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
    <style>
      body { font-family: Poppins, sans-serif; display:flex; justify-content:center; align-items:center; height:100vh; background:#0f172a; color:white; text-align:center; }
      img { width:260px; border-radius:16px; padding:12px; background:white; }
      .box { padding:22px; border-radius:18px; background:#1e293b; box-shadow:0 0 18px rgba(255,255,255,0.1); }
      .error { color:#ff6b6b; margin-top:12px; }
      .success { color:#4ade80; font-size:20px; margin-top:14px; }
    </style>
  </head>
  <body>
    <div class="box box">
      <h2>Scan WhatsApp QR to Pair</h2>

      ${ pairingError ? `<div class="error">❌ Error: ${pairingError}</div>` : "" }

      ${ latestQR ? `<img src="${latestQR}" />` : sessionId ? `<div class="success">✅ Paired!<br>Session ID: <b>${sessionId}</b></div>` : `<p>Waiting for QR…</p>` }

      <p style="font-size:13px; opacity:0.6; margin-top:12px;">QR refreshes automatically. Try again if expired.</p>
    </div>
  </body>
  </html>
  `);
});

app.listen(PORT, () => console.log(`🚀 Server Live on port ${PORT}`));
