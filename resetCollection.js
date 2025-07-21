// resetCollection.js
const { MongoClient } = require("mongodb");
require("dotenv").config();

const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri);

async function resetCollection() {
  try {
    await client.connect();
    const db = client.db("bbb_scrape");
    const collection = db.collection("businesses");

    const result = await collection.deleteMany({});
    console.log(`🗑️ Deleted ${result.deletedCount} documents from "businesses" collection.`);
  } catch (err) {
    console.error("❌ Error while resetting collection:", err);
  } finally {
    await client.close();
  }
}

resetCollection();
