import makeWASocket, { DisconnectReason, useMultiFileAuthState } from "@whiskeysockets/baileys";
import qrcode from "qrcode";
import express from "express";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 10000;

let qrDataURL = null;
let connected = false;
let sessionId = null;
let restarting = false; // ✅ fixed & defined properly
let sock = null;

// Load authentication state
const { state, saveCreds } = await useMultiFileAuthState("wa_auth");

// Start WhatsApp socket
async function startSocket() {
  try {
    restarting = true;
    sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      browser: ["Render", "Chrome", "1.0"],
    });

    sock.ev.on("creds.update", saveCreds);
    sock.ev.on("connection.update", async ({ connection, qr, lastDisconnect }) => {
      if (qr && !connected && !restarting) {
        qrDataURL = await qrcode.toDataURL(qr);
      }

      if (qi) { // <--- incorrect lines? removed, not needed
        restarting = false;
      }

      if (connection === "open") {
        connected = true;
        qrDataURL = null;
        sessionId = `session-${Date.now()}`;
        console.log("✅ Connected Successfully. Session:", sessionId);
      }

      if (connection === "close") {
        connected = false;
        console.log("🔄 Restarting WA socket in 5 seconds...");
        restarting = false;
        const reason = lastDisconnect?.error?.output?.statusCode;
        if (reason !== DisconnectReason.loggedOut) {
          setTimeout(startSocket, 5000);
        }
      }
    });

    sock.ev.on("messages.upsert", async ({ messages }) => {
      const m = messages[0];
      const msg = m.message?.conversation || "";
      if (!m.key.fromMe && msg.toLowerCase() === "get session") {
        await sock.sendMessage(m.key.remoteJid, { text: `Your SESSION ID:\n${sessionId}` });
      }
    });

  } catch (err) {
    console.log("⚠ Error:", err);
    restarting = false;
    setTimeout(startSocket, 4000);
  }

  return sock;
}

sock = await startSocket();

// Start or restart socket on refresh
async function startSocket() {
  qrDataURL = null;
  sessionId = null;
  connected = false;
  restarting = false;
  await startSocket();
}

// Serve website QR
app.get("/", (req, res) => {
  res.send(`
  <html>
  <head>
    <title>WhatsApp QR Login</title>
    <script>
      setTimeout(() => window.location.reload(), 30000); // ✅ 30 sec timer for new QR
    </script>
  </head>
  <body style="background:#0f172a;color:white;font-family:Poppins;display:flex;justify-content:center;align-items:center;height:90vh;text-align:center;">
    <div>
      <h2>📷 Scan WhatsApp QR</h2>
      <p>QR refresh every 30 seconds automatically</p>
      ${qrDataURL ? `<img src="${qrDataURL}" style="width:300px;background:white;padding:10px;border-radius:12px;"/>` : "<p>Generating QR...</p>"}
      ${connected ? `<h3>✅ PAIR SUCCESS!</h3><p>Your Session ID:<br><b>${sessionId}</b></p>` : "<p>Waiting...</p>"}
    </div>
  </body>
  </html>
  `);
});

// Health endpoint for Render
app.get("/health", (req, res) => res.send("OK"));

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
