import express from "express";
import mongoose from "mongoose";
import makeWASocket, { useMultiFileAuthState } from "@whiskeysockets/baileys";
import QR from "qrcode";

const app = express();
app.use(express.json());

// MongoDB Schema
const SessionSchema = new mongoose.Schema({
  sessionId: String,
  authFolder: String,
  createdAt: { type: Date, default: Date.now }
});
const Session = mongoose.model("Session", SessionSchema);

mongoose.connect(process.env.MONGO_URL || "mongodb://127.0.0.1:27017/wa_sessions");

// Create session + QR + error catch
app.get("/qr/:id", async (req, res) => {
  const sessionId = req.params.id;

  try {
    const { state, saveCreds } = await useMultiFileAuthState(`creds/${sessionId}`);

    const sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      browser: ["Render", "Baileys-Session", "1.0.0"]
    });

    sock.ev.on("connection.update", async (update) => {
      if(update.qr){
        const qrImage = await QR.toDataURL(update.qr);
        res.json({ qr: qrImage, error: null });
      }

      if(update.connection === "open"){
        await saveCreds();
        await Session.create({ sessionId, authFolder: `creds/${sessionId}` });
        sock.ws.close();
      }

      if(update.connection === "close" && update.lastDisconnect?.error){
        res.json({ qr: null, error: "❌ WhatsApp connection failed. Retry with same session ID." });
        sock.ws.close();
      }
    });

    sock.ev.on("error", (err) => {
      res.json({ qr: null, error: "Baileys Error: " + err.message });
      sock.ws.close();
    });

  } catch (err) {
    res.json({ qr: null, error: "Server Error: " + err.message });
  }
});

// serve UI
app.use("/", express.static("./"));

app.listen(process.env.PORT || 3000, () => {
  console.log("🚀 Server running");
});
