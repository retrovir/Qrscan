module.exports = {
    name: 'mode',
    description: 'Change the bot mode between public and private',
    
    async execute(sock, msg, args, { isOwner, db, saveDB }) {
        const remoteJid = msg.key.remoteJid;

        if (!isOwner) {
            return await sock.sendMessage(remoteJid, { text: '❌ Only the bot owner can use this command.' }, { quoted: msg });
        }

        const newMode = args[0]?.toLowerCase();

        if (newMode === 'public' || newMode === 'private') {
            db.mode = newMode;
            saveDB();
            await sock.sendMessage(remoteJid, { text: `✅ Bot mode has been successfully changed to *${newMode}*.` }, { quoted: msg });
        } else {
            await sock.sendMessage(remoteJid, { text: `⚙️ The current bot mode is *${db.mode}*.\n\nTo change it, type:\n!mode public\n!mode private` }, { quoted: msg });
        }
    }
};
