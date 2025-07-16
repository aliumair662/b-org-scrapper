// db.js
const { MongoClient } = require("mongodb");

const uri = "mongodb://127.0.0.1:27017";

const client = new MongoClient(uri);

async function insertData(data) {
  try {
    if (!Array.isArray(data) || data.length === 0) {
      return;
    }

    await client.connect();
    await client.db().admin().ping();
    const db = client.db("bbb_scrape"); // database name
    const collection = db.collection("businesses"); // collection name
    const result = await collection.insertMany(data, { ordered: false });
  } catch (err) {
    // Error is caught silently
  } finally {
    await client.close();
  }
}

async function getAllData() {
  await client.connect(); // Optional: if not already connected
  const db = client.db("bbb_scrape");
  const collection = db.collection("businesses");
  return await collection.find({}).limit(1000).toArray(); // limit to avoid overload
}

async function testConnection() {
  try {
    await client.connect();
    await client.close();
  } catch (err) {
    // Error is caught silently
  }
}

module.exports = { insertData, testConnection, getAllData };
