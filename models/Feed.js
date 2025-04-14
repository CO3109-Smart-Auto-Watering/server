const mongoose = require("mongoose");

// Function to get a model for a specific feed dynamically
const getFeedModel = (feedName) => {
  const feedSchema = new mongoose.Schema({
    // User ID to associate the feed with a specific user
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false,
    },
    // Optional device ID to associate with a specific device
    deviceId: {
      type: String,
      required: true,
      index: true
    },
    value: String,
    createdAt: {
      type: Date,
      default: Date.now
    }
  }, { collection: feedName });  // Explicitly set the collection name
  
  // Try to return existing model or create a new one
  try {
    return mongoose.model(feedName);
  } catch (e) {
    // Model doesn't exist yet, create it
    return mongoose.model(feedName, feedSchema);
  }
};

module.exports = getFeedModel;