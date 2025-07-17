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
    const db = client.db("bbb_scrape");
    const collection = db.collection("businesses");
    await collection.insertMany(data, { ordered: false });
  } catch (err) {
    // Error is caught silently
  } finally {
    await client.close();
  }
}

async function getAllData() {
  try {
    await client.connect();
    const db = client.db("bbb_scrape");      
    const collection = db.collection("businesses");
    return await collection.find({}).limit(1000).toArray();
  } catch (err) {
    console.error("[getAllData] error:", err.message);
    return [];
  } finally {
    await client.close();
  }
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
