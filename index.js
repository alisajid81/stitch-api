import express from "express";
import multer from "multer";
import ffmpeg from "fluent-ffmpeg";
import fs from "fs";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

// ============================
// CONFIG
// ============================

const PORT = process.env.PORT || 3000;

if (
  !process.env.R2_ACCOUNT_ID ||
  !process.env.R2_ACCESS_KEY_ID ||
  !process.env.R2_SECRET_ACCESS_KEY ||
  !process.env.R2_BUCKET
) {
  throw new Error("R2 environment variables missing");
}

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

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
    },
  }),
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
    { name: "segment_4", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      if (!req.files || !req.files.audio) {
        return res.status(400).json({ error: "Fichiers manquants" });
      }

      const segments = Object.keys(req.files)
        .filter((key) => key.startsWith("segment_"))
        .sort()
        .map((key) => req.files[key][0].path);

      if (segments.length === 0) {
        return res.status(400).json({ error: "Aucun segment reçu" });
      }

      const audioPath = req.files["audio"][0].path;
      const concatFilePath = "/tmp/concat.txt";
      const outputPath = `/tmp/final-${Date.now()}.mp4`;

      // Create concat file
      const concatContent = segments
        .map((file) => `file '${file}'`)
        .join("\n");

      fs.writeFileSync(concatFilePath, concatContent);

      // ============================
      // FFMPEG MERGE
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
            "-movflags +faststart",
          ])
          .on("error", reject)
          .on("end", resolve)
          .save(outputPath);
      });

      // ============================
      // UPLOAD TO R2
      // ============================

      const fileName = `video-${Date.now()}.mp4`;
      const fileBuffer = fs.readFileSync(outputPath);

      await s3.send(
        new PutObjectCommand({
          Bucket: process.env.R2_BUCKET,
          Key: fileName,
          Body: fileBuffer,
          ContentType: "video/mp4",
        })
      );

      const publicUrl = `https://${process.env.R2_BUCKET}.${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${fileName}`;

      // ============================
      // CLEANUP LOCAL FILES
      // ============================

      [...segments, audioPath, concatFilePath, outputPath].forEach((file) => {
        if (fs.existsSync(file)) {
          try {
            fs.unlinkSync(file);
          } catch (e) {
            console.error("Cleanup error:", e);
          }
        }
      });

      // ============================
      // RESPONSE
      // ============================

      res.json({
        success: true,
        url: publicUrl,
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Erreur Stitch" });
    }
  }
);

// ============================
// START SERVER
// ============================

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Serveur Stitch démarré sur port ${PORT}`);
});