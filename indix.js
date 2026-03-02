const express = require('express');
const fs = require('fs');
const path = require('path');
const tar = require('tar');
const pino = require('pino');
const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, Browsers, DisconnectReason } = require('@whiskeysockets/baileys');

const config = require('./config');

const app = express();
const port = process.env.PORT || 3000; 

// --- 1. PLUGIN LOADER ---
const plugins = new Map();

function loadPlugins() {
    const pluginsPath = path.join(__dirname, 'plugins');
    if (!fs.existsSync(pluginsPath)) fs.mkdirSync(pluginsPath);

    const files = fs.readdirSync(pluginsPath).filter(file => file.endsWith('.js'));
    for (const file of files) {
        const plugin = require(path.join(pluginsPath, file));
        if (plugin.name && plugin.execute) {
            plugins.set(plugin.name, plugin);
            console.log(`🔌 Loaded plugin: ${plugin.name}`);
        }
    }
}

// --- 2. AUTO EXTRACTOR ---
async function extractSession() {
    const archiveName = './auth.tar.gz'; 
    const targetDir = './auth'; 

    if (!fs.existsSync(targetDir) && fs.existsSync(archiveName)) {
        console.log('📦 Found auth.tar.gz! Extracting session files...');
        try {
            await tar.x({ file: archiveName });
            console.log('✅ Extraction complete!');
        } catch (err) {
            console.error('❌ Failed to extract auth.tar.gz:', err);
        }
    }
}

// --- 3. MAIN BOT ENGINE ---
async function startBot() {
    await extractSession();
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
                console.log('🔄 Connection dropped. Reconnecting in 3 seconds...');
                setTimeout(startBot, 3000);
            } else {
                console.log('🛑 Logged out. You need a new auth.tar.gz.');
            }
        }
    });

    // --- 4. COMMAND HANDLER ---
    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
        const remoteJid = msg.key.remoteJid;
        const sender = msg.key.participant || remoteJid; // Group sender vs Private sender
        const senderNumber = sender.split('@')[0];

        // Is the sender an owner?
        const isOwner = config.ownerNumbers.includes(senderNumber);

        // Check Mode (Public vs Private)
        if (config.mode === 'private' && !isOwner) {
            return; // Ignore everyone except the owner
        }

        // Check if message starts with the prefix
        if (!text.startsWith(config.prefix)) return;

        // Parse the command and arguments (e.g., "!ban user" -> command: "ban", args: ["user"])
        const args = text.slice(config.prefix.length).trim().split(/ +/);
        const commandName = args.shift().toLowerCase();

        // Check if plugin exists
        if (plugins.has(commandName)) {
            try {
                console.log(`⚙️ Executing command [${commandName}] by ${senderNumber}`);
                const plugin = plugins.get(commandName);
                await plugin.execute(sock, msg, args);
            } catch (error) {
                console.error(`❌ Error executing ${commandName}:`, error);
                await sock.sendMessage(remoteJid, { text: '⚠️ An error occurred while running that command.' });
            }
        }
    });
}

// --- 5. RENDER ANTI-SLEEP ---
// Render free tier sleeps after 15 minutes of inactivity. 
// This pings your own server every 10 minutes to keep it awake.
function keepAlive() {
    if (config.renderUrl) {
        setInterval(async () => {
            try {
                await fetch(config.renderUrl);
                console.log('💓 Self-ping sent to keep Render awake.');
            } catch (err) {
                console.log('⚠️ Self-ping failed (normal during restarts).');
            }
        }, 10 * 60 * 1000); // 10 minutes
    }
}

app.get('/', (req, res) => {
    res.send('WhatsApp Bot Engine is Running!');
});

app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
    startBot();
    keepAlive();
});
                         
