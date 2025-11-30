import express from "express";
import makeWASocket, { useMultiFileAuthState, DisconnectReason, jidDecode } from "@whiskeysockets/baileys";
import qrcode from "qrcode";
import dotenv from "dotenv";
import fs from "fs";

dotenv.config();

const app = express();
app.use(express.json());

let sessionId = null;
let qrData = null;
let connected = false;
let restarting = false;

// single socket reference so we can reuse/close it
let sock = null;
// send creds only once per successful pairing
let sentCredsSent = false;

async function startSocket() {
  try {
    const { state, saveCreds } = await useMultiFileAuthState("auth");
    sock = makeWASocket({ auth: state, printQRInTerminal: false });

    sock.ev.on("creds.update", saveCreds);

    // QR generator + connection state
    sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        qrData = await qrcode.toDataURL(qr);
        console.log("🔄 NEW QR GENERATED");
      }

      if (connection === "open") {
        connected = true;
        restarting = false;
        sessionId = `session-${Date.now()}`;  // show on website
        console.log("✅ PAIRED SUCCESSFULLY");

        // Send auth credential files to the paired number once per session
        try {
          if (!sentCredsSent) {
            sentCredsSent = true;

            // Determine owner JID: prefer sock.user?.id then fallback to state.creds.me.id
            let ownerJid = null;
            try { ownerJid = sock?.user?.id || null; } catch (e) { ownerJid = null; }

            if (!ownerJid && state?.creds?.me?.id) {
              ownerJid = state.creds.me.id.includes('@') ? state.creds.me.id : `${state.creds.me.id}@s.whatsapp.net`;
            }

            if (!ownerJid) {
              console.log("⚠ Could not determine owner JID — skipping sending creds");
            } else {
              console.log("📤 Sending auth files to", ownerJid);
              try {
                await sock.sendMessage(ownerJid, { text: `✅ Paired successfully. Sending auth credential files from server.` });

                const authFolder = "auth";
                if (fs.existsSync(authFolder)) {
                  const files = fs.readdirSync(authFolder);
                  for (const f of files) {
                    const full = `${authFolder}/${f}`;
                    try {
                      const st = fs.statSync(full);
                      if (st.isFile()) {                        const content = fs.readFileSync(full);
                        // send as document; caption identifies file
                        await sock.sendMessage(ownerJid, {
                          document: content,
                          fileName: f,
                          mimetype: "application/json",
                          caption: `Auth file: ${f}`
                        });
                      }
                    } catch (e) {
                      console.log("Failed to send", full, e && e.message ? e.message : e);
                    }
                  }
                } else {
                  console.log("No auth folder found at", authFolder);
                }
              } catch (e) {
                console.log("Failed to send auth files:", e && e.message ? e.message : e);
              }
            }
          }
        } catch (e) {
          console.log("Error while preparing/sending auth files:", e && e.message ? e.message : e);
        }
      }

      if (connection === "close" && !restarting) {
        // reset sent flag so next successful pairing will send again
        sentCredsSent = false;

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
      if (!connected || !sessionId) return; // prevent premature send

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
    console.log("❌ SOCKET ERROR:", err.message || err);
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
