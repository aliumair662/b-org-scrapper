// test.js
const puppeteer = require("puppeteer");
const fs = require("fs/promises");

(async () => {
  const url = "https://www.bbb.org/us/oh/columbus/profile/home-improvement/mdg-contractors-group-0302-70129939";

  const browser = await puppeteer.launch({ headless: "new" }); // Use `true` if you're using an older Puppeteer version
  const page = await browser.newPage();

  try {
    console.log("🔗 Visiting URL...");
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });

    console.log("📸 Taking screenshot...");
    await page.screenshot({ path: "screenshot.png", fullPage: true });
    console.log("✅ Screenshot saved as 'screenshot.png'");
  } catch (err) {
    console.error("❌ Error visiting or capturing:", err);
  } finally {
    await browser.close();
  }
})();
