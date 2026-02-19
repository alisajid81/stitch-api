import express from "express";
import multer from "multer";
import ffmpeg from "fluent-ffmpeg";
import fs from "fs";
import path from "path";

const app = express();
const upload = multer({ dest: "/tmp/" });

ffmpeg.setFfmpegPath("ffmpeg");

app.post("/stitch",
  upload.fields([
    { name: "audio", maxCount: 1 },
    { name: "segment_1", maxCount: 1 },
    { name: "segment_2", maxCount: 1 },
    { name: "segment_3", maxCount: 1 },
    { name: "segment_4", maxCount: 1 },
    { name: "segment_5", maxCount: 1 },
    { name: "segment_6", maxCount: 1 },
    { name: "segment_7", maxCount: 1 }
  ]),
  async (req, res) => {
    try {
      const segments = [];

      for (let i = 1; i <= 7; i++) {
        segments.push(req.files[`segment_${i}`][0].path);
      }

      const audioPath = req.files["audio"][0].path;

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
const ffmpegCommand = ffmpeg();

segments.forEach(file => {
  ffmpegCommand.input(file);
});

ffmpegCommand
  .complexFilter([
    {
      filter: "concat",
      options: {
        n: segments.length,
        v: 1,
        a: 0
      }
    }
  ])
  .outputOptions([
    "-c:v libx264",
    "-preset veryfast",
    "-crf 23",
    "-pix_fmt yuv420p"
  ])
  .save(outputVideoPath);



      // 2️⃣ ajouter l’audio
await new Promise((resolve, reject) => {
  ffmpeg(outputVideoPath)
    .input(audioPath)
    .complexFilter([
      "[0:a]volume=0.1[a1]",
      "[1:a]volume=1.0[a2]",
      "[a1][a2]amix=inputs=2:duration=shortest[aout]"
    ])
    .outputOptions([
      "-map 0:v:0",
      "-map [aout]",
      "-c:v copy"
    ])
    .save(finalOutputPath)
    .on("end", resolve)
    .on("error", reject);
});



      res.download(finalOutputPath);

    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Erreur Stitch" });
    }
  }
);

app.listen(3000, "0.0.0.0", () => {
  console.log("Serveur Stitch démarré sur port 3000");
});
