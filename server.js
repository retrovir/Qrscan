const express = require('express');
const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, Browsers } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const archiver = require('archiver');
const TelegramBot = require('node-telegram-bot-api');
const qrcode = require('qrcode');

const app = express();
const port = process.env.PORT || 3000;

// Environment Variables required in Render
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

// State Management Variables
let isAuthStarted = false; 
let latestQrString = null; // Stores the most recent QR code string silently
let qrRequested = false;   // Flag to only send the image when asked

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
                // Reset state so it's ready for next time
                isAuthStarted = false; 
                latestQrString = null;
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
async function startWhatsAppAuth(chatId) {
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
        browser: Browsers.macOS('Desktop') 
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            // Constantly update the background QR string as Baileys regenerates it
            latestQrString = qr; 
            
            // ONLY generate and send the image if the user just typed /login
            if (qrRequested) {
                qrRequested = false; // Immediately flip flag to false to prevent spam
                
                try {
                    console.log('Generating requested QR image...');
                    const qrImagePath = __dirname + '/qr.png';
                    await qrcode.toFile(qrImagePath, latestQrString);
                    
                    await bot.sendPhoto(chatId, qrImagePath, { 
                        caption: '📱 **Scan this QR Code!**\n\nOpen WhatsApp -> Linked Devices -> Link a Device.\n\n*(If it expires before you scan, just send /login again to get a fresh one.)*',
                        parse_mode: 'Markdown'
                    });
                } catch (err) {
                    console.error('Failed to generate or send QR code:', err);
                    await bot.sendMessage(chatId, '❌ Failed to generate QR code image.');
                }
            }
        }

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== 401;
            console.log('Connection closed. Reconnecting:', shouldReconnect);
            
            if (!shouldReconnect) {
                await bot.sendMessage(chatId, '❌ Authentication failed or device unlinked. Send /reset and try /login again.');
                isAuthStarted = false;
                latestQrString = null;
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
    bot.sendMessage(msg.chat.id, '👋 Welcome to the WhatsApp QR Auth Bot!\n\nSend /login to generate a QR code.\nIf you get stuck, send /reset.');
});

bot.onText(/\/reset/, (msg) => {
    isAuthStarted = false;
    latestQrString = null;
    qrRequested = false;
    if (fs.existsSync('./auth_info_baileys')) {
        fs.rmSync('./auth_info_baileys', { recursive: true, force: true });
    }
    bot.sendMessage(msg.chat.id, '🔄 System reset. Old folders deleted. Send /login to start fresh.');
});

bot.onText(/\/login/, async (msg) => {
    const chatId = msg.chat.id;

    if (!isAuthStarted) {
        // First time booting up
        isAuthStarted = true;
        qrRequested = true; // Tell the system to send the very first QR it generates
        await bot.sendMessage(chatId, '⏳ Initializing Baileys...\nGenerating your QR code...', { parse_mode: 'Markdown' });
        startWhatsAppAuth(chatId);
    } else {
        // Baileys is already running in the background. Check if we have a recent QR.
        if (latestQrString) {
            try {
                const qrImagePath = __dirname + '/qr.png';
                await qrcode.toFile(qrImagePath, latestQrString);
                await bot.sendPhoto(chatId, qrImagePath, { 
                    caption: '📱 **Here is the latest active QR Code!**\n\n*(If this expires, just send /login again.)*',
                    parse_mode: 'Markdown'
                });
            } catch (err) {
                await bot.sendMessage(chatId, '❌ Failed to generate QR code image.');
            }
        } else {
            // System is running but hasn't received the first QR from WhatsApp servers yet
            qrRequested = true; 
            await bot.sendMessage(chatId, '⏳ Waiting for Baileys to receive the QR code from WhatsApp... it will be sent momentarily.');
        }
    }
});

// Express Server to keep Render alive
app.get('/', (req, res) => {
    res.send('WhatsApp Auth Server is running and waiting for Telegram commands.');
});

app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
});
