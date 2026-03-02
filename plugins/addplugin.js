const config = require('../config'); 

module.exports = {
    name: 'addplugin',
    description: 'Upload code directly to GitHub and trigger a Render restart',
    
    async execute(sock, msg, args, { isOwner }) {
        const remoteJid = msg.key.remoteJid;

        if (!isOwner) return;

        const fileName = args[0];
        if (!fileName || !fileName.endsWith('.js')) {
            return await sock.sendMessage(remoteJid, { text: '❌ Please provide a filename ending in .js (e.g., `!addplugin menu.js`)' }, { quoted: msg });
        }

        const quotedMsg = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
        const code = quotedMsg?.conversation || quotedMsg?.extendedTextMessage?.text;

        if (!code) {
            return await sock.sendMessage(remoteJid, { text: '❌ You must reply to a message containing the raw JavaScript code.' }, { quoted: msg });
        }

        await sock.sendMessage(remoteJid, { text: `⏳ Connecting to GitHub to upload \`${fileName}\`...` }, { quoted: msg });

        const path = `plugins/${fileName}`;
        const url = `https://api.github.com/repos/${config.githubOwner}/${config.githubRepo}/contents/${path}`;
        
        const headers = {
            'Authorization': `Bearer ${config.githubToken}`,
            'Accept': 'application/vnd.github.v3+json',
            'Content-Type': 'application/json'
        };

        try {
            let sha = null;
            const getRes = await fetch(url, { headers });
            if (getRes.ok) {
                const getData = await getRes.json();
                sha = getData.sha;
            }

            const contentBase64 = Buffer.from(code, 'utf-8').toString('base64');
            const payload = {
                message: `🤖 Bot Auto-Upload: Added/Updated ${fileName}`,
                content: contentBase64,
                branch: 'main' 
            };
            if (sha) payload.sha = sha;

            const putRes = await fetch(url, {
                method: 'PUT',
                headers,
                body: JSON.stringify(payload)
            });

            if (!putRes.ok) {
                const errorData = await putRes.json();
                throw new Error(errorData.message || 'GitHub API rejected the request.');
            }

            await sock.sendMessage(remoteJid, { 
                text: `✅ **Successfully pushed \`${fileName}\` to GitHub!**\n\nRender has detected the change and is restarting the server now.` 
            }, { quoted: msg });

        } catch (error) {
            console.error('GitHub Upload Error:', error);
            await sock.sendMessage(remoteJid, { text: `❌ **Upload Failed:**\n${error.message}` }, { quoted: msg });
        }
    }
};
