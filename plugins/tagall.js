module.exports = {
    name: 'tagall',
    description: 'Tags every member in the group (Hidden)',
    
    async execute(sock, msg, args, { isOwner }) {
        const remoteJid = msg.key.remoteJid;

        // 1. Ensure this is a group chat
        if (!remoteJid.endsWith('@g.us')) return;

        // 2. Fetch Group Info & Check Permissions
        const metadata = await sock.groupMetadata(remoteJid);
        const sender = (msg.key.participant || remoteJid).split(':')[0] + '@s.whatsapp.net';
        const admins = metadata.participants.filter(p => p.admin).map(p => p.id);
        
        // Only Admins or the Bot Owner can use TagAll
        if (!(admins.includes(sender) || isOwner)) {
            return await sock.sendMessage(remoteJid, { text: '❌ Only admins can tag everyone.' }, { quoted: msg });
        }

        // 3. Collect all participant JIDs (the hidden "mentions")
        const participants = metadata.participants.map(p => p.id);
        
        // 4. Get the message text (Default: "Hello everyone!")
        const messageText = args.join(' ') || '📢 Attention Everyone!';

        // 5. Send the message with hidden mentions
        // The "mentions" array tells WhatsApp to notify these IDs, even if their names aren't in the text.
        await sock.sendMessage(remoteJid, { 
            text: `*${messageText}*`, 
            mentions: participants 
        });
    }
};
