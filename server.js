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

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true }); // Changed to true so it listens for messages
let isAuthStarted = false; // Prevents running multiple connections at once

// Function to zip the auth folder and send it via Telegram
async function sendAuthZipToTelegram(chatId) {
    return new Promise((resolve, reject) => {
        const outputFilePath = __dirname + '/auth_session.zip';
        const output = fs.createWriteStream(outputFilePath);
        const archive = archiver('zip', {
            zlib: { level: 9 }
        });

        output.on('close', async () => {
            console.log(`Zip created: ${archive.pointer()} total bytes`);
            try {
                await bot.sendDocument(chatId, outputFilePath, {
                    caption: '✅ WhatsApp Authentication Successful!\n\nHere is your zipped auth folder. Extract it and upload the contents to your private repository.'
                });
                console.log('Zip file sent to Telegram successfully.');
                
                // Reset the flag so you can do it again if needed without restarting the server
                isAuthStarted = false; 
                resolve();
            } catch (error) {
                console.error('Failed to send zip to Telegram:', error);
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
    // Clean up old session if trying again
    if (fs.existsSync('./auth_info_baileys')) {
        fs.rmSync('./auth_info_baileys', { recursive: true, force: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        auth: state,
        browser: ['Ubuntu', 'Chrome', '20.0.04'] // Identifies as Chrome on Ubuntu to WhatsApp
    });

    // Request Pairing Code
    if (!sock.authState.creds.registered) {
        // Wait a few seconds for the websocket to establish before asking for the code
        setTimeout(async () => {
            try {
                const code = await sock.requestPairingCode(phoneNumber);
                const formattedCode = code?.match(/.{1,4}/g)?.join('-') || code;
                console.log(`Pairing code: ${formattedCode}`);
                
                await bot.sendMessage(chatId, `📱 **Pairing Code Generated!**\n\nCode: \`${formattedCode}\`\n\nCheck your WhatsApp! You should have received a push notification to link a device. Enter the code above.`, { parse_mode: 'Markdown' });
            } catch (err) {
                console.error('Failed to request pairing code:', err);
                await bot.sendMessage(chatId, `❌ Error requesting pairing code: ${err.message}\n\nPlease try restarting the Render server.`);
                isAuthStarted = false;
            }
        }, 3000);
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== 401;
            console.log('Connection closed. Reconnecting:', shouldReconnect);
            if (!shouldReconnect) {
                await bot.sendMessage(chatId, '❌ Authentication failed or device unlinked. Please send your number to try again.');
                isAuthStarted = false;
            }
        } else if (connection === 'open') {
            console.log('WhatsApp connected successfully!');
            await bot.sendMessage(chatId, '🔄 Connection established! Generating zip file... Please wait 5 seconds.');
            
            // Wait 5 seconds to ensure all credential files are fully written
            setTimeout(() => {
                sendAuthZipToTelegram(chatId);
            }, 5000);
        }
    });
}

// --- Telegram Bot Listeners ---

// Listen for /start command
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, '👋 Welcome to the WhatsApp Auth Bot!\n\nPlease reply with your WhatsApp number (including country code, but NO "+" or spaces. e.g., 919876543210) to generate a pairing code.');
});

// Listen for the phone number
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text ? msg.text.trim() : '';

    // Ignore commands like /start
    if (text.startsWith('/')) return;

    // Check if the input looks like a valid phone number (only digits, 10-15 characters)
    if (/^\d{10,15}$/.test(text)) {
        if (isAuthStarted) {
            return bot.sendMessage(chatId, '⏳ Authentication is already in progress. Please finish the current setup or restart the Render server.');
        }

        isAuthStarted = true;
        await bot.sendMessage(chatId, `⏳ Initializing Baileys for \`${text}\`...\nRequesting code from WhatsApp servers...`, { parse_mode: 'Markdown' });
        
        // Start the Baileys auth process with the provided number
        startWhatsAppAuth(text, chatId);
    } else {
        bot.sendMessage(chatId, '⚠️ Invalid format. Please send ONLY digits, including the country code (e.g., 919876543210).');
    }
});

// Express Server to keep Render alive
app.get('/', (req, res) => {
    res.send('WhatsApp Auth Server is running and waiting for Telegram commands.');
});

app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
});
    
