const express = require('express');
const fs = require('fs');
const tar = require('tar');
const pino = require('pino');
const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, Browsers } = require('@whiskeysockets/baileys');

const app = express();
const port = process.env.PORT || 3000; 

// --- AUTO EXTRACTOR ---
async function extractSession() {
    const archiveName = './auth.tar.gz'; // The file you upload to GitHub
    const targetDir = './auth_info_baileys'; // Where Baileys looks for credentials

    // If the auth folder doesn't exist yet, but the archive does, extract it
    if (!fs.existsSync(targetDir) && fs.existsSync(archiveName)) {
        console.log('📦 Found auth.tar.gz! Extracting session files...');
        try {
            // Extracts the tar.gz into the current directory
            await tar.x({ file: archiveName });
            console.log('✅ Extraction complete! Session is ready.');
        } catch (err) {
            console.error('❌ Failed to extract auth.tar.gz:', err);
        }
    }
}

// --- MAIN BOT LOGIC ---
async function startBot() {
    // 1. Run the extractor first
    await extractSession();

    console.log('⏳ Starting Baileys...');
    
    // 2. Load the credentials from the newly extracted folder
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        auth: state,
        browser: Browsers.macOS('Desktop')
    });

    sock.ev.on('creds.update', saveCreds);

    // 3. Monitor the connection
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'open') {
            console.log('✅ SUCCESS! WhatsApp is fully connected on Render!');
        } else if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            console.log(`❌ Connection closed. Status Code: ${statusCode}`);
        }
    });

    // 4. Basic Message Listener (To prove it works!)
    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;

        // Get the text from the message
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text;
        const remoteJid = msg.key.remoteJid;

        // Reply to a specific command
        if (text === '!ping') {
            console.log(`Received !ping from ${remoteJid}`);
            await sock.sendMessage(remoteJid, { text: 'Pong! The bot is officially alive on Render. 🚀' });
        }
    });
}

// Keep Render happy
app.get('/', (req, res) => {
    res.send('WhatsApp Bot is running!');
});

app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
    startBot();
});
