// scrapeDetailsFromDB.js



const { MongoClient , ObjectId } = require("mongodb")
require('dotenv').config();
const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri);

const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const fetch = require('node-fetch');

 // or "puppeteer" if you're not using puppeteer-core

const fs = require("fs");
puppeteer.use(StealthPlugin());

async function scrapeEmailFromWebsite(url) {
    try {
      const response = await fetch(url, { timeout: 15000 });
      const body = await response.text();
      const match = body.match(
        /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/
      );
      return match ? match[0] : '';
    } catch (error) {
      console.error(`❌ Error fetching ${url}:`, error.message);
      return '';
    }
  }

async function updateEmails() {
    try {
      await client.connect();
      const db = client.db("bbb_scrape");
      const collection = db.collection("businesses");
  
      const cursor = collection.find({
        website: { $exists: true, $ne: '' },
        $or: [
          { email: { $exists: false } },
          { email: '' },
          { websiteEmail: { $exists: false } },
          { websiteEmail: '' }
        ]
      });
  
      while (await cursor.hasNext()) {
        const doc = await cursor.next();
        const email = await scrapeEmailFromWebsite(doc.website);
  
        if (email) {
          const update = {
            $set: {
              email: email,
              websiteEmail: email
            }
          };
  
          await collection.updateOne({ _id: doc._id }, update);
          console.log(`✅ Updated: ${doc.name} (${doc._id}) with email: ${email}`);
        } else {
          console.log(`⚠️  No email found for ${doc.name} (${doc._id})`);
        }
      }
    } catch (err) {
      console.error('❌ Error during update:', err);
    } finally {
      await client.close();
    }
  }
  

  updateEmails();
