// resetCollection.js
const { MongoClient } = require("mongodb");
require("dotenv").config();

const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri);

async function resetCollection() {
  try {
    await client.connect();
    const db = client.db("bbb_scrape");

    // Delete all businesses
    const businesses = db.collection("businesses");
    const deleteResult = await businesses.deleteMany({});
    console.log(`🗑️ Deleted ${deleteResult.deletedCount} documents from "businesses"`);

    // Update or insert settings document
    const settings = db.collection("settings");
    const payload = {
      scrapper_run: false,
      scrapper_running: false,
      updatedAt: new Date(),
    };

      const existingDoc = await settings.findOne();
  
      if (!existingDoc) {
        await collection.insertOne(payload);
      } else {
        await collection.updateOne({ _id: existingDoc._id }, { $set: payload });
      }

    console.log("⚙️ Updated scraper flags in 'settings' collection.");
  } catch (err) {
    console.error("❌ Error:", err);
  } finally {
    await client.close();
  }
}

resetCollection();
