// migrateCategories.js
const { MongoClient } = require("mongodb");

const uri = "mongodb://localhost:27017"; // change if needed
const client = new MongoClient(uri);

async function migrateCategories() {
  try {
    await client.connect();
    const db = client.db("bbb_scrape");
    const businesses = db.collection("businesses");

    const cursor = businesses.find({});
    let updatedCount = 0;

    while (await cursor.hasNext()) {
      const doc = await cursor.next();

      if (Array.isArray(doc.businessCategories) && doc.businessCategories.length > 0) {
        // Extract names
        const names = doc.businessCategories
          .map((bc) => bc.name?.trim())
          .filter(Boolean);

        if (names.length > 0) {
          const related = names.join(", ");

          await businesses.updateOne(
            { _id: doc._id },
            { $set: { related_Categories: related } }
          );

          updatedCount++;
        }
      }
    }

    console.log(`✅ Migration finished. Updated ${updatedCount} documents.`);
  } catch (err) {
    console.error("❌ Migration error:", err);
  } finally {
    await client.close();
  }
}

migrateCategories();
