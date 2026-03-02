const fs = require('fs');
const tar = require('tar');

async function runExtraction() {
    const archiveName = './auth.tar.gz'; 
    const targetDir = './auth'; 

    if (fs.existsSync(targetDir)) {
        console.log('✅ Auth folder already exists. Skipping extraction.');
        return;
    }

    if (fs.existsSync(archiveName)) {
        console.log('📦 Found auth.tar.gz! Extracting session files...');
        try {
            await tar.x({ file: archiveName });
            console.log('✅ Extraction complete! Session is ready.');
        } catch (err) {
            console.error('❌ Failed to extract auth.tar.gz:', err);
            process.exit(1); 
        }
    } else {
        console.log('⚠️ No auth.tar.gz found. Baileys will start fresh.');
    }
}

runExtraction();
