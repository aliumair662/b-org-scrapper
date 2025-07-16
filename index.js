/* index.js ─ start with:  node index.js  */
const express = require("express");
const cors = require("cors");
const fs = require("fs/promises");
const puppeteer = require("puppeteer");


process.on('unhandledRejection', (reason, p) => {
  console.error('[unhandledRejection]', reason);
});
process.on('uncaughtException', err => {
  console.error('[uncaughtException]', err);
  process.exit(1);                // optional but makes crashes obvious
});
const delay = (ms) => new Promise((res) => setTimeout(res, ms));

const app = express();
app.use(cors());
app.use(express.json());

const { insertData, testConnection, getAllData } = require("./db");
/* ‑‑‑‑‑‑‑‑‑‑‑‑  YOUR CATEGORY LIST  ‑‑‑‑‑‑‑‑‑‑‑‑ */
//testConnection();

const CATEGORIES = [
  "Roofing Contractors",
  // "Real Estate Consultant",
  // "General Contractor",
  // "Used Car Dealers",
  // "Heating Contractors",
  // "Air Conditioning Contractors",
  // "Auto Repairs",
  // "Financial Services",
  // "Tree Services",
];
const COUNTRIES = ["USA", "CAN"];
const FILE_FOR = (c) => `${c}.json`;

async function autoScroll(page) {
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        let pos = 0;
        const timer = setInterval(() => {
          window.scrollBy(0, 200);
          if ((pos += 200) >= document.body.scrollHeight - innerHeight) {
            clearInterval(timer);
            resolve();
          }
        }, 50);
      })
  );
}

/* scrape ONE page (returns array of rows) */
async function scrapeOnePage(page, url) {
  console.log(` ↳ visiting ${url}`);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  console.log("page loaded");
  
  await autoScroll(page);

  try{
    await page.waitForSelector(".card.result-card", { timeout: 60000 });

    console.log("found cards")

  }
catch{
  console.error('       ✖ no cards found on this page, selector might be outdated or page requires location');
  throw err;
}
  
  return page.$$eval(".card.result-card", (cards) =>
    cards.map((card) => {
      const q = (sel) => card.querySelector(sel);
      /* helper that runs IN the browser */
      const parseLoc = (raw = "") => {
        let street = "",
          city = "",
          state = "",
          zip = "";
        const parts = raw.split(",").map((s) => s.trim());
        if (parts.length === 3) {
          // street + city + ST ZIP
          street = parts[0];
          city = parts[1];
          [state, ...zip] = parts[2].split(/\s+/);
          zip = zip.join(" ");
        } else if (parts.length === 2) {
          // city + ST ZIP
          city = parts[0];
          [state, ...zip] = parts[1].split(/\s+/);
          zip = zip.join(" ");
        }
        return { street, city, state, zip };
      };

      const loc =
        q(".bds-body.text-size-5.text-gray-70")?.textContent.trim() || "";
      return {
        name: q(".result-business-name a")?.textContent.trim() || "",
        rating: q(".result-rating")?.textContent.trim() || "",
        location: loc,
        phone: q(".result-business-info a")?.textContent.trim() || "",
        link: q(".result-business-name a")?.href || "",
        ...parseLoc(loc),
      };
    })
  );
}

/* FULL scrape for one category (walks next‑page links) */
async function scrapeCategory(listPage, cat, country, detailPage) {
  let all = [];
  let url = `https://www.bbb.org/search?find_text=${encodeURIComponent(
    cat
  )}&find_loc=&find_country=${country}`;
  let pageNo = 1;

  while (url) {
    const rows = await scrapeOnePage(listPage, url);

    // After scraping one search-result page:
    for (const row of rows) {
      if (!row.link) continue; // safety
      const extra = await scrapeBusinessDetails(detailPage, row.link);
      Object.assign(row, extra); // merge detail fields into card
      await delay(800); // polite pause between requests
    }

    all.push(...rows);


 /* 4️⃣  👉  WRITE OUT THIS PAGE’S JSON  👈 */
//  const pageFile = `out/${country}_${cat.replace(/\s+/g, "_")}_page${pageNo}.json`;
//  await fs.mkdir("out", { recursive: true });        // ensure folder exists
//  await fs.writeFile(pageFile, JSON.stringify(rows, null, 2));
//  console.log(`       💾 saved ${rows.length} rows to ${pageFile}`);


 await insertData(rows);

    const next = await listPage
      .$eval('nav[aria-label="pagination"] a[rel="next"]', (a) => a?.href)
      .catch(() => null);
    url = next || null;
    pageNo++;
  }
  return all;
}

/* --------------  Scrape Business Detail Page  -------------- */

