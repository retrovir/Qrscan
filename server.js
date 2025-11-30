import express from "express";
import makeWASocket, { DisconnectReason, fetchLatestBaileysVersion, useInMemoryAuthState } from "@whiskeysockets/baileys";
import QRCode from "qrcode";

const app = express();
let qrImage = null;
let wa = null;

async function startWA() {
  const { version } = await fetchLatestBaileysVersion();
  const { state } = useInMemoryAuthState(); // ✅ in-memory auth state

  wa = makeWASocket({
    version,
    printQRInTerminal: false,
    auth: state // ✅ must not be null
  });

  wa.ev.on("connection.update", async ({ qr, connection, lastDisconnect }) => {
    if (qr) {
      qrImage = await QRCode.toDataURL(qr);
    }

    if (connection === "open") {
      console.log("Paired ✅");

      const session = Buffer.from(JSON.stringify(wa.authState.creds)).toString("base64");

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
      <h2>Scan QR to pair with WhatsApp</h2>
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
app.listen(process.env.PORT || 3000, ()=>console.log("Server Live 🚀"));
