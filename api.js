/* index.js ─ start with:  node index.js  */
const express = require("express");
const cors = require("cors");
const { exec } = require("child_process");



require('dotenv').config();
//const {runBatchScrape} =require("../scraper/index");
const { testConnection, getAllData, getNears, runScrapper, client, getSuggestions  } = require("./db");

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

  app.get("/api/suggest", async (req, res) => {
    try {
      const { country, input, locationInput } = req.query;
      let types = req.query.entityTypes;
  
      if (!types) {
        types = ["Category", "Organization"];
      } else if (!Array.isArray(types)) {
        types = types.split(',').map(s => s.trim()).filter(Boolean);
      }
  
      if (!input || !country || types.length === 0) {
        return res.status(400).json({ error: "Missing required parameters." });
      }
  
 
  
      const suggestions = await getSuggestions({
        country,
        input,
        locationInput,
        entityTypes: types,
      });
  
      res.json({ suggestions });
    } catch (err) {
      console.error("Suggest API error:", err);
      res.status(500).json({ error: "Internal server error" });
    } 
  });
  
  
  
// Get records by category
app.get('/api/getRecordsByCategory', async (req, res) => {
  try {
    const category = req.query.category;
    if (!category) return res.status(400).json({ error: "Category is required" });

    await client.connect();
    const records = await client
      .db("bbb_scrape")
      .collection("businesses")
      .find({ 
        $or: [
          { category: category },
          { businessCategories: { $regex: category, $options: "i" } }
        ]
      })
      .toArray();

    res.json(records);
  } catch (err) {
    console.error("Error fetching records by category:", err);
    res.status(500).json({ error: err.message });
  }
});


// Get records by organization
app.get('/api/getRecordsByOrganization', async (req, res) => {
  try {
    const organization = req.query.organization;
    if (!organization) return res.status(400).json({ error: "Organization is required" });

    await client.connect();
    const records = await client
      .db("bbb_scrape")
      .collection("businesses")
      .find({ name: { $regex: organization, $options: "i" } })
      .toArray();

    res.json(records);
  } catch (err) {
    console.error("Error fetching records by organization:", err);
    res.status(500).json({ error: err.message });
  }
});


  /* start server */
  app.listen(3000, () => {
    console.log("server is running");
    // runBatchScrape().catch((err) => {
    //   console.error('[scrape] top‑level error:', err);
    // });
  });