async function scrapeBusinessDetails(detailPage, url) {
  await detailPage.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });

  // Wait for something that only appears on detail pages
  await detailPage.waitForSelector("h1", { timeout: 20000 }).catch(() => {});

  return await detailPage.evaluate(async () => {
    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => Array.from(document.querySelectorAll(sel)).filter(Boolean);
    const text = (sel) => $(sel)?.textContent.trim() || "";


     /* ─── 1. collect ALL <a href="tel:…"> on the page ─── */
     const phoneLinks = $$('a[href^="tel:"]')
     .map((a) => a.textContent.trim())
     .filter((v, i, arr) => v && arr.indexOf(v) === i);   // dedupe

   /* rename them as phone1, phone2, … */
   const phoneFields = {};
   phoneLinks.forEach((num, idx) => {
     phoneFields[`phone${idx + 1}`] = num;
   });

    const websiteLink =
      document.querySelector(".bpr-header-contact a[href^='http']")?.href ||
      $("a[data-js='business-website']")?.href || // fallback
      "";

    // Extract address and email on the detail page
    const fullAddress =
      document.querySelector(".bpr-overview-address")?.textContent.trim() || "";

    // Extract owner/contact info dynamically
    const ownerKeys = [
      "Business Management",
      "Principal Contacts",
      "Customer Contacts",
      "Owner",
      "Owner & LLC Managing Member",
    ];
    const ownerInfo = {};

    // Query all <dt> elements inside .bpr-details
    const dtElements = Array.from(document.querySelectorAll(".bpr-details dt"));
    dtElements.forEach((dt) => {
      const label = dt.textContent.trim();
      if (ownerKeys.some((key) => label.includes(key))) {
        const ddElements = [];
        let el = dt.nextElementSibling;
        while (el && el.tagName === "DD") {
          ddElements.push(el.textContent.trim());
          el = el.nextElementSibling;
        }
        ownerInfo[label] = ddElements.join("; ");
      }
    });

    // Scrape email from website if there's a link
    let websiteEmail = "";
    if (websiteLink) {
      try {
        
        console.log("Fetching website:", websiteLink);
        // Open the business website
        const response = await fetch(websiteLink);
        const body = await response.text();

        // Use a regex to find any email address in the website HTML (you can customize this if needed)
        const emailMatch = body.match(
          /([a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,6})/
        );
        if (emailMatch) {
          websiteEmail = emailMatch[0];
        }
      } catch (error) {
        console.error("Error fetching website:", websiteLink, error);
      }
    }

    // Return all data together, include email from website if found
    return {
      fullAddress,
      email: websiteEmail, // If email from the page exists, use it, otherwise fallback to websiteEmail
      website: websiteLink,
      websiteEmail,
      ...phoneFields,   // Include email found from website
      ...ownerInfo,
    };
  });
}


/* ‑‑‑‑‑‑‑‑‑‑‑‑  BATCH endpoint  ‑‑‑‑‑‑‑‑‑‑‑‑ */
async function runBatchScrape() {
  console.log('[scrape] starting…');
  const browser = await puppeteer.launch({
    headless: "new",                     // modern headless mode
    defaultViewport: null,
    args: [
      "--no-sandbox",
      "--start-maximized",
      "--disable-blink-features=AutomationControlled",
    ],
  }).catch(err => {
        console.error('[scrape] puppeteer launch failed:', err);
        throw err;                              // bubble up
      });
      console.log('[scrape] browser launched');
  const listPage = await browser.newPage();
  await listPage.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36"
  );
  const detailPage = await browser.newPage();
  await detailPage.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36"
  );
  for (const country of COUNTRIES) {
        console.log(`[scrape] country ${country}`);
    let regionRows = [];

    for (const cat of CATEGORIES) {
        console.log(`  • category “${cat}”`);
      try {
        const rows = await scrapeCategory(listPage, cat, country, detailPage);
        regionRows.push(...rows);
      } catch (e) {
        // console.error(` ${cat} failed (${country}):`, e.message);
        // Error is caught silently
      }
      await delay(1500); // 1.5 s courtesy pause
    }
    console.log(`  → inserting ${regionRows.length} rows`);
    // await fs.writeFile(FILE_FOR(country), JSON.stringify(regionRows, null, 2));
    // await insertData(regionRows); // 👈 Save to MongoDB
    console.log(`  ✓ done with ${country}`);
  }
  await browser.close();
  console.log('[scrape] finished');
}

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

/* keep your old /scrape if you still want manual use */
app.post("/scrape", async (req, res) => {
  res
    .status(410)
    .json({ error: "Manual scrape disabled – use /batch-scrape instead." });
});

/* start server */
app.listen(3000, () => {
  // Auto trigger scraping when server boots up
  runBatchScrape().catch((err) => {
    // Error is caught silently here, nothing logged or handled
    console.error('[scrape] top‑level error:', err);
  });
});
