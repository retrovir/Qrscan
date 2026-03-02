const express = require('express');
const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const archiver = require('archiver');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
const port = process.env.PORT || 3000;

// Environment Variables required in Render
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN; // From BotFather
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID; // Your Telegram User ID
const PHONE_NUMBER = process.env.PHONE_NUMBER; // e.g., '919876543210' (No '+' or spaces)

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: false });

// Function to zip the auth folder and send it via Telegram
async function sendAuthZipToTelegram() {
    return new Promise((resolve, reject) => {
        const outputFilePath = __dirname + '/auth_session.zip';
        const output = fs.createWriteStream(outputFilePath);
        const archive = archiver('zip', {
            zlib: { level: 9 } // Maximum compression
        });

        output.on('close', async () => {
            console.log(`Zip created: ${archive.pointer()} total bytes`);
            try {
                // Send the zipped file to Telegram
                await bot.sendDocument(TELEGRAM_CHAT_ID, outputFilePath, {
                    caption: '✅ WhatsApp Authentication Successful!\n\nHere is your zipped auth folder. Extract it and upload the contents to your private GitHub repository.'
                });
                console.log('Zip file sent to Telegram successfully.');
                resolve();
            } catch (error) {
                console.error('Failed to send zip to Telegram:', error);
                reject(error);
            }
        });

        archive.on('error', (err) => {
            reject(err);
        });

        archive.pipe(output);
        // Zip the entire auth_info_baileys directory
        archive.directory('auth_info_baileys/', false);
        archive.finalize();
    });
}

// WhatsApp Auth Logic
async function startWhatsAppAuth() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false, // Using Pair Code instead
        auth: state,
        browser: ['Ubuntu', 'Chrome', '20.0.04'] 
    });

    // Request Pairing Code if not registered
    if (!sock.authState.creds.registered) {
        setTimeout(async () => {
            try {
                const code = await sock.requestPairingCode(PHONE_NUMBER);
                const formattedCode = code?.match(/.{1,4}/g)?.join('-') || code;
                console.log(`Pairing code: ${formattedCode}`);
                
                await bot.sendMessage(TELEGRAM_CHAT_ID, `📱 Your WhatsApp Pairing Code is:\n\n*${formattedCode}*\n\nEnter this in your WhatsApp linked devices.`, { parse_mode: 'Markdown' });
            } catch (err) {
                console.error('Failed to request pairing code:', err);
                await bot.sendMessage(TELEGRAM_CHAT_ID, `❌ Error requesting pairing code: ${err.message}`);
            }
        }, 3000);
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection } = update;
        
        if (connection === 'open') {
            console.log('WhatsApp connected successfully!');
            await bot.sendMessage(TELEGRAM_CHAT_ID, '🔄 Connection established. Generating zip file... Please wait.');
            
            // Wait 5 seconds to ensure all credential files are fully written to the local disk before zipping
            setTimeout(() => {
                sendAuthZipToTelegram();
            }, 5000);
        }
    });
}

// Express Server to keep Render alive
app.get('/', (req, res) => {
    res.send('WhatsApp Auth Server is running.');
});

app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
    startWhatsAppAuth();
});
