import express from "express";
import makeWASocket, { useMultiFileAuthState, DisconnectReason } from "@whiskeysockets/baileys";
import qrcode from "qrcode";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import archiver from "archiver";

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

    sock.ev.on("creds.update", async () => {
      await saveCreds();
      if (connected && !restarting) {
        console.log("💾 Credentials Updated");
      }
    });

    sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        qrData = await qrcode.toDataURL(qr);
        console.log("🔄 New QR Generated");
      }

      if (connection === "open") {
        connected = true;
        restarting = false;
        sessionId = `session-${Date.now()}`;
        console.log("✅ Paired Successfully!");
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

    sock.ev.on("messages.upsert", async ({ messages }) => {
      const m = messages[0];
      if (!connected || !sessionId) return;
      const jid = m.key.remoteJid;
      if (!jid || m.key.fromMe) return;

      const text = m.message?.conversation
                || m.message?.extendedTextMessage?.text
                || "";
      const msg = text.toLowerCase().trim();

      if (msg === "get session") {
        await sock.sendMessage(jid, { text: `✅ Active Session ID: ${sessionId}` });
      }
    });

  } catch (err) {
    console.log("❌ Socket Error:", err.message);
    setTimeout(() => startSocket(), 4000);
  }
}

app.get("/", (_, res) => {
  res.sendFile(path.join(process.cwd(), "index.html"));
});

app.get("/qr", (_, res) => res.json({ qr: qrData }));

app.get("/session", (_, res) => res.json({ sessionId, connected }));

app.get("/download/creds", (_, res) => {
  const credsPath = path.join(process.cwd(), "auth", "creds.json");
  if (fs.existsSync(credsPath)) {
    res.download(credsPath);
  } else {
    res.status(404).json({ error: "creds.json not found" });
  }
});

app.get("/download/auth-zip", (_, res) => {
  const authDir = path.join(process.cwd(), "auth");
  const zipFile = path.join(process.cwd(), "auth.zip");

  const output = fs.createWriteStream(zipFile);
  const archive = archiver("zip", { zlib: { level: 9 } });

  output.on("close", () => res.download(zipFile));

  archive.pipe(output);
  archive.directory(authDir, false);
  archive.finalize();
});

app.listen(process.env.PORT || 10000, () => {
  console.log("🚀 Server running...");
  startSocket();
});
