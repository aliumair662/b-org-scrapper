const { MongoClient } = require("mongodb")
require('dotenv').config();
const uri = process.env.MONGODB_URI;
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

    const operations = data.map(item => ({
      updateOne: {
        filter: { link: item.link }, // Use a unique identifier like 'link' or 'name'
        update: { $set: item },
        upsert: true
      }
    }));

    await collection.bulkWrite(operations, { ordered: false });
  } catch (err) {
    console.error("❌ DB insert/update error:", err);
  } finally {
    await client.close();
  }
}


async function runScrapper() {
  try {
    await client.connect();
    await client.db().admin().ping();

    const db = client.db("bbb_scrape");
    const collection = db.collection("settings");

    const payload = {
      scrapper_run: true,
      scrapper_running: true,
      updatedAt: new Date(),
    };

    const existingDoc = await collection.findOne();

    if (!existingDoc) {
      await collection.insertOne(payload);
    } else {
      await collection.updateOne({ _id: existingDoc._id }, { $set: payload });
    }
    return { success: true, msg: "Scrapper is running now." };
  } catch (err) {
    console.error("[runScrapper] error:", err.message);
  } finally {
    await client.close();
  }
}
async function getAllData(req) {
  const { q, near, country } = req.query;

  try {
    await client.connect();
    const db = client.db("bbb_scrape");
    const collection = db.collection("businesses");
    const settings = await db.collection("settings").findOne();

    const match = {};

    if (q) {
      match.category = { $regex: new RegExp(q, "i") };
    }

    if (country) {
      match.country = country;
    }

    // if (near) {
    //   const parts = near.split(",").map((s) => s.trim());

    //   if (parts.length === 2) {
    //     match.state = { $regex: new RegExp(`^${parts[0]}`, "i") };
    //     match.city = { $regex: new RegExp(`^${parts[1]}`, "i") };
    //   } else if (parts.length === 1 && parts[0] !== "") {
    //     const regex = new RegExp(parts[0], "i");
    //     match.$or = [{ state: { $regex: regex } }, { city: { $regex: regex } }];
    //   }
    // }

    const results = await collection.find(match).toArray();

    return { results, settings };
  } catch (err) {
    console.error("[getAllData] error:", err.message);
    return [];
  } finally {
    await client.close();
  }
}

async function getNears(country, nearQuery) {
  try {
    await client.connect();
    const db = client.db("bbb_scrape");
    const collection = db.collection("businesses");

    const matchConditions = [];

    if (country) {
      matchConditions.push({ country });
    }

    // Filter out empty state and city
    matchConditions.push(
      { state: { $exists: true, $ne: "" } },
      { city: { $exists: true, $ne: "" } }
    );

    // Add regex condition if nearQuery is provided
    if (nearQuery) {
      const regex = new RegExp(nearQuery, "i"); // case-insensitive
      matchConditions.push({
        $or: [{ state: { $regex: regex } }, { city: { $regex: regex } }],
      });
    }

    const results = await collection
      .aggregate([
        { $match: { $and: matchConditions } },
        {
          $project: {
            _id: 0,
            combo: { $concat: ["$state", ", ", "$city"] },
          },
        },
        { $group: { _id: "$combo" } },
        { $sort: { _id: 1 } },
      ])
      .toArray();

    return results.map((r) => r._id);
  } catch (err) {
    console.error("[getNears] error:", err.message);
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
async function shouldRunScrapper() {
  try {
    await client.connect();
    const db = client.db("bbb_scrape");
    const collection = db.collection("settings");

    const setting = await collection.findOne();
    return setting?.scrapper_run === true;
  } catch (err) {
    console.error("[shouldRunScrapper] Error:", err);
    return false;
  } finally {
    await client.close();
  }
}
async function resetScrapperFlag() {
  try {
    await client.connect();
    const db = client.db("bbb_scrape");
    const collection = db.collection("settings");

    await collection.updateOne({}, {
      $set: {
        scrapper_run: false,
        scrapper_running: false,
        updatedAt: new Date()
      }
    });
    console.log("✅ Scrapper flags reset in DB.");
  } catch (err) {
    console.error("[resetScrapperFlag] Error:", err);
  } finally {
    await client.close();
  }
}

async function getIncompleteRecords(limit = 50) {
  await client.connect();
  const db = client.db("bbb_scrape");
  const collection = db.collection("businesses");

  return await collection
    .find({
      $or: [
        { fullAddress: { $exists: false } },
        { fullAddress: "" },
        { website: { $exists: false } },
        { website: "" },
      ],
    })
    .limit(limit)
    .toArray();
}



module.exports = {
  insertData,
  testConnection,
  getAllData,
  getNears,
  runScrapper,
  shouldRunScrapper,
  resetScrapperFlag,
  getIncompleteRecords,
};
