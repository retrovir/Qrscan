const express = require('express');
const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, Browsers } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const archiver = require('archiver');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
const port = process.env.PORT || 3000;

// Environment Variables required in Render
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
let isAuthStarted = false; 

// Function to zip the auth folder and send it via Telegram
async function sendAuthZipToTelegram(chatId) {
    return new Promise((resolve, reject) => {
        const outputFilePath = __dirname + '/auth_session.zip';
        const output = fs.createWriteStream(outputFilePath);
        const archive = archiver('zip', { zlib: { level: 9 } });

        output.on('close', async () => {
            console.log(`Zip created: ${archive.pointer()} total bytes`);
            try {
                await bot.sendDocument(chatId, outputFilePath, {
                    caption: '✅ WhatsApp Authentication Successful!\n\nExtract this zip and upload the contents to your private repository.'
                });
                isAuthStarted = false; 
                resolve();
            } catch (error) {
                console.error('Failed to send zip:', error);
                reject(error);
            }
        });

        archive.on('error', (err) => reject(err));
        archive.pipe(output);
        archive.directory('auth_info_baileys/', false);
        archive.finalize();
    });
}

// WhatsApp Auth Logic
async function startWhatsAppAuth(phoneNumber, chatId) {
    // Aggressively clean up old corrupted sessions
    if (fs.existsSync('./auth_info_baileys')) {
        fs.rmSync('./auth_info_baileys', { recursive: true, force: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }), // Keep it silent to avoid Render log spam
        printQRInTerminal: false,
        auth: state,
        // Using the official Browsers utility makes the connection look legitimate
        browser: Browsers.macOS('Desktop') 
    });

    if (!sock.authState.creds.registered) {
        // Increased delay to 6 seconds to allow Render's network to fully connect to WhatsApp's WS
        setTimeout(async () => {
            try {
                console.log('Requesting pairing code now...');
                const code = await sock.requestPairingCode(phoneNumber);
                const formattedCode = code?.match(/.{1,4}/g)?.join('-') || code;
                
                await bot.sendMessage(chatId, `📱 **Pairing Code Generated!**\n\nCode: \`${formattedCode}\`\n\nCheck your WhatsApp! You should have received a push notification to link a device. Enter the code above.`, { parse_mode: 'Markdown' });
            } catch (err) {
                console.error('Failed to request pairing code:', err);
                await bot.sendMessage(chatId, `❌ Error requesting pairing code: ${err.message}\n\nThe connection was likely rejected. Send /reset and try again.`);
                isAuthStarted = false; // Release the lock on failure
            }
        }, 6000); 
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== 401;
            console.log('Connection closed. Reconnecting:', shouldReconnect);
            
            if (!shouldReconnect) {
                await bot.sendMessage(chatId, '❌ Authentication failed or device unlinked. Send /reset and try sending your number again.');
                isAuthStarted = false;
                if (fs.existsSync('./auth_info_baileys')) {
                    fs.rmSync('./auth_info_baileys', { recursive: true, force: true });
                }
            }
        } else if (connection === 'open') {
            console.log('WhatsApp connected successfully!');
            await bot.sendMessage(chatId, '🔄 Connection established! Generating zip file... Please wait 5 seconds.');
            
            setTimeout(() => {
                sendAuthZipToTelegram(chatId);
            }, 5000);
        }
    });
}

// --- Telegram Bot Listeners ---

bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, '👋 Welcome to the WhatsApp Auth Bot!\n\nPlease reply with your WhatsApp number (e.g., 919876543210) to generate a pairing code.\n\nIf you get stuck, send /reset.');
});

// Emergency reset command to release the lock
bot.onText(/\/reset/, (msg) => {
    isAuthStarted = false;
    if (fs.existsSync('./auth_info_baileys')) {
        fs.rmSync('./auth_info_baileys', { recursive: true, force: true });
    }
    bot.sendMessage(msg.chat.id, '🔄 System reset. The lock has been cleared and old folders deleted. Send your number to try again.');
});

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text ? msg.text.trim() : '';

    if (text.startsWith('/')) return;

    if (/^\d{10,15}$/.test(text)) {
        if (isAuthStarted) {
            return bot.sendMessage(chatId, '⏳ Authentication is already in progress. Wait a moment, or send /reset to cancel it.');
        }

        isAuthStarted = true;
        await bot.sendMessage(chatId, `⏳ Initializing Baileys for \`${text}\`...\nWaiting for connection to stabilize before requesting code...`, { parse_mode: 'Markdown' });
        
        startWhatsAppAuth(text, chatId);
    } else {
        bot.sendMessage(chatId, '⚠️ Invalid format. Please send ONLY digits, including the country code (e.g., 919876543210).');
    }
});

app.get('/', (req, res) => {
    res.send('WhatsApp Auth Server is running and waiting for Telegram commands.');
});

app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
});
