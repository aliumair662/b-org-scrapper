const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const fs = require("fs/promises");
const express = require("express");
const cors = require("cors");
const path = require("path");
const fetch = require('node-fetch');
puppeteer.use(StealthPlugin());

const app = express();
app.use(cors());
app.use(express.json());

const { MongoClient } = require("mongodb");
require("dotenv").config();
const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri);


process.on("unhandledRejection", (reason, p) => {
  console.error("[unhandledRejection]", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err);
  process.exit(1);
});
const delay = (ms) => new Promise((res) => setTimeout(res, ms));

const { insertData, testConnection, getAllData,shouldRunScrapper,resetScrapperFlag } = require("./db");
/* ‑‑‑‑‑‑‑‑‑‑‑‑  YOUR CATEGORY LIST  ‑‑‑‑‑‑‑‑‑‑‑‑ */
//testConnection();

const CATEGORIES = [
 "Roofing Contractors",
  "Real Estate Consultant",
  "General Contractor",
  "Used Car Dealers",
  "Heating Contractors",
  "Air Conditioning Contractors",
  "Auto Repairs",
  "Financial Services",
  "Tree Services",
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
console.debug("DEBUG: page.goto completed");

console.debug("DEBUG: Taking screenshot...");
await page.screenshot({ path: "debug-screenshot.png", fullPage: true });

//console.debug("DEBUG: Saving HTML content...");
//const html = await page.content();
//fs.writeFileSync("debug-page.html", html);

const title = await page.title();
console.log(`📄 Page title: ${title}`);

const heading = await page.$eval('h1', el => el.innerText).catch(() => '');
console.log(`📌 Heading: ${heading}`);

console.log("page loaded");

try {
  console.debug("DEBUG: Waiting for category title selector...");
  await page.waitForSelector(".bds-h1.search-results-category-title", { timeout: 10000 });

  console.debug("DEBUG: Waiting for summary heading selector...");
  await page.waitForSelector(".search-results-heading", { timeout: 10000 });

  console.debug("DEBUG: Attempting to grab category element...");
  const categoryElement = await page.$(".bds-h1.search-results-category-title");

  console.debug("DEBUG: Attempting to grab summary element...");
  const summaryElement = await page.$(".search-results-heading");

  if (categoryElement && summaryElement) {
    console.debug("DEBUG: Extracting category title text...");
    const categoryTitle = await page.evaluate(el => el.textContent.trim(), categoryElement);

    console.debug("DEBUG: Extracting summary text...");
    const resultSummary = await page.evaluate(
      el => el.textContent.trim().replace(/\s+/g, " "),
      summaryElement
    );

    console.log(`✔ Category: ${categoryTitle}`);
    console.log(`✔ Summary: ${resultSummary}`);
  } else {
    console.warn("⚠ Category or Summary element not found.");
    if (!categoryElement) console.debug("DEBUG: categoryElement is null");
    if (!summaryElement) console.debug("DEBUG: summaryElement is null");
  }
} catch (err) {
  console.error("✖ Failed to extract category or result summary", err);
}


  await autoScroll(page);

  try {
    await page.waitForSelector(".card.result-card", { timeout: 60000 });
    console.log("found cards");
  } catch (err) {
    console.error(
      "✖ No cards found on this page. Selector might be outdated or page requires location."
    );
    throw err;
  }
  console.debug("🧹 Parsing result card details...");
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
        //Check for "Accredited Business"
      const accredited = !!card.querySelector('img[alt="Accredited Business"]');
      return {
        name: q(".result-business-name a")?.textContent.trim() || "",
        rating: q(".result-rating")?.textContent.trim() || "",
        location: loc,
        phone: q(".result-business-info a")?.textContent.trim() || "",
        link: q(".result-business-name a")?.href || "",
        accredited:accredited,
        ...parseLoc(loc),
      };
    })
  );
}


/* ‑‑‑‑‑‑‑‑‑‑‑‑  BATCH endpoint  ‑‑‑‑‑‑‑‑‑‑‑‑ */
async function runBatchScrape() {
  const shouldRun = await shouldRunScrapper();
  if (!shouldRun) {
    console.log("⏹ Scrapper run flag is false. Not starting scraping.");
    return;
  }
  console.log("[scrape] starting…");
  const browser = await puppeteer
    .launch({
      headless: "new",
      defaultViewport: null,
      args: [
        "--no-sandbox",
        "--start-maximized",
        "--disable-blink-features=AutomationControlled",
      ],
    })
    .catch((err) => {
      console.error("[scrape] puppeteer launch failed:", err);
      throw err;
    });
  console.log("[scrape] browser launched");
  const listPage = await browser.newPage();
  await listPage.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36"
  );
  
  const detailPage = await browser.newPage();
  await detailPage.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36"
  );

  await listPage.setExtraHTTPHeaders({
    "Accept-Language": "en-US,en;q=0.9",
  });
  
  await detailPage.setExtraHTTPHeaders({
    "Accept-Language": "en-US,en;q=0.9",
  });

  try {
    await client.connect();
    const db = client.db("bbb_scrape");
    const categoriesCol = db.collection("categories");

    // 👉 Fetch only un-scraped categories
    const categories = await categoriesCol.find({ scraped: { $ne: true } }).toArray();
    console.log(`[scrape] Found ${categories.length} categories to scrape`);

    for (const cat of categories) {
      console.log(`  • category “${cat.name}”`);
      try {
        await scrapeCategoryFromLink(listPage, cat, detailPage, db);
      } catch (e) {
        console.error(`❌ ${cat.name} failed:`, e.message);
      }
      await delay(1500);
    }

    console.log("✅ Done with all categories.");
  } catch (err) {
    console.error("❌ runScraper error:", err);
  } finally {
    await client.close();
  }
  await browser.close();
  console.log("[scrape] finished");
}

async function scrapeCategoryFromLink(listPage, catDoc, detailPage, db) {
  let all = [];
  let url = catDoc.link;
  let pageNo = 1;

  console.log(`🔍 Starting scrape for category "${catDoc.name}" (${url})`);

  while (url) {
    console.log(`➡ Scraping page ${pageNo}: ${url}`);

    const rows = await scrapeOnePage(listPage, url);
    console.log(`📦 Found ${rows.length} listings on page ${pageNo}`);

    rows.forEach((row) => {
      row.category = catDoc.name;
      row.categoryLink = catDoc.link;
    });

    all.push(...rows);
    await insertData(rows);
    console.log(`✅ Page ${pageNo} processed and inserted.`);

    const next = await listPage
      .$eval('nav[aria-label="pagination"] a[rel="next"]', (a) => a?.href)
      .catch(() => null);

    url = next || null;
    pageNo++;
  }

  // ✅ Mark this category as scraped
  await db.collection("categories").updateOne(
    { _id: catDoc._id },
    { $set: { scraped: true, scrapedAt: new Date() } }
  );

  console.log(
    `🏁 Finished scraping "${catDoc.name}". Total records: ${all.length}`
  );
  return all;
}


/* start server */
runBatchScrape();

