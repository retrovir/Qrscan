module.exports = {
    name: 'ping',
    description: 'Check if the bot is alive',
    category: 'general',
    
    // The main function executed when someone types !ping
    async execute(sock, msg, args) {
        const remoteJid = msg.key.remoteJid;
        
        // Let's make it a little fancier than the last one
        await sock.sendMessage(remoteJid, { 
            text: '🏓 Pong! The plugin system is fully operational.',
        }, { quoted: msg }); // This makes the bot reply directly to the user's message
    }
};
