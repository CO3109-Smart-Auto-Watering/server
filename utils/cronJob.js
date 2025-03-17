const cron = require("node-cron");
const axios = require("axios");
const getFeedModel = require("../models/FeedModel"); // Import dynamic model function

// Adafruit IO credentials
const AIO_USERNAME = process.env.AIO_USERNAME;
const AIO_KEY = process.env.AIO_KEY;

// List of feeds to track
const FEEDS = ["temperature", "humidity", "soil-moisture"]; // Add more feed names if needed

const fetchDataAndStore = async () => {
  try {
    for (const feed of FEEDS) {
      const response = await axios.get(
        `https://io.adafruit.com/api/v2/${AIO_USERNAME}/feeds/${feed}/data?limit=1`,
        {
          headers: { "X-AIO-Key": AIO_KEY },
        }
      );

      if (response.data.length > 0) {
        const feedData = response.data[0];

        // Get dynamic model based on feed name
        const FeedModel = getFeedModel(feed);

        // Check for duplicate entry
        const existingEntry = await FeedModel.findOne({ created_at: feedData.created_at });

        if (!existingEntry) {
          // Store data in corresponding collection
          await FeedModel.create({
            feed_id: feedData.feed_id,
            value: feedData.value,
            created_at: feedData.created_at,
          });

          console.log(`Data saved for ${feed}: ${feedData.value} at ${feedData.created_at}`);
        } else {
          console.log(`Duplicate entry detected for ${feed} at ${feedData.created_at}, skipping...`);
        }
      }
    }
  } catch (error) {
    console.error("Error fetching Adafruit IO data:", error.message);
  }
};

// Schedule the cron job (every 2 minutes)
cron.schedule("*/2 * * * *", async () => {
  console.log("Fetching Adafruit IO data...");
  await fetchDataAndStore();
});

module.exports = fetchDataAndStore;
