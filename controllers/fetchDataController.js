const axios = require("axios");
const mongoose = require("mongoose");
const getFeedModel = require("../models/FeedModel");

// Adafruit API details

const AIO_USERNAME = process.env.AIO_USERNAME;  
const AIO_KEY = process.env.AIO_KEY; 
const FEED_NAMES = ["sensor-humidity", "sensor-soil", "sensor-temp"]; // List of feed names

const fetchData = async () => {
  try {
    for (const feedName of FEED_NAMES) {
      const url = `https://io.adafruit.com/api/v2/${AIO_USERNAME}/feeds/${feedName}/data?limit=1`;
      
      const response = await axios.get(url, {
        headers: { "X-AIO-Key": AIO_KEY },
      });

      if (response.data.length > 0) {
        const latestData = response.data[0];
        const FeedModel = getFeedModel(feedName);

        // Save data to the corresponding collection
        await FeedModel.create({
          value: latestData.value,
          createdAt: new Date(latestData.created_at),
        });

        console.log(`Data saved to ${feedName} collection:`, latestData.value);
      }
    }
  } catch (error) {
    console.error("Error fetching data:", error.message);
  }
};

module.exports = fetchData;
