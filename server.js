import express from "express";
import mongoose from "mongoose";
import makeWASocket, { useMultiFileAuthState, DisconnectReason } from "@whiskeysockets/baileys";
import QR from "qrcode";

const app = express();
app.use(express.json());

const SessionSchema = new mongoose.Schema({
  sessionId: String,
  authFolder: String,
  createdAt: { type: Date, default: Date.now }
});
const Session = mongoose.model("Session", SessionSchema);

await mongoose.connect(process.env.MONGO_URL);

app.get("/qr/:id", async (req, res) => {
  const sessionId = req.params.id;
  try {
    const { state, saveCreds } = await useMultiFileAuthState(`creds/${sessionId}`);
    const sock = makeWASocket({ auth: state, printQRInTerminal: false });

    sock.ev.on("connection.update", async (update) => {
      if(update.qr){
        const qrImage = await QR.toDataURL(update.qr);
        return res.json({ qr: qrImage, error: null });
      }
      if(update.connection === "open"){
        await saveCreds();
        await Session.create({ sessionId, authFolder:`creds/${sessionId}` });
        sock.ws.close();
      }
      if(update.connection === "close"){
        res.json({ qr:null, error:"Disconnected: "+(update.lastDisconnect?.error?.message||"unknown") });
        sock.ws.close();
      }
    });

  } catch (err) {
    res.json({ qr:null, error:"Server error: "+err.message });
  }
});

app.listen(process.env.PORT || 3000);
