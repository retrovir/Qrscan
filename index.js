const express = require('express');
const fs = require('fs');
const tar = require('tar');
const pino = require('pino');
const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, Browsers } = require('@whiskeysockets/baileys');

const app = express();
const port = process.env.PORT || 3000; 

// --- AUTO EXTRACTOR ---
async function extractSession() {
    const archiveName = './auth.tar.gz'; 
    const targetDir = './auth'; // <-- FIXED: Pointing to the correct 'auth' folder

    if (!fs.existsSync(targetDir) && fs.existsSync(archiveName)) {
        console.log('📦 Found auth.tar.gz! Extracting session files...');
        try {
            await tar.x({ file: archiveName });
            console.log('✅ Extraction complete! Session is ready.');
        } catch (err) {
            console.error('❌ Failed to extract auth.tar.gz:', err);
        }
    }
}

// --- MAIN BOT LOGIC ---
async function startBot() {
    await extractSession();

    console.log('⏳ Starting Baileys...');
    
    // <-- FIXED: Pointing Baileys to the correct 'auth' folder
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
            console.log('✅ SUCCESS! WhatsApp is fully connected on Render!');
        } else if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            console.log(`❌ Connection closed. Status Code: ${statusCode}`);
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const text = msg.message.conversation || msg.message.extendedTextMessage?.text;
        const remoteJid = msg.key.remoteJid;

        if (text === '!ping') {
            console.log(`Received !ping from ${remoteJid}`);
            await sock.sendMessage(remoteJid, { text: 'Pong! The bot is officially alive on Render. 🚀' });
        }
    });
}

app.get('/', (req, res) => {
    res.send('WhatsApp Bot is running!');
});

app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
    startBot();
});
                                
