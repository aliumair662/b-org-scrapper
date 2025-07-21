const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");

puppeteer.use(StealthPlugin());

(async () => {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();

  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36"
  );

  await page.setExtraHTTPHeaders({
    "Accept-Language": "en-US,en;q=0.9",
  });

  const url = "https://www.bbb.org/us/tx/frisco/profile/general-contractor/mtr-contractors-inc-0875-90464752";

  console.log("🔗 Visiting URL...");
  await page.goto(url, { waitUntil: "networkidle2", timeout: 90000 });

  console.log("📸 Taking screenshot...");
  await page.screenshot({ path: "screenshot.png", fullPage: true });

  await browser.close();
})();
