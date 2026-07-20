const { MongoClient } = require("mongodb");

const uri = process.env.MONGODB_URI || "mongodb://localhost:27017";
const dbName = process.env.DB_NAME || "restropulse_landing";

let clientPromise = null;

async function connect() {
  if (!clientPromise) {
    // 15s: serverless cold starts need headroom for SRV DNS + TLS to Atlas.
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 });
    clientPromise = client.connect().catch(err => {
      clientPromise = null; // allow retry on next request
      console.error("[landing] Mongo connect failed:", err && err.message);
      throw err;
    });
  }
  const client = await clientPromise;
  return client.db(dbName);
}

module.exports = { connect };
