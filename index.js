const express = require('express');
const fs = require('fs');
const path = require('path');
const pino = require('pino');
const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, Browsers, DisconnectReason } = require('@whiskeysockets/baileys');

const config = require('./config');

const app = express();
const port = process.env.PORT || 3000; 

// --- DATABASE SETUP ---
const dbPath = path.join(__dirname, 'database.json');
let db = { mode: config.mode }; 

if (fs.existsSync(dbPath)) {
    db = JSON.parse(fs.readFileSync(dbPath));
}

const saveDB = () => fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));

// --- PLUGIN LOADER ---
const plugins = new Map();

function loadPlugins() {
    const pluginsPath = path.join(__dirname, 'plugins');
    if (!fs.existsSync(pluginsPath)) fs.mkdirSync(pluginsPath);

    const files = fs.readdirSync(pluginsPath).filter(file => file.endsWith('.js'));
    for (const file of files) {
        delete require.cache[require.resolve(path.join(pluginsPath, file))]; 
        const plugin = require(path.join(pluginsPath, file));
        if (plugin.name && plugin.execute) {
            plugins.set(plugin.name, plugin);
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
                console.log('🔄 Reconnecting in 3 seconds...');
                setTimeout(startBot, 3000);
            } else {
                console.log('🛑 Logged out. You need a new auth.tar.gz.');
            }
        }
    });

    // --- COMMAND HANDLER ---
    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
        const remoteJid = msg.key.remoteJid;
        
        // --- MULTI-DEVICE FIX: Strips away the hidden :15 device IDs! ---
        const rawSender = msg.key.participant || remoteJid;
        const senderNumber = rawSender.split('@')[0].split(':')[0]; 

        const isOwner = config.ownerNumbers.includes(senderNumber);

        // Check Mode from DATABASE
        if (db.mode === 'private' && !isOwner) return; 

        // Check if message starts with your prefix
        if (!text.startsWith(config.prefix)) return;

        const args = text.slice(config.prefix.length).trim().split(/ +/);
        const commandName = args.shift().toLowerCase();

        if (plugins.has(commandName)) {
            try {
                console.log(`⚙️ Executing [${commandName}] by ${senderNumber}`);
                const plugin = plugins.get(commandName);
                await plugin.execute(sock, msg, args, { isOwner, db, saveDB, plugins });
            } catch (error) {
                console.error(`❌ Error in ${commandName}:`, error);
            }
        }
    });
}

// --- RENDER ANTI-SLEEP ---
function keepAlive() {
    if (config.renderUrl) {
        setInterval(() => fetch(config.renderUrl).catch(() => {}), 10 * 60 * 1000); 
    }
}

app.get('/', (req, res) => res.send('WhatsApp Bot Engine is Running!'));
app.listen(port, () => {
    startBot();
    keepAlive();
});
