/* index.js ─ start with:  node index.js  */
const express = require("express");
const cors = require("cors");
const { exec } = require("child_process");

require('dotenv').config();
//const {runBatchScrape} =require("../scraper/index");
const { testConnection, getAllData, getNears, runScrapper } = require("./db");

const app = express();
app.use(cors());
app.use(express.json());


app.post("/batch-scrape", async (_, res) => {
    res.json({ ok: true, msg: "Started – watch your server log." });
    await runBatchScrape();
  });
  
  app.get("/api/businesses", async (req, res) => {
    try {
      const data = await getAllData(req);
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch businesses" });
    }
  });

  app.get("/api/nears", async (req, res) => {
    try {
      const country = req.query?.country || '';
      const nearQuery = req.query?.q || '';
      const data = await getNears(country, nearQuery);
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err });
    }
  });

  app.post("/api/run-scrapper", async (req, res) => {
    try {
      const data = await runScrapper();
  
      // Clear console buffer (optional)
      process.stdout.write('\x1Bc');
  
      // Run the scraper in the background, without blocking the response
      exec("node scrapper.js", (error, stdout, stderr) => {
        if (error) {
          console.error(`❌ Scraper Error: ${error.message}`);
          return;
        }
  
        if (stderr) {
          console.warn(`⚠️ Scraper Warning: ${stderr}`);
        }
  
        console.log(`✅ Scraper Output:\n${stdout}`);
      });
  
      // Respond to client immediately
      res.json({
        message: "Scraper started in background",
        runScrapperData: data
      });
  
    } catch (err) {
      console.error("❌ API Error:", err);
      res.status(500).json({ error: err.message || err });
    }
  });
  
  
  /* start server */
  app.listen(3000, () => {
    console.log("server is running");
    // runBatchScrape().catch((err) => {
    //   console.error('[scrape] top‑level error:', err);
    // });
  });