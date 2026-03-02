module.exports = {
    name: 'group',
    description: 'All-in-one moderation: .kick, .dlt, .promote, .demote',
    
    async execute(sock, msg, args, { isOwner }) {
        const remoteJid = msg.key.remoteJid;
        const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').toLowerCase();
        
        // --- 1. SET UP COMMAND ALIASES ---
        const isKick = text.startsWith('.kick');
        const isDelete = text.startsWith('.dlt') || text.startsWith('.delete');
        const isPromote = text.startsWith('.promote');
        const isDemote = text.startsWith('.demote');

        // --- 2. GLOBAL SECURITY & GROUP CHECK ---
        if (!remoteJid.endsWith('@g.us')) {
            return await sock.sendMessage(remoteJid, { text: '❌ This command only works in groups.' });
        }

        const metadata = await sock.groupMetadata(remoteJid);
        const botNumber = sock.user.id.split(':')[0] + '@s.whatsapp.net';
        const sender = (msg.key.participant || remoteJid).split(':')[0] + '@s.whatsapp.net';
        
        const admins = metadata.participants.filter(p => p.admin).map(p => p.id);
        const isBotAdmin = admins.includes(botNumber);
        const isSenderAdmin = admins.includes(sender) || isOwner;

        if (!isSenderAdmin) return; // Silently ignore non-admins
        if (!isBotAdmin) return await sock.sendMessage(remoteJid, { text: '❌ Give me Admin rights first!' });

        // --- 3. TARGET IDENTIFICATION ---
        const contextInfo = msg.message?.extendedTextMessage?.contextInfo;
        let target = contextInfo?.participant || (contextInfo?.mentionedJid ? contextInfo.mentionedJid[0] : null);

        // --- 4. LOGIC PER COMMAND ---

        // DELETE (Doesn't need a target, needs a quoted message)
        if (isDelete) {
            if (!contextInfo?.quotedMessage) {
                return await sock.sendMessage(remoteJid, { text: '❌ Reply to a message to delete it.' });
            }
            const key = {
                remoteJid: remoteJid,
                fromMe: contextInfo.participant === botNumber,
                id: contextInfo.stanzaId,
                participant: contextInfo.participant
            };
            return await sock.sendMessage(remoteJid, { delete: key });
        }

        // KICK / PROMOTE / DEMOTE (Requires a target)
        if (!target) return await sock.sendMessage(remoteJid, { text: '❌ Tag a user or reply to their message.' });

        try {
            if (isKick) {
                if (target === botNumber || target === metadata.owner) return;
                await sock.groupParticipantsUpdate(remoteJid, [target], 'remove');
                await sock.sendMessage(remoteJid, { text: '🚪 User kicked.' });
            } 
            else if (isPromote) {
                await sock.groupParticipantsUpdate(remoteJid, [target], 'promote');
                await sock.sendMessage(remoteJid, { text: '🛡️ User is now Admin.' });
            } 
            else if (isDemote) {
                await sock.groupParticipantsUpdate(remoteJid, [target], 'demote');
                await sock.sendMessage(remoteJid, { text: '📉 User demoted.' });
            }
        } catch (err) {
            console.error(err);
            await sock.sendMessage(remoteJid, { text: '❌ Operation failed. WhatsApp might be blocking this action.' });
        }
    }
};
