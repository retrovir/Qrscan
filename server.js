import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import makeWASocket, { useMultiFileAuthState, DisconnectReason } from "@whiskeysockets/baileys";
import qrcode from "qrcode";

const app = express();
app.use(cors());
app.use(express.json());

// Mongo Schema
const SessionSchema = new mongoose.Schema({
  sessionId: { type: String, unique: true },
  authData: Object,
  createdAt: { type: Date, default: Date.now }
});
const Session = mongoose.model("Session", SessionSchema);

// Mongo DB Connect (Error-safe)
const mongoURL = process.env.MONGO_URL;
if (!mongoURL || typeof mongoURL !== "string") {
  console.error("❗ MONGO_URL is missing or invalid. Add it in Render Environment Variables.");
  process.exit(1);
}

await mongoose.connect(mongoURL);
console.log("✅ Connected to MongoDB");

// Generate QR safely and return errors to frontend
app.get("/qr/:id", async (req, res) => {
  const sessionId = req.params.id;

  try {
    const { state, saveCreds } = await useMultiFileAuthState(`./creds/${sessionId}`);
    
    const sock = makeWASocket({
      auth: state,
      browser: ["Render","Baileys","1.0.0"],
      printQRInTerminal: false
    });

    sock.ev.on("connection.update", async (update) => {
      if (update.qr) {
        const qrImg = await qrcode.toDataURL(update.qr);
        return res.json({ qr: qrImg, status: "scan", error: null });
      }

      if (update.connection === "open") {
        await saveCreds();
        await Session.create({ sessionId, authData: state.creds });
        sock.ws.close();
        console.log(`✅ Session paired: ${sessionId}`);
      }

      if (update.connection === "close") {
        const reason = update.lastDisconnect?.error?.output?.statusCode;
        const errMsg = reason === DisconnectReason?.badSession ? "Bad Session. Delete and Retry"
                    : reason === DisconnectReason?.connectionClosed ? "Connection closed, retry"
                    : "Unknown Error while connecting";

        sock.ws.close();
        return res.json({ qr: null, status:"error", error:errMsg });
      }
    });

    sock.ev.on("creds.update", saveCreds);

  } catch (err) {
    console.error(err);
    return res.json({ qr: null, status: "error", error: "Server error: " + err.message });
  }
});

// Basic health check
app.get("/health", (req, res) => res.json({ running: true }));

app.listen(process.env.PORT || 3000, () => {
  console.log("🚀 Backend running on Render");
});
