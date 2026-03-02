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
    getContentType,
    isJidBroadcast
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
        browser: Browsers.macOS('Desktop'),
        // --- CRITICAL SESSION FIXES ---
        syncFullHistory: false,
        markOnlineOnConnect: true,
        shouldIgnoreJid: jid => isJidBroadcast(jid),
        getMessage: async (key) => {
            return { conversation: 'ping' }; // Fallback to prevent SessionError crashes
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

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'open') {
            console.log('✅ BOT IS LIVE AND CONNECTED');
            // Force Sync Groups to establish sessions
            try {
                const groups = await sock.groupFetchAllParticipating();
                console.log(`👥 Synced with ${Object.keys(groups).length} groups.`);
            } catch (e) { console.log("Group Sync Error:", e.message); }
        } 
        else if (connection === 'close') {
            const shouldRestart = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldRestart) {
                console.log('🔄 Session Conflict/Error. Rebooting...');
                process.exit(1); 
            }
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;

        // --- OMNI-TEXT EXTRACTOR ---
        const type = getContentType(msg.message);
        const body = (type === 'conversation') ? msg.message.conversation : 
                     (type === 'extendedTextMessage') ? msg.message.extendedTextMessage.text : 
                     (type === 'imageMessage') ? msg.message.imageMessage.caption : 
                     (type === 'videoMessage') ? msg.message.videoMessage.caption : '';

        const remoteJid = msg.key.remoteJid;
        const isGroup = remoteJid.endsWith('@g.us');
        
        // Identify Sender (Multi-Device & Group Aware)
        const rawSender = isGroup ? msg.key.participant : remoteJid;
        const senderNumber = rawSender ? rawSender.split('@')[0].split(':')[0] : ''; 
        const isOwner = config.ownerNumbers.includes(senderNumber);

        // --- 1. AUTO-REACT (Global Listener) ---
        if (plugins.has('autoreact')) {
            try { await plugins.get('autoreact').execute(sock, msg, [], { isOwner, db, saveDB, plugins }); } catch (e) {}
        }

        // --- 2. COMMAND PROCESSING ---
        if (db.mode === 'private' && !isOwner) return; 
        if (!body.startsWith(config.prefix)) return;

        const args = body.slice(config.prefix.length).trim().split(/ +/);
        const commandName = args.shift().toLowerCase();

        if (plugins.has(commandName)) {
            try {
                console.log(`⚙️ [${commandName}] | From: ${senderNumber} | Group: ${isGroup}`);
                await plugins.get(commandName).execute(sock, msg, args, { isOwner, db, saveDB, plugins });
            } catch (error) { 
                console.error(`Error in ${commandName}:`, error); 
            }
        }
    });
}

// Render Health Check
app.get('/', (req, res) => res.send('Bot Online'));
app.listen(port, () => {
    startBot();
    if (config.renderUrl) setInterval(() => fetch(config.renderUrl).catch(() => {}), 600000);
});
    
