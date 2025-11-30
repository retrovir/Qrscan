import express from "express";
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} from "@whiskeysockets/baileys";
import QRCode from "qrcode";

const app = express();
let qrHTML = "Generating QR...";

async function startWASocket() {
  // Auth stored in RAM-friendly tmp folder
  const { state, saveCreds } = await useMultiFileAuthState("/tmp/wa-auth");

  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async ({ qr, connection, lastDisconnect }) => {
    if (qr) {
      const qrImg = await QRCode.toDataURL(qr);
      qrHTML = `<img src="${qrImg}" width="250"/><br><h3>Refreshing in <span id="t">30</span>s</h3>`;
    }

    if (connection === "open") {
      console.log("PAIRED SUCCESSFULLY ✅");

      // Create session string
      const session = Buffer.from(JSON.stringify(state.creds)).toString("base64");

      // Send to your own WhatsApp automatically
      await sock.sendMessage("me", { text: `Your Session:\n${session}` });

      qrHTML = "<h2>PAIRED SUCCESSFULLY 🎉</h2>";
    }

    if (connection === "close") {
      const shouldReconnect =
        lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;

      if (shouldReconnect) startWASocket();
    }
  });
}

app.get("/", (req, res) => {
  res.send(`
    <html>
    <body style="text-align:center;font-family:sans-serif;padding-top:40px">
      <h2>WhatsApp QR Login</h2>
      ${qrHTML}
      <script>
        let s = 30;
        setInterval(()=>{
          const el = document.getElementById('t');
          if (el) el.innerText = s--;
          if (s <= 0) location.reload();
        }, 1000);
      </script>
    </body>
    </html>
  `);
});

startWASocket();
app.listen(process.env.PORT || 3000, () => console.log("Server Running 🚀"));
