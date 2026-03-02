const express = require('express');
const fs = require('fs');
const path = require('path');
const pino = require('pino');

const {
default: makeWASocket,
useMultiFileAuthState,
fetchLatestBaileysVersion,
DisconnectReason,
Browsers,
getContentType,
isJidBroadcast
} = require('@whiskeysockets/baileys');

const config = require('./config');

const app = express();
const port = process.env.PORT || 3000;


/* ================= DATABASE ================= */

const dbPath = path.join(__dirname, 'database.json');

let db = { mode: config.mode, autoReactGroups: [] };

if (fs.existsSync(dbPath)) {
try {
db = JSON.parse(fs.readFileSync(dbPath));
} catch {
console.log("Database corrupted, resetting...");
}
}

const saveDB = () => {
fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
};


/* ================= PLUGIN LOADER ================= */

const plugins = new Map();

function loadPlugins() {

plugins.clear();

const pluginsDir = path.join(__dirname, 'plugins');

if (!fs.existsSync(pluginsDir)) fs.mkdirSync(pluginsDir);

const files = fs.readdirSync(pluginsDir).filter(f => f.endsWith(".js"));

for (const file of files) {

try {

const pluginPath = path.join(pluginsDir, file);

delete require.cache[require.resolve(pluginPath)];

const plugin = require(pluginPath);

if (plugin.name && plugin.execute) {
plugins.set(plugin.name, plugin);
console.log(`🔌 Loaded plugin: ${plugin.name}`);
}

} catch (e) {
console.log(`Plugin error (${file}):`, e.message);
}

}

console.log(`⚡ ${plugins.size} plugins loaded`);
}


/* ================= BOT ================= */

async function startBot() {

loadPlugins();

const { state, saveCreds } = await useMultiFileAuthState('./auth');

const { version } = await fetchLatestBaileysVersion();

const sock = makeWASocket({

version,
logger: pino({ level: "silent" }),
browser: Browsers.macOS("Desktop"),

printQRInTerminal: true,

auth: state,

markOnlineOnConnect: true,

syncFullHistory: false,

shouldIgnoreJid: jid => isJidBroadcast(jid),

getMessage: async () => ({
conversation: "hello"
})

});


/* ================= SAVE CREDS ================= */

sock.ev.on("creds.update", saveCreds);


/* ================= CONNECTION ================= */

sock.ev.on("connection.update", async ({ connection, lastDisconnect }) => {

if (connection === "open") {

console.log("✅ BOT CONNECTED");

try {

const groups = await sock.groupFetchAllParticipating();

console.log(`👥 Synced ${Object.keys(groups).length} groups`);

} catch {}

}

if (connection === "close") {

const shouldReconnect =
lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;

if (shouldReconnect) {

console.log("⚠️ Reconnecting...");

startBot();

} else {

console.log("❌ Logged out");

}

}

});


/* ================= MESSAGE HANDLER ================= */

sock.ev.on("messages.upsert", async ({ messages, type }) => {

if (type !== "notify") return;

const msg = messages[0];

if (!msg.message || msg.key.fromMe) return;


/* ---------- unwrap ephemeral ---------- */

let message = msg.message;

if (message?.ephemeralMessage) {
message = message.ephemeralMessage.message;
}


/* ---------- message type ---------- */

const mtype = getContentType(message);


/* ---------- extract text ---------- */

const body =
mtype === "conversation" ? message.conversation :
mtype === "extendedTextMessage" ? message.extendedTextMessage.text :
mtype === "imageMessage" ? message.imageMessage.caption :
mtype === "videoMessage" ? message.videoMessage.caption :
"";


if (!body) return;


/* ---------- chat info ---------- */

const remoteJid = msg.key.remoteJid;

const isGroup = remoteJid.endsWith("@g.us");

const rawSender = isGroup
? (msg.key.participant || msg.participant)
: remoteJid;

const sender = rawSender ? rawSender.split("@")[0].split(":")[0] : "";

const isOwner = config.ownerNumbers.includes(sender);


/* ---------- auto react ---------- */

if (plugins.has("autoreact")) {
try {
await plugins.get("autoreact").execute(sock, msg, [], { isOwner, db, saveDB, plugins });
} catch {}
}


/* ---------- private mode ---------- */

if (db.mode === "private" && !isOwner) return;


/* ---------- command ---------- */

if (!body.startsWith(config.prefix)) return;

const args = body.slice(config.prefix.length).trim().split(/ +/);

const command = args.shift().toLowerCase();


/* ---------- run plugin ---------- */

if (plugins.has(command)) {

try {

console.log(`⚙️ ${command} | ${sender} | ${isGroup ? "GROUP" : "PRIVATE"}`);

await plugins.get(command).execute(sock, msg, args, {
isOwner,
db,
saveDB,
plugins
});

} catch (e) {

console.log(`Plugin error (${command}):`, e.message);

}

}

});


}


/* ================= WEB SERVER ================= */

app.get("/", (req, res) => {
res.send("Bot Online");
});

app.listen(port, () => {

console.log("🌐 Server running");

startBot();

});
