import express from "express";
import multer from "multer";
import ffmpeg from "fluent-ffmpeg";
import fs from "fs";

// ============================
// CONFIG
// ============================

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = "/tmp/public";
const EXPIRATION_MINUTES = 30;

if (!fs.existsSync(PUBLIC_DIR)) {
  fs.mkdirSync(PUBLIC_DIR, { recursive: true });
}

// Stockage expiration en mémoire
const fileExpirations = new Map();

// ============================
// APP INIT
// ============================

const app = express();
app.use(express.json());

app.get("/", (req, res) => {
  res.status(200).send("OK");
});

// ============================
// MULTER
// ============================

const upload = multer({
  storage: multer.diskStorage({
    destination: "/tmp/",
    filename: (req, file, cb) => {
      cb(null, Date.now() + "-" + file.fieldname + ".mp4");
    }
  })
});

ffmpeg.setFfmpegPath("ffmpeg");

// ============================
// STITCH ENDPOINT
// ============================

app.post(
  "/stitch",
  upload.fields([
    { name: "audio", maxCount: 1 },
    { name: "segment_1", maxCount: 1 },
    { name: "segment_2", maxCount: 1 },
    { name: "segment_3", maxCount: 1 },
    { name: "segment_4", maxCount: 1 }
  ]),
  async (req, res) => {
    try {
      if (!req.files || !req.files.audio) {
        return res.status(400).json({ error: "Fichiers manquants" });
      }

      const segments = Object.keys(req.files)
        .filter(key => key.startsWith("segment_"))
        .sort()
        .map(key => req.files[key][0].path);

      if (segments.length === 0) {
        return res.status(400).json({ error: "Aucun segment reçu" });
      }

      const audioPath = req.files["audio"][0].path;

      const concatFilePath = "/tmp/concat.txt";

      const fileName = `video-${Date.now()}.mp4`;
      const finalOutputPath = `${PUBLIC_DIR}/${fileName}`;

      const concatContent = segments
        .map(file => `file '${file}'`)
        .join("\n");

      fs.writeFileSync(concatFilePath, concatContent);

      // ============================
      // Concat + Audio (1 passe)
      // ============================

      await new Promise((resolve, reject) => {
        ffmpeg()
          .input(concatFilePath)
          .inputOptions(["-f concat", "-safe 0"])
          .input(audioPath)
          .outputOptions([
            "-map 0:v?",
            "-map 1:a",
            "-c:v libx264",
            "-preset veryfast",
            "-crf 23",
            "-pix_fmt yuv420p",
            "-shortest",
            "-movflags +faststart"
          ])
          .on("error", reject)
          .on("end", resolve)
          .save(finalOutputPath);
      });

      // ============================
      // Expiration setup
      // ============================

      const expireAt = Date.now() + EXPIRATION_MINUTES * 60 * 1000;
      fileExpirations.set(fileName, expireAt);

      const baseUrl = `${req.protocol}://${req.get("host")}`;
      const videoUrl = `${baseUrl}/videos/${fileName}`;

      // Cleanup fichiers temporaires upload
      [...segments, audioPath, concatFilePath].forEach(file => {
        if (fs.existsSync(file)) fs.unlinkSync(file);
      });

      res.json({
        success: true,
        url: videoUrl,
        expires_in_minutes: EXPIRATION_MINUTES
      });

    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Erreur Stitch" });
    }
  }
);

// ============================
// VIDEO ACCESS WITH EXPIRATION
// ============================

app.get("/videos/:file", (req, res) => {
  const fileName = req.params.file;
  const filePath = `${PUBLIC_DIR}/${fileName}`;

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "Fichier introuvable" });
  }

  const expireAt = fileExpirations.get(fileName);

  if (!expireAt || Date.now() > expireAt) {
    try {
      fs.unlinkSync(filePath);
    } catch (e) {}
    fileExpirations.delete(fileName);
    return res.status(410).json({ error: "Lien expiré" });
  }

  res.sendFile(filePath);
});

// ============================
// AUTO CLEANUP (sécurité)
// ============================

setInterval(() => {
  const now = Date.now();

  for (const [fileName, expireAt] of fileExpirations.entries()) {
    if (now > expireAt) {
      const filePath = `${PUBLIC_DIR}/${fileName}`;
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      fileExpirations.delete(fileName);
      console.log("Fichier expiré supprimé:", fileName);
    }
  }
}, 5 * 60 * 1000);

// ============================
// START SERVER
// ============================

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Serveur Stitch démarré sur port ${PORT}`);
});