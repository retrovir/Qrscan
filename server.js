import express from "express";
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
} from "@whiskeysockets/baileys";
import QRCode from "qrcode";
import fs from "fs";

const app = express();
let currentQR = null;
let qrCount = 0;
let socketInstance = null;

// Connect to WhatsApp
async function connectWA() {
  const { state, saveCreds } = await useMultiFileAuthState("/mnt/storage/auth");

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    browser: ["Render-WA-QR", "Chrome", "1.0"],
  });

  socketInstance = sock;
  socketInstance.ev.on("connection.update", async (update) => {
    const { qr, connection, lastDisconnect } = update;

    if (qr) {
      currentQR = await QRCode.toDataURL(qr);
      qrCount++;
      qrCount = qrCount % 30; // reset at 30
      qrCount++;
    }

    if (connection === "open") {
      console.log("✅ Paired successfully!");

      // Read creds file and send to yourself
      const credsData = fs.readFileSync(
        "/mnt/storage/auth/creds.json",
        "utf8"
      );

      const yourNumber = "91XXXXXXXXXX@s.whatsapp.net"; // CHANGE to your WA
      await socketInstance.sendMessage(yourNumber, {
        text: `✅ WhatsApp connected!\n\nCreds:\n${credsData}`,
      });

      currentQR = null; // stop QR generation once paired
    }

    if (connection === "close") {
      const shouldReconnect =
        lastDisconnect?.error?.output?.statusCode !==
        DisconnectReason.loggedOut;
      if (shouldReconnect) {
        connectWA();
      }
    }
    await saveCreds();
  });
}

// Serve QR + Timer page
app.get("/", (req, res) => {
  const html = `
<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>WA QR Pairing</title>
<style>
  body {
    font-family: Arial, sans-serif;
    text-align: center;
    padding: 20px;
  }
  img {
    width: 280px;
    border-radius: 12px;
    box-shadow: 0 0 12px rgba(0,0,0,0.15);
  }
  #timer {
    font-size: 20px;
    margin-top: 15px;
    font-weight: bold;
  }
</style>
</head>
<body>
  <h2>Scan WhatsApp QR</h2>
  <div>
    ${
      currentQR
        ? `<img id="qrImg" src="${currentQR}" />`
        : "<p>✅ Already Paired — Restart service to regenerate QR</p>"
    }
  </div>
  ${
    currentQR
      ? `<div id="timer">Refreshing in: <span id="countdown">30</span>s</div>`
      : ""
  }
  <script>
    let time = 30;
    const cd = document.getElementById("countdown");
    const interval = setInterval(()=>{
      time--;
      if(cd) cd.textContent = time;
      if(time<=0){
        clearInterval(interval);
        location.reload();
      }
    },1000);
  </script>
</body>
</html>
  `;
  res.send(html);
});

// Kick off WA connection + start server
connectWA();
app.listen(3000, () =>
  console.log("🚀 Service live on main URL: 3000")
);
