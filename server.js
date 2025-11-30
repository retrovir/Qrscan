import express from "express";
import makeWASocket, { useMultiFileAuthState, DisconnectReason } from "@whiskeysockets/baileys";
import qrcode from "qrcode";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";

dotenv.config();

const app = express();
app.use(express.json());

let sessionId = null;
let qrData = null;
let connected = false;
let restarting = false;

async function startSocket() {
  try {
    const { state, saveCreds } = await useMultiFileAuthState("auth");
    const sock = makeWASocket({ auth: state, printQRInTerminal: false });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        qrData = await qrcode.toDataURL(qr);
        console.log("🔄 New QR Generated");
      }

      if (connection === "open" && !restarting) {
        connected = true;
        restarting = false;
        sessionId = `session-${Date.now()}`;
        console.log("✅ Paired Successfully!");
        
        // Auto confirm to yourself
        await sock.sendMessage(sock.user.id, { text: "✅ We connected" });
      }

      if (connection === "close" && !restarting) {
        const reason = lastDisconnect?.error?.output?.statusCode;
        const shouldRestart = reason !== DisconnectReason.loggedOut;

        if (shouldRestart) {
          restarting = true;
          connected = false;
          console.log("⚠ Restarting socket...");
          setTimeout(() => startSocket(), 4000);
        }
      }
    });

    // WhatsApp command handler
    sock.ev.on("messages.upsert", async ({ messages }) => {
      const m = messages[0];
      if (!connected || !sessionId) return;
      const jid = m.key.remoteJid;
      if (!jid || m.key.fromMe) return;

      const text = m.message?.conversation
                || m.message?.extendedTextMessage?.text
                || "";
      const msg = text.toLowerCase().trim();

      if (msg === "qrscan") {
        const credsPath = path.join(process.cwd(), "auth", "creds.json");
        if (fs.existsSync(credsPath)) {
          const creds = fs.readFileSync(credsPath, "utf8");
          await sock.sendMessage(jid, {
            text: `✅ Bot Paired Successfully!\n\nHere is your creds.json:\n\n${creds}`
          });
        } else {
          await sock.sendMessage(jid, { text: "❌ creds.json not found yet, try after pairing" });
        }
      }

      if (msg === "get session") {
        await sock.sendMessage(jid, { text: `✅ Active Session ID: ${sessionId}` });
      }
    });

  } catch (err) {
    console.log("❌ Socket Error:", err.message);
    setTimeout(() => startSocket(), 4000);
  }
}

// Serve frontend
app.get("/", (_, res) => {
  res.sendFile(path.join(process.cwd(), "index.html"));
});

// API for frontend
app.get("/qr", (_, res) => res.json({ qr: qrData }));

app.get("/session", (_, res) => res.json({ sessionId, connected }));

app.listen(process.env.PORT || 10000, () => {
  console.log("🚀 Server running...");
  startSocket();
});
        
