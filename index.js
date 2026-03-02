const express = require('express');
const fs = require('fs');
const path = require('path');
const pino = require('pino');
const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    fetchLatestBaileysVersion, 
    Browsers, 
    DisconnectReason,
    getContentType
} = require('@whiskeysockets/baileys');

const config = require('./config');

const app = express();
const port = process.env.PORT || 3000; 

// --- DATABASE SETUP ---
const dbPath = path.join(__dirname, 'database.json');
let db = { mode: config.mode, autoReactGroups: [] }; 
if (fs.existsSync(dbPath)) {
    try { db = JSON.parse(fs.readFileSync(dbPath)); } catch (e) { console.log("DB Reset"); }
}
const saveDB = () => fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));

// --- PLUGIN LOADER ---
const plugins = new Map();
function loadPlugins() {
    const pluginsPath = path.join(__dirname, 'plugins');
    if (!fs.existsSync(pluginsPath)) fs.mkdirSync(pluginsPath);
    const files = fs.readdirSync(pluginsPath).filter(file => file.endsWith('.js'));
    for (const file of files) {
        try {
            const pluginPath = path.join(pluginsPath, file);
            delete require.cache[require.resolve(pluginPath)]; 
            const plugin = require(pluginPath);
            if (plugin.name && plugin.execute) plugins.set(plugin.name, plugin);
        } catch (e) { console.error(`Plugin Load Error ${file}:`, e); }
    }
    console.log(`🔌 Online with ${plugins.size} plugins.`);
}

// --- MAIN BOT ENGINE ---
async function startBot() {
    loadPlugins();
    const { state, saveCreds } = await useMultiFileAuthState('auth');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        auth: state,
        browser: Browsers.macOS('Desktop')
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'open') console.log('✅ BOT IS LIVE IN ALL CHATS');
        else if (connection === 'close') {
            if (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut) {
                process.exit(1); 
            }
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;

        // --- THE ULTIMATE TEXT EXTRACTOR ---
        const type = getContentType(msg.message);
        const body = (type === 'conversation') ? msg.message.conversation : 
                     (type === 'extendedTextMessage') ? msg.message.extendedTextMessage.text : 
                     (type === 'imageMessage') ? msg.message.imageMessage.caption : 
                     (type === 'videoMessage') ? msg.message.videoMessage.caption : 
                     (msg.message.buttonsResponseMessage) ? msg.message.buttonsResponseMessage.selectedButtonId : 
                     (msg.message.listResponseMessage) ? msg.message.listResponseMessage.singleSelectReply.selectedRowId : 
                     (msg.message.templateButtonReplyMessage) ? msg.message.templateButtonReplyMessage.selectedId : '';

        const remoteJid = msg.key.remoteJid;
        const isGroup = remoteJid.endsWith('@g.us');
        
        // Identify Sender (Properly handles Group Participants)
        const rawSender = isGroup ? msg.key.participant : remoteJid;
        const senderNumber = rawSender ? rawSender.split('@')[0].split(':')[0] : ''; 
        const isOwner = config.ownerNumbers.includes(senderNumber);

        // --- GROUP DEBUG LOGGING ---
        if (isGroup) {
            console.log(`📢 Group Msg: [${body}] from ${senderNumber}`);
        }

        // 1. AUTO-REACT (Runs if enabled for this group)
        if (plugins.has('autoreact')) {
            try { await plugins.get('autoreact').execute(sock, msg, [], { isOwner, db, saveDB, plugins }); } catch (e) {}
        }

        // 2. PRIVACY & PREFIX CHECK
        if (db.mode === 'private' && !isOwner) return; 
        if (!body.startsWith(config.prefix)) return;

        // 3. EXECUTE COMMAND
        const args = body.slice(config.prefix.length).trim().split(/ +/);
        const commandName = args.shift().toLowerCase();

        if (plugins.has(commandName)) {
            try {
                console.log(`⚙️ Executing .${commandName} in ${isGroup ? 'Group' : 'Private'}`);
                await plugins.get(commandName).execute(sock, msg, args, { isOwner, db, saveDB, plugins });
            } catch (error) { console.error(error); }
        }
    });
}

app.get('/', (req, res) => res.send('Bot Active'));
app.listen(port, () => {
    startBot();
    if (config.renderUrl) setInterval(() => fetch(config.renderUrl).catch(() => {}), 600000);
});
                
