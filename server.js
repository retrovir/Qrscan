import makeWASocket, { useMultiFileAuthState } from "@whiskeysockets/baileys";
import qrcode from "qrcode";
import express from "express";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 10000;

const { state: authState } = await useMultiFileAuthState("session_auth");

let latestQR = null;
let pairingError = null;
let sessionId = null;
let connected = false;

const sock = makeWASocket({
  auth: authState,
  printQRInTerminal: false,
  browser: ["Render", "Chrome", "1.0"]
});

// ✅ Send session ID in WhatsApp once paired
sock.ev.on("connection.update", async (update) => {
  const { qr, connection, lastDisconnect } = update;

  try {
    if (qr && !connected) {
      latestQR = await qrcode.toDataURL(qr);
    }

    if (connection === "open" && !connected) {
      connected = true;
      connected = true;
      sessionId = `session-${Date.now()}`;

      console.log(`✅ Connected | Session ID: ${sessionId}`);

      // 📩 Send message to yourself in WhatsApp
      await sock.sendMessage(sock.user.id, {
        text: `✅ *WhatsApp Paired Successfully!*\n\n🆔 *Your Session ID:*\n${sessionId}\n\nThis session is now active 🔥`
      });

    }

    if (lastDisconnect?.error && !connected) {
      pairingError = lastDisconnect.error.message;
      console.error(pairingError);
    }

  } catch (err) {
    pairingError = err.message;
    console.error(err.message);
  }
});

// ✅ If paired, redirect user away from UI
app.get("/", (req, res) => {
  if (connected) {
    return res.send(`
    <html>
    <body style="background:#0f172a;color:white;display:flex;justify-content:center;align-items:center;height:90vh;font-family:Poppins;text-align:center;">
      <div>
        <h2>✅ Connected Successfully!</h2>
        <p>Your session ID has been sent to you in WhatsApp 🚀</p>
        <p>You can now close this page.</p>
      </div>
    </body>
    </html>
    `);
  }

  res.send(`
  <html>
  <head><title>QR Scan</title></head>
  <body style="background:#0f172a;color:white;display:flex;justify-content:center;align-items:center;height:90vh;font-family:Poppins;text-align:center;">
    <div>
      <h2>Scan WhatsApp QR</h2>
      ${pairingError ? `<p style="background:red;padding:10px;border-radius:8px;">❌ Error:<br>${pairingError}</p>` : ""}
      ${latestQR ? `<img src="${latestQR}" style="width:260px;border-radius:12px;background:white;padding:12px;"/>` : `<p>Generating QR...</p>`}
      <p style="opacity:0.5;font-size:12px;">Refresh if expired</p>
    </div>
  </body>
  </html>
  `);
});

app.get("/health", (req, res) => res.send("OK"));

app.listen(PORT, () => console.log(`🚀 Running on port ${PORT}`));
