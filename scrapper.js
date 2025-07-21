const puppeteer = require("puppeteer");
const fs = require("fs/promises");
const express = require("express");
const cors = require("cors");
const path = require("path");
const fetch = require('node-fetch');

const app = express();
app.use(cors());
app.use(express.json());

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
      if (!row.link) continue;
      const extra = await scrapeBusinessDetails(detailPage, row.link);
      Object.assign(row, extra);
      row.category = cat;
      row.country = country;
      await delay(800);
    }

    all.push(...rows);

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

  // Wait for key selector
  await detailPage.waitForSelector("h1", { timeout: 20000 }).catch(() => {});

  const data = await detailPage.evaluate(() => {
    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) =>
      Array.from(document.querySelectorAll(sel)).filter(Boolean);
    const text = (sel) => $(sel)?.textContent.trim() || "";

    const phoneLinks = $$('a[href^="tel:"]')
      .map((a) => a.textContent.trim())
      .filter((v, i, arr) => v && arr.indexOf(v) === i); // dedupe

    const phoneFields = {};
    phoneLinks.forEach((num, idx) => {
      phoneFields[`phone${idx + 1}`] = num;
    });

    const websiteLink =
      document.querySelector(".bpr-header-contact a[href^='http']")?.href ||
      $("a[data-js='business-website']")?.href ||
      "";

    const fullAddress =
      document.querySelector(".bpr-overview-address")?.textContent.trim() || "";

    const ownerKeys = [
      "Business Management",
      "Principal Contacts",
      "Customer Contacts",
      "Owner",
      "Owner & LLC Managing Member",
    ];
    const ownerInfo = {};
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

    return {
      fullAddress,
      website: websiteLink,
      ...phoneFields,
      ...ownerInfo,
    };
  });

  // 🔍 Fetch email from website (server-side)
  let websiteEmail = "";
  if (data.website) {
    // try {
     
    //   const response = await fetch(data.website, { timeout: 15000 });
    //   const body = await response.text();

    //   const match = body.match(
    //     /([a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,6})/
    //   );
    //   if (match) {
    //     websiteEmail = match[0];
    //   }
    // } catch (err) {
    //   console.error("❌ Error fetching website email:", err);
    // }
  }

  return {
    ...data,
    email: websiteEmail,
    websiteEmail,
  };
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
  for (const country of COUNTRIES) {
    console.log(`[scrape] country ${country}`);
    // let regionRows = [];

    for (const cat of CATEGORIES) {
      console.log(`  • category “${cat}”`);
      try {
        // const rows = await scrapeCategory(listPage, cat, country, detailPage);
        await scrapeCategory(listPage, cat, country, detailPage);
        // regionRows.push(...rows);
      } catch (e) {
        // console.error(` ${cat} failed (${country}):`, e.message);
        // Error is caught silently
      }
      await delay(1500); // 1.5 s courtesy pause
    }
    //console.log(`  → inserting ${regionRows.length} rows`);
    //await fs.writeFile(FILE_FOR(country), JSON.stringify(regionRows, null, 2));
    //await insertData(regionRows); // 👈 Save to MongoDB
    console.log(`  ✓ done with ${country}`);
  }
  await browser.close();
  console.log("[scrape] finished");
  await resetScrapperFlag();
}

/* start server */
app.listen(3001, () => {
  console.log("scrapper is running");
  runBatchScrape().catch((err) => {
    console.error("[scrape] top‑level error:", err);
  });
});
