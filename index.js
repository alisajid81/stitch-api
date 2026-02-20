import express from "express";
import multer from "multer";
import ffmpeg from "fluent-ffmpeg";
import fs from "fs";
import path from "path";

const app = express();
app.use("/static", express.static("public"));

const upload = multer({
  storage: multer.diskStorage({
    destination: "/tmp/",
    filename: (req, file, cb) => {
      cb(null, Date.now() + "-" + file.fieldname + ".mp4");
    }
  })
});

ffmpeg.setFfmpegPath("ffmpeg");

app.post("/stitch",
  upload.fields([
    { name: "audio", maxCount: 1 },
    { name: "segment_1", maxCount: 1 },
    { name: "segment_2", maxCount: 1 },
    { name: "segment_3", maxCount: 1 },
    { name: "segment_4", maxCount: 1 }
  ]),
  async (req, res) => {
    try {

const segments = Object.keys(req.files)
  .filter(key => key.startsWith("segment_"))
  .sort()
  .map(key => req.files[key][0].path);

const audioPath = req.files["audio"][0].path;

console.log("Segments paths:", segments);

segments.forEach(file => {
  const stats = fs.statSync(file);
  console.log("Video File:", file, "Size:", stats.size);
});

const audioStats = fs.statSync(audioPath);
console.log("Audio File:", audioPath, "Size:", audioStats.size);


      const concatFilePath = "/tmp/concat.txt";
      const outputVideoPath = "/tmp/merged.mp4";
      const finalOutputPath = "/tmp/final.mp4";

      // créer le fichier concat
      const concatContent = segments
  .map(file => `file '${file}'`)
  .join("\n");

console.log("Segments paths:", segments);
console.log("Concat content:\n", concatContent);


      fs.writeFileSync(concatFilePath, concatContent);

      // 1️⃣ concaténer les vidéos
await new Promise((resolve, reject) => {
  ffmpeg()
    .input(concatFilePath)
    .inputOptions(["-f concat", "-safe 0"])
    .outputOptions([
      "-vsync 2",
      "-c:v libx264",
      "-preset veryfast",
      "-crf 23",
      "-pix_fmt yuv420p",
      "-movflags +faststart"
    ])
    .save(outputVideoPath)
    .on("start", cmd => console.log("Concat CMD:", cmd))
    .on("stderr", line => console.log("FFmpeg:", line))
    .on("end", resolve)
    .on("error", reject);
});

      // 2️⃣ ajouter l’audio
await new Promise((resolve, reject) => {
  ffmpeg(outputVideoPath)
    .input(audioPath)
    .complexFilter([
      "[0:a]volume=0.3[a1]",
      "[1:a]volume=1.0[a2]",
      "[a1][a2]amix=inputs=2:duration=shortest[aout]"
    ])
.outputOptions([
  "-map 0:v",
  "-map [aout]",
  "-c:v libx264",
  "-preset veryfast",
  "-crf 23",
  "-pix_fmt yuv420p"
])

    .save(finalOutputPath)
    .on("end", resolve)
    .on("error", reject);
});

      res.download(finalOutputPath);
res.download(finalOutputPath, () => {
  try {
    [...segments, audioPath, concatFilePath, outputVideoPath, finalOutputPath]
      .forEach(file => fs.existsSync(file) && fs.unlinkSync(file));
  } catch (e) {
    console.error("Cleanup error:", e);
  }
});

    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Erreur Stitch" });
    }
  }
);

app.listen(3000, "0.0.0.0", () => {
  console.log("Serveur Stitch démarré sur port 3000");
});

