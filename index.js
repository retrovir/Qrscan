import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers,
  getContentType,
  isJidBroadcast
} from "@whiskeysockets/baileys";

import pino from "pino";
import fs from "fs";
import path from "path";
import express from "express";
import { fileURLToPath } from "url";

/* ================= FIX __dirname ================= */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* ================= CONFIG ================= */

const PORT = process.env.PORT || 9090;
const PLUGIN_DIR = path.join(__dirname, "plugins");

// Add your owner numbers here (replace with your actual number)
const ownerNumbers = ['1234567890']; 
const prefix = '.'; 

/* ================= SERVER ================= */

const app = express();
app.get("/", (_, res) => res.send("WhatsApp Bot Running"));
app.listen(PORT, () => console.log(`🌐 Server on ${PORT}`));

/* ================= PLUGINS ================= */

const plugins = new Map();

async function loadPlugins() {
  plugins.clear();

  if (!fs.existsSync(PLUGIN_DIR)) {
    fs.mkdirSync(PLUGIN_DIR);
    console.log("📁 plugins folder created");
  }

  const files = fs.readdirSync(PLUGIN_DIR).filter(f => f.endsWith(".js"));

  for (const file of files) {
    try {
      const pluginPath = path.join(PLUGIN_DIR, file);

      const mod = await import(pluginPath + `?v=${Date.now()}`);
      const plugin = mod.default || mod; // Fallback in case they export differently

      if (plugin.name && plugin.execute) {
          plugins.set(plugin.name, plugin);
          console.log(`🔌 Loaded plugin: ${file} [${plugin.name}]`);
      } else {
          console.log(`⚠️ Skipped ${file} (missing name or execute)`);
      }

    } catch (e) {
      console.log(`❌ Failed to load ${file}:`, e.message);
    }
  }
}

/* ================= BOT ================= */

async function startBot() {
  await loadPlugins();
  console.log("🚀 Starting WhatsApp bot...");

  const { state, saveCreds } = await useMultiFileAuthState("auth");
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    logger: pino({ level: "silent" }),
    auth: state,
    browser: Browsers.macOS("Desktop"),
    printQRInTerminal: false,
    version,
    // --- STABILITY FIXES ---
    markOnlineOnConnect: true,
    shouldIgnoreJid: jid => isJidBroadcast(jid),
    getMessage: async (key) => {
        return { conversation: 'ping' }; 
    },
    patchMessageBeforeSending: (message) => {
        const requiresPatch = !!(
            message.buttonsMessage ||
            message.templateMessage ||
            message.listMessage
        );
        if (requiresPatch) {
            return {
                viewOnceMessage: {
                    message: {
                        messageContextInfo: {
                            deviceListMetadata: {},
                            deviceListMetadataVersion: 2
                        },
                        ...message
                    }
                }
            };
        }
        return message;
    }
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async ({ connection, lastDisconnect }) => {
    if (connection === "open") {
      console.log("✅ WhatsApp Connected");
      try {
          const groups = await sock.groupFetchAllParticipating();
          console.log(`👥 Synced with ${Object.keys(groups).length} groups.`);
      } catch (e) { console.log("Group Sync:", e.message); }
    }

    if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code !== DisconnectReason.loggedOut) {
        console.log(`♻️ Reconnecting (Code: ${code})...`);
        setTimeout(startBot, 3000);
      } else {
        console.log("🚫 Logged out. Delete auth folder to re-pair.");
      }
    }
  });

  sock.ev.on("messages.upsert", async ({ messages }) => {
    const msg = messages[0];
    if (!msg?.message || msg.key.fromMe) return;

    // --- TEXT EXTRACTION ---
    let msgContent = msg.message;
    if (msgContent.ephemeralMessage) msgContent = msgContent.ephemeralMessage.message;
    if (msgContent.viewOnceMessage) msgContent = msgContent.viewOnceMessage.message;
    if (msgContent.viewOnceMessageV2) msgContent = msgContent.viewOnceMessageV2.message;

    const type = getContentType(msgContent);
    const body = (type === 'conversation') ? msgContent.conversation : 
                 (type === 'extendedTextMessage') ? msgContent.extendedTextMessage?.text : 
                 (type === 'imageMessage') ? msgContent.imageMessage?.caption : 
                 (type === 'videoMessage') ? msgContent.videoMessage?.caption : '';

    const text = body?.trim();
    if (!text) return;

    const remoteJid = msg.key.remoteJid;
    const isGroup = remoteJid.endsWith("@g.us");
    
    // Proper sender extraction
    const rawSender = isGroup ? msg.key.participant : remoteJid;
    const senderNumber = rawSender ? rawSender.split('@')[0].split(':')[0] : '';
    const isOwner = ownerNumbers.includes(senderNumber);

    console.log(`📩 [${isGroup ? 'GRP' : 'PVT'}] ${senderNumber} => ${text}`);

    if (!text.startsWith(prefix)) return;

    const args = text.slice(prefix.length).trim().split(/ +/);
    const commandName = args.shift().toLowerCase();

    if (plugins.has(commandName)) {
        try {
            await plugins.get(commandName).execute(sock, msg, args, { isOwner, isGroup });
        } catch (error) {
            if (String(error).includes('No sessions') && isGroup) {
                console.log(`🔧 [AUTO-HEAL] Syncing keys...`);
                try {
                    const metadata = await sock.groupMetadata(remoteJid);
                    for (let p of metadata.participants) {
                        await sock.presenceSubscribe(p.id); 
                    }
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    console.log(`🔁 [AUTO-HEAL] Retrying...`);
                    await plugins.get(commandName).execute(sock, msg, args, { isOwner, isGroup });
                } catch (retryError) {
                    console.error(`❌ Auto-Heal failed:`, retryError.message);
                }
            } else {
                console.error(`❌ Plugin error:`, error.message);
            }
        }
    }
  });
}

/* ================= START ================= */

startBot();
      
