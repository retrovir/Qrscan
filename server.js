import express from "express";
import makeWASocket, { useMultiFileAuthState, DisconnectReason, jidDecode } from "@whiskeysockets/baileys";
import qrcode from "qrcode";
import dotenv from "dotenv";

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

    // QR generator
    sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        qrData = await qrcode.toDataURL(qr);
        console.log("🔄 NEW QR GENERATED");
      }

      if (connection === "open") {
        connected = true;
        restarting = false;
        sessionId = `session-${Date.now()}`;  // ✅ show on website
        console.log("✅ PAIRED SUCCESSFULLY");
      }

      if (connection === "close" && !restarting) {
        const reason = lastDisconnect?.error?.output?.statusCode;
        const shouldRestart = reason !== DisconnectReason.loggedOut;

        if (shouldRestart) {
          restarting = true;
          connected = false;
          console.log("⚠ Restarting socket in 5 sec...");
          setTimeout(() => startSocket(), 5000);
        }
      }
    });

    // Listen for WhatsApp commands
    sock.ev.on("messages.upsert", async ({ messages }) => {
      const m = messages[0];
      if (!connected || !sessionId) return; // ✅ prevent premature send

      const jid = m.key.remoteJid;
      if (!jid) return;

      const msg = m.message?.conversation?.toLowerCase() || "";

      if (!m.key.fromMe && msg === "get session") {
        const decoded = jidDecode(jid);
        const user = decoded?.user || "unknown";
        const server = decoded?.server || "unknown";

        await sock.sendMessage(jid, { text: `✅ Session ID: ${sessionId}\nJID: ${user}@${server}` });
      }
    });

  } catch (err) {
    console.log("❌ SOCKET ERROR:", err.message);
    setTimeout(() => startSocket(), 5000);
  }
}

// Serve frontend
app.get("/", (_, res) => {
  res.sendFile(new URL("./index.html", import.meta.url).pathname);
});

// API to return QR to frontend
app.get("/qr", (_, res) => {
  res.json({ qr: qrData });
});

// API to return session ID to website
app.get("/session", (_, res) => {
  res.json({ sessionId });
});

app.listen(process.env.PORT || 10000, () => {
  console.log("🚀 Server Running");
  startSocket();
});
                     
