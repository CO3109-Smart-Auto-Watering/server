const mongoose = require("mongoose");

const feedSchema = new mongoose.Schema({
  feed_id: String,
  value: String,
  created_at: Date,
});

// Function to get a model for a specific feed dynamically
const getFeedModel = (feedName) => {
  return mongoose.model(feedName, feedSchema);
};

module.exports = getFeedModel;
