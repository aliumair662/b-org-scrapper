const { MongoClient } = require("mongodb");
require("dotenv").config();
const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri);

async function insertData(data) {
  try {
    if (!data) return;

    await client.connect();
    await client.db().admin().ping();
    const db = client.db("bbb_scrape");
    const businessesCol = db.collection("businesses");
    const categoriesCol = db.collection("categories");

    // 🔥 Always normalize into array
    const items = Array.isArray(data) ? data : [data];

    // 1. Bulk upsert businesses
    const businessOps = items.map((item) => ({
      updateOne: {
        filter: { link: item.link }, // Use 'link' as unique identifier
        update: { $set: item },
        upsert: true,
      },
    }));

    if (businessOps.length > 0) {
      await businessesCol.bulkWrite(businessOps, { ordered: false });
    }

    // 2. Bulk upsert categories (deduplicate first)
    const allCategories = items.flatMap((item) => item.businessCategories || []);
    const uniqueCats = Array.from(
      new Map(allCategories.map((c) => [c.name + "|" + c.link, c])).values()
    );

    const categoryOps = uniqueCats.map((cat) => ({
      updateOne: {
        filter: { name: cat.name, link: cat.link },
        update: { $setOnInsert: { name: cat.name, link: cat.link } },
        upsert: true,
      },
    }));

    if (categoryOps.length > 0) {
      await categoriesCol.bulkWrite(categoryOps, { ordered: false });
    }

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

    if (near) {
      const parts = near.split(",").map((s) => s.trim());
    
      if (parts.length === 2) {
        const city = parts[0];
        const state = parts[1];
      
        match.city = { $regex: new RegExp(`^${city}$`, "i") };
        match.state = { $regex: new RegExp(`^${state}$`, "i") };
      } else if (parts.length === 1 && parts[0] !== "") {
        const regex = new RegExp(parts[0], "i");
        match.$or = [{ state: regex }, { city: regex }];
      }
    }
    
    const results = await collection.find(match).toArray();

    return { results, settings };
  } catch (err) {
    console.error("[getAllData] error:", err.message);
    return [];
  } finally {
    
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
            combo: { $concat: ["$city", ", ", "$state"] },
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

    await collection.updateOne(
      {},
      {
        $set: {
          scrapper_run: false,
          scrapper_running: false,
          updatedAt: new Date(),
        },
      }
    );
    console.log("✅ Scrapper flags reset in DB.");
  } catch (err) {
    console.error("[resetScrapperFlag] Error:", err);
  } finally {
    await client.close();
  }
}

async function getIncompleteRecords(limit = 5000) {
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

async function getSuggestions({ country, input, locationInput, entityTypes }) {
  await client.connect();
  const db = client.db("bbb_scrape");

  let city = null,
    state = null;
  if (locationInput && locationInput.trim() !== "") {
    const parts = locationInput.split(",").map((s) => s.trim());
    if (parts.length === 2) {
      city = parts[0];
      state = parts[1];
    } else if (parts.length === 1) {
      city = parts[0];
    }
  }

  const regexInput = new RegExp(input, "i");
  const suggestions = [];

  // Helper function to build location filter
  function addLocationFilter(matchObj) {
    if (city && state) {
      // Require both to match
      matchObj.$and = [
        { city: { $regex: new RegExp(`^${city}\\b`, "i") } },
        { state: { $regex: new RegExp(`^${state}\\b`, "i") } },
      ];
    } else if (city) {
      matchObj.city = { $regex: new RegExp(city, "i") };
    } else if (state) {
      matchObj.state = { $regex: new RegExp(state, "i") };
    }
  }

  // Category search
  if (entityTypes.includes("Category")) {
    const categoryMatch = {
      country,
      $or: [
        { category: { $regex: regexInput } },
        { related_Categories: { $regex: regexInput } },
      ],
    };
    addLocationFilter(categoryMatch);

    const categories = await db
      .collection("businesses")
      .find(categoryMatch)
      .limit(10)
      .toArray();

      const seen = new Set(); // 👈 keeps track of unique category titles

    categories.forEach((cat) => {
      // Push primary category
      if (cat.category && regexInput.test(cat.category)) {
        const title = cat.category.trim();
        if (!seen.has(title)) {
          seen.add(title);
        suggestions.push({
          id: `category_${cat._id}`,
          entityId: cat._id.toString(),
          type: "Category",
          title: cat.category,
          url: cat.url || null,
        });
      }
    }

      // Also push each matching businessCategory (if comma separated string)
      if (cat.related_Categories) {
        const parts = cat.related_Categories.split(",").map((s) => s.trim());
        parts.forEach((p) => {
          if (p && regexInput.test(p) && !seen.has(p)) {
            seen.add(p);
            suggestions.push({
              id: `businessCategory_${cat._id}_${p}`,
              entityId: cat._id.toString(),
              type: "Category",
              title: p,
              url: cat.url || null,
            });
          }
        });
      }
    });
  }
  // Organization search
  if (entityTypes.includes("Organization")) {
    const orgMatch = { country, name: { $regex: regexInput } };
    addLocationFilter(orgMatch);

    const orgs = await db
      .collection("businesses")
      .find(orgMatch)
      .limit(10)
      .toArray();

    orgs.forEach((org) => {
      suggestions.push({
        id: `org_${org._id}`,
        entityId: org._id.toString(),
        type: "Organization",
        title: org.name,
        secondaryTitle: org.fullAddress || null,
        url: org.url || null,
      });
    });
  }

  await client.close();
  return suggestions;
}

module.exports = {
  client,
  insertData,
  testConnection,
  getAllData,
  getNears,
  runScrapper,
  shouldRunScrapper,
  resetScrapperFlag,
  getIncompleteRecords,
  getSuggestions,
};
