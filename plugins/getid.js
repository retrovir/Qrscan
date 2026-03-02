module.exports = {
    name: 'getid',
    description: 'Returns your exact WhatsApp ID',
    
    async execute(sock, msg, args) {
        const remoteJid = msg.key.remoteJid;
        
        // Grab the exact raw ID that WhatsApp is sending
        const rawSender = msg.key.participant || remoteJid;
        const exactNumber = rawSender.split('@')[0];

        const replyText = `🤖 *ID EXTRACTOR* 🤖\n\n` +
                          `Here is the exact ID WhatsApp is sending me:\n` +
                          `👉 \`${exactNumber}\`\n\n` +
                          `Copy that exact number (including any colons or extra numbers) and paste it into your \`config.js\` ownerNumbers array!`;

        await sock.sendMessage(remoteJid, { text: replyText }, { quoted: msg });
    }
};
