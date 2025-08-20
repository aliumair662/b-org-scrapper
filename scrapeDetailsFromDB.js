// scrapeDetailsFromDB.js

const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");

// or "puppeteer" if you're not using puppeteer-core
const { getIncompleteRecords, insertData } = require("./db"); // You'll need to implement these
const fs = require("fs");
puppeteer.use(StealthPlugin());

async function scrapeBusinessDetails(detailPage, url) {
  console.debug(`🌐 Visiting detail page: ${url}`);
  try {
    await detailPage.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 90000,
    });

    await detailPage
      .waitForSelector("h1", { timeout: 20000 })
      .catch(() => console.warn("⚠️ No h1 found"));

    const data = await detailPage.evaluate(() => {
      const $ = (sel) => document.querySelector(sel);
      const $$ = (sel) =>
        Array.from(document.querySelectorAll(sel)).filter(Boolean);
      const text = (sel) => $(sel)?.textContent.trim() || "";

      const phoneLinks = $$('a[href^="tel:"]')
        .map((a) => a.textContent.trim())
        .filter((v, i, arr) => v && arr.indexOf(v) === i);

      const phoneFields = {};
      phoneLinks.forEach((num, idx) => {
        phoneFields[`phone${idx + 1}`] = num;
      });

      const websiteLink =
        document.querySelector(".bpr-header-contact a[href^='http']")?.href ||
        $("a[data-js='business-website']")?.href ||
        "";

      const fullAddress =
        document.querySelector(".bpr-overview-address")?.textContent.trim() ||
        "";

      const ownerKeys = [
        "Business Management",
        "Principal Contacts",
        "Customer Contacts",
        "Owner",
        "Owner & LLC Managing Member",
      ];

      const ownerInfo = {};
      const dtElements = Array.from(
        document.querySelectorAll(".bpr-details dt")
      );
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

      // Business Categories
      const categoryDt = Array.from(
        document.querySelectorAll(".bpr-details dt")
      ).find((dt) => dt.textContent.trim() === "Business Categories");
      let BusinessCategories = [];
      let related_Categories = "";
      if (categoryDt) {
        const dd = categoryDt.nextElementSibling;
        if (dd) {
          BusinessCategories = Array.from(dd.querySelectorAll("a")).map((a) => ({
            name: a.textContent.trim(),
            link: a.href
          }));

   // Create comma-separated string of category names
   related_Categories = BusinessCategories.map((c) => c.name).join(", ");

          
        }
      }

      return {
        fullAddress,
        website: websiteLink,
        ...phoneFields,
        ...ownerInfo,
        businessCategories: BusinessCategories,
        related_Categories
      };
    });

    return data;
  } catch (err) {
    console.error(`❌ scrapeBusinessDetails failed for ${url}`, err.message);
    try {
      await detailPage.screenshot({
        path: `error-${Date.now()}.png`,
        fullPage: true,
      });
    } catch (screenshotErr) {
      console.error("❌ Screenshot capture failed", screenshotErr.message);
    }
    return null;
  }
}

async function scrapeAllDetailsFromDB() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();

  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36"
  );
  await page.setExtraHTTPHeaders({
    "Accept-Language": "en-US,en;q=0.9",
  });

  const records = await getIncompleteRecords();
  console.log(`🔍 Found ${records.length} records to update`);

  for (const [i, record] of records.entries()) {
    console.log(`🔗 (${i + 1}/${records.length}) Visiting: ${record.link}`);

    try {
      const detailData = await scrapeBusinessDetails(page, record.link);

      if (detailData) {
        // Combine original record + new detail fields
        const updatedRecord = { ...record, ...detailData };
        await insertData(updatedRecord);

        console.log("updated record", updatedRecord)
        console.log(`✅ Upserted record: ${record.link}`);
      } else {
        console.warn(`⚠️ No detail data for: ${record.link}`);
      }
    } catch (err) {
      console.error(`❌ Failed scraping/updating ${record.link}`, err);
    }

    await new Promise((r) => setTimeout(r, 1000)); // delay to avoid bans
  }

  await browser.close();
  console.log("🏁 Done processing all records.");
}

scrapeAllDetailsFromDB();
