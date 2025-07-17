/* index.js ─ start with:  node index.js  */
const express = require("express");
const cors = require("cors");

//const {runBatchScrape} =require("../scraper/index");
const { testConnection, getAllData } = require("./db");

const app = express();
app.use(cors());
app.use(express.json());


app.post("/batch-scrape", async (_, res) => {
    res.json({ ok: true, msg: "Started – watch your server log." });
    await runBatchScrape();
  });
  
  app.get("/api/businesses", async (req, res) => {
    try {
      const data = await getAllData();
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch businesses" });
    }
  });
  
  
  /* start server */
  app.listen(3000, () => {
    console.log("server is running");
    // runBatchScrape().catch((err) => {
    //   console.error('[scrape] top‑level error:', err);
    // });
  });