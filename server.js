import express from "express";
import makeWASocket, { DisconnectReason, fetchLatestBaileysVersion } from "@whiskeysockets/baileys";
import QRCode from "qrcode";

const app = express();
let qrImage = null;
let wa = null;

async function startWA() {
  const { version } = await fetchLatestBaileysVersion();
  wa = makeWASocket({
    version,
    printQRInTerminal: false,
    auth: null
  });

  wa.ev.on("connection.update", async ({ qr, connection, lastDisconnect }) => {
    if (qr) {
      qrImage = await QRCode.toDataURL(qr);
    }

    if (connection === "open") {
      console.log("Paired ✅");

      // Generate session string and send to paired chat itself
      const session = Buffer.from(JSON.stringify(wa.authState?.creds || {})).toString("base64");

      await wa.sendMessage("me", {
        text: `✅ Paired with :contentReference[oaicite:0]{index=0}\n\nSession:\n${session}`
      });

      qrImage = null;
    }

    if (connection === "close") {
      const reconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      if (reconnect) startWA();
    }
  });
}

app.get("/", (req, res) => {
  res.send(`
    <html>
    <body style="text-align:center;font-family:sans-serif;padding:20px">
      <h2>WhatsApp QR Pairing</h2>
      <div>${qrImage ? `<img src="${qrImage}" width="260"/>` : "Generating QR..."}</div>
      ${qrImage ? `<h3>Refresh in <span id="t">30</span>s</h3>` : ""}
      <script>
        let s=30;
        setInterval(()=>{
          s--;
          document.getElementById('t').innerText=s;
          if(s<=0)location.reload();
        },1000);
      </script>
    </body>
    </html>
  `);
});

startWA();
app.listen(3000, ()=>console.log("Server Live 🚀"));
      
