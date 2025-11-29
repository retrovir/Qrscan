import express from "express";
import mongoose from "mongoose";
import makeWASocket, { useMultiFileAuthState } from "@whiskeysockets/baileys";
import qrcode from "qrcode";

const app = express();

// MongoDB Schema
const SessionSchema = new mongoose.Schema({
  sessionId: { type: String, unique: true },
  authData: Object,
  createdAt: { type: Date, default: Date.now }
});
const Session = mongoose.model("Session", SessionSchema);

// Connect MongoDB
const mongoURL = process.env.MONGO_URL;
if (!mongoURL) {
  console.error("❌ MONGO_URL missing in Render Environment Variables");
  process.exit(1);
}
await mongoose.connect(mongoURL);
console.log("✅ Connected to MongoDB");

// QR endpoint
app.get("/qr/:id", async (req, res) => {
  const sessionId = req.params.id;

  try {
    // Check if session already exists
    const existing = await Session.findOne({ sessionId });
    if (existing) {
      return res.send(`
        <html>
        <head>
          <title>WhatsApp QR</title>
          <style>
            body{display:flex;justify-content:center;align-items:center;height:100vh;background:#0f172a;color:white;font-family:sans-serif;}
          </style>
        </head>
        <body>
          <h1>✅ Session "${sessionId}" already paired!</h1>
        </body>
        </html>
      `);
    }

    const { state, saveCreds } = await useMultiFileAuthState(`./creds/${sessionId}`);
    const sock = makeWASocket({
      auth: state,
      browser: ["Render","Baileys","1.0.0"],
      printQRInTerminal: false
    });

    let qrSent = false;

    sock.ev.on("connection.update", async (update) => {
      if(update.qr && !qrSent){
        qrSent = true;
        const qrImage = await qrcode.toDataURL(update.qr);

        const html = `
          <html>
          <head>
            <title>WhatsApp QR</title>
            <meta http-equiv="refresh" content="30">
            <style>
              body{display:flex;justify-content:center;align-items:center;height:100vh;background:#0f172a;flex-direction:column;}
              img{width:300px;height:300px;padding:20px;background:white;border-radius:20px;margin-bottom:15px;}
              p{color:white;font-family:sans-serif;margin:5px;}
            </style>
          </head>
          <body>
            <img src="${qrImage}" alt="WhatsApp QR"/>
            <p>QR refreshes every 30 seconds until scanned</p>
            <p id="countdown">Refreshing in 30s</p>

            <script>
              let time = 30;
              const cd = document.getElementById('countdown');
              setInterval(() => {
                time--;
                if(time<=0){ time=30; }
                cd.textContent = 'Refreshing in ' + time + 's';
              },1000);
            </script>
          </body>
          </html>
        `;
        return res.send(html);
      }

      if(update.connection === "open"){
        await saveCreds();
        await Session.create({ sessionId, authData: state.creds });
        sock.ws.close();
        console.log(`✅ Session paired: ${sessionId}`);
      }

      if(update.connection === "close"){
        sock.ws.close();
        if(!qrSent){
          return res.send("<p>❌ Connection closed before QR scanned. Retry.</p>");
        }
      }
    });

    sock.ev.on("creds.update", saveCreds);

  } catch (err) {
    console.error(err);
    return res.send(`<p>❌ Server error: ${err.message}</p>`);
  }
});

// Health check
app.get("/health", (req,res) => res.send("🟢 Running"));

app.listen(process.env.PORT || 3000, () => console.log("🚀 Server running"));
