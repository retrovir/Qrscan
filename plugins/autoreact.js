module.exports = {
    name: 'autoreact',
    description: 'Toggle auto-reaction for all messages in a group',
    
    async execute(sock, msg, args, { isOwner, db, saveDB }) {
        const remoteJid = msg.key.remoteJid;
        const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').toLowerCase();
        
        // --- COMMAND LOGIC (.autoreact on/off) ---
        // Only run this part if the user actually typed the command
        if (text.startsWith('.autoreact')) {
            if (!isOwner) return; // Only owner can toggle this global setting

            if (!db.autoReactGroups) db.autoReactGroups = [];

            if (args[0] === 'on') {
                if (!db.autoReactGroups.includes(remoteJid)) {
                    db.autoReactGroups.push(remoteJid);
                    saveDB();
                }
                return await sock.sendMessage(remoteJid, { text: '✅ Auto React is now *ON* for this group.' }, { quoted: msg });
            } 
            
            if (args[0] === 'off') {
                db.autoReactGroups = db.autoReactGroups.filter(id => id !== remoteJid);
                saveDB();
                return await sock.sendMessage(remoteJid, { text: '❌ Auto React is now *OFF* for this group.' }, { quoted: msg });
            }

            return await sock.sendMessage(remoteJid, { text: '❓ Usage: `.autoreact on` or `.autoreact off`' }, { quoted: msg });
        }

        // --- REACTION LOGIC (Runs on every message) ---
        // If this group is in our "On" list, react to the message
        if (db.autoReactGroups?.includes(remoteJid)) {
            const emojis = ['👍', '❤️', '✨', '🔥', '🤖', '👀', '⭐'];
            const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];

            await sock.sendMessage(remoteJid, {
                react: {
                    text: randomEmoji,
                    key: msg.key
                }
            });
        }
    }
};
