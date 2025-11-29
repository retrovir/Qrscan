import makeWASocket, { DisconnectReason, useMultiFileAuthState } from "@whiskeysockets/baileys";
import qrcode from "qrcode";
import express from "express";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 10000;

let qrDataURL = null;
let pairingError = null;
let connected = false;
let sessionId = null;
let sock = null;

// Load auth state
const { state, saveCreds } = await useMultiFileAuthState("wa_auth");

// Start WhatsApp Socket
async function startSocket() {
  try {
    sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      browser: ["Render", "Chrome", "1.0"],
    });

    sock.ev.on("creds.update", saveCreds);
    sock.ev.on("connection.update", async ({ connection, qr, lastDisconnect }) => {
      if (qr && !connected) {
        qrDataURL = await qrcode.toDataURL(qr);
        restarting = false;
      }

      if (connection === "open") {
        connected = true;
        qrDataURL = null;
        sessionId = `session-${Date.now()}`;
        console.log("✅ Connected. Session:", sessionId);

        await sock.sendMessage(sock.user.id, { text: `✅ Connected Successfully! 🆔 Session: ${sessionId}` });
      }

      if (connection === "close") {
        connected = false;
        pairingError = "❌ Disconnected. Reconnecting automatically...";
        console.log("🔄 Restarting socket...");

        const reason = lastDisconnect?.error?.output?.statusCode;
        if (reason !== DisconnectReason.loggedOut) {
          setTimeout(startSocket, 5000);
        }
      }
    });

    sock.ev.on("messages.upsert", async ({ messages }) => {
      const m = messages[0];
      if (!m.key.fromMe && m.message) {
        const msg = m.message.conversation || "";
        if (msg.toLowerCase() === "get session") {
          await sock.sendMessage(m.key.remoteJid, { text: `Your session ID:\n${sessionId}` });
        }
      }
    });

  } catch (err) {
    pairingError = "❌ Error in WA connection (auto restarting...)";
    console.log("⚠ WA Socket Error:", err);
    setTimeout(startSocket, 4000);
  }

  return sock;
}

sock = await startSocket();

// Serve frontend + QR + session
app.get("/", (req, res) => {
  res.send(`
  <html>
  <head>
    <title>WhatsApp QR Pairing</title>
    <meta http-equiv="refresh" content="30">
  </head>
  <body style="background:#0f172a;color:white;font-family:Poppins;display:flex;justify-content:center;align-items:center;height:90vh;text-align:center;">
    <div>
      <h2>📷 Scan WhatsApp QR</h2>
      ${pairingError ? `<pre style="background:red;padding:10px;border-radius:8px;">${pairingError}</pre>` : ""}
      ${qrDataURL ? `<img src="${qrDataURL}" style="width:300px;background:white;padding:10px;border-radius:12px;"/>` : "<p>Generating QR...</p>"}
      ${connected ? `<h3>✅ PAIRING SUCCESS!</h3><p>Your Session ID:<br><b>${sessionId}</b></p>` : "<p>Waiting for scan...</p>"}
    </div>
  </body>
  </html>
  `);
});

// Health endpoint for Render
app.get("/health", (req, res) => res.send("OK"));

app.listen(PORT, () => console.log(`🚀 Running on port ${PORT}`));
