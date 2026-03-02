const express = require('express');
const fs = require('fs');
const path = require('path');
const pino = require('pino');
const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    fetchLatestBaileysVersion, 
    Browsers, 
    DisconnectReason 
} = require('@whiskeysockets/baileys');

const config = require('./config');

const app = express();
const port = process.env.PORT || 3000; 

// --- DATABASE SETUP ---
const dbPath = path.join(__dirname, 'database.json');
let db = { mode: config.mode, autoReactGroups: [] }; 

if (fs.existsSync(dbPath)) {
    try {
        db = JSON.parse(fs.readFileSync(dbPath));
    } catch (e) {
        console.log("⚠️ Database file corrupted, resetting...");
    }
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
            if (plugin.name && plugin.execute) {
                plugins.set(plugin.name, plugin);
            }
        } catch (e) {
            console.error(`❌ Failed to load plugin ${file}:`, e);
        }
    }
    console.log(`🔌 Loaded ${plugins.size} plugins.`);
}

// --- MAIN BOT ENGINE ---
async function startBot() {
    loadPlugins();
    console.log('⏳ Starting Baileys Engine...');
    
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
        if (connection === 'open') {
            console.log('✅ SUCCESS! Bot is online and ready.');
        } else if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            if (statusCode !== DisconnectReason.loggedOut) {
                console.log(`🔄 Connection closed (${statusCode}). Restarting...`);
                process.exit(1); 
            } else {
                console.log('🛑 Logged out. Please generate a new session.');
            }
        }
    });

    // --- MESSAGE HANDLER ---
    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;

        // 1. ROBUST TEXT EXTRACTION
        const text = msg.message.conversation || 
                     msg.message.extendedTextMessage?.text || 
                     msg.message.imageMessage?.caption || 
                     msg.message.videoMessage?.caption || '';
        
        const remoteJid = msg.key.remoteJid;
        const isGroup = remoteJid.endsWith('@g.us');

        // 2. SENDER IDENTIFICATION (Fixes Multi-Device & Group IDs)
        const rawSender = isGroup ? msg.key.participant : remoteJid;
        const senderNumber = rawSender ? rawSender.split('@')[0].split(':')[0] : ''; 

        const isOwner = config.ownerNumbers.includes(senderNumber);

        // --- 3. AUTO-REACT HANDLER (Runs on EVERY message) ---
        if (plugins.has('autoreact')) {
            try {
                // Pass an empty args array for the auto-trigger
                await plugins.get('autoreact').execute(sock, msg, [], { isOwner, db, saveDB, plugins });
            } catch (e) { 
                console.error("AutoReact Error:", e); 
            }
        }

        // --- 4. COMMAND LOGIC ---
        // Block non-owners if in Private Mode
        if (db.mode === 'private' && !isOwner) return; 

        // Check for prefix
        if (!text.startsWith(config.prefix)) return;

        const args = text.slice(config.prefix.length).trim().split(/ +/);
        const commandName = args.shift().toLowerCase();

        if (plugins.has(commandName)) {
            try {
                console.log(`⚙️ Executing [${commandName}] by ${senderNumber} in ${isGroup ? 'Group' : 'Private'}`);
                const plugin = plugins.get(commandName);
                await plugin.execute(sock, msg, args, { isOwner, db, saveDB, plugins });
            } catch (error) {
                console.error(`❌ Error executing ${commandName}:`, error);
            }
        }
    });
}

// Render Health Check
app.get('/', (req, res) => res.send('Bot is Live!'));
app.listen(port, () => {
    startBot();
    if (config.renderUrl) {
        setInterval(() => fetch(config.renderUrl).catch(() => {}), 10 * 60 * 1000);
    }
});
