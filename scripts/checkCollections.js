require('dotenv').config();
const mongoose = require('mongoose');

mongoose.connect(process.env.MONGO_URI)
  .then(async () => {
    console.log('MongoDB Connected');
    
    try {
      // List all collections in the database
      const collections = await mongoose.connection.db.listCollections().toArray();
      console.log('Available collections:');
      collections.forEach(collection => {
        console.log(`- ${collection.name}`);
      });
      
      // Check counts for specific collections
      const knownCollections = [
        'sensor-temp', 
        'sensor-humidity', 
        'sensor-soil', 
        'pump-motor'
      ];
      
      console.log('\nCollection counts:');
      for (const collection of knownCollections) {
        if (collections.some(c => c.name === collection)) {
          const count = await mongoose.connection.db.collection(collection).countDocuments();
          console.log(`- ${collection}: ${count} documents`);
          
          // Show a sample document if collection is not empty
          if (count > 0) {
            const sample = await mongoose.connection.db.collection(collection)
              .findOne({}, { sort: { createdAt: -1 } });
            console.log(`  Last document: ${JSON.stringify(sample)}`);
          }
        } else {
          console.log(`- ${collection}: COLLECTION NOT FOUND`);
        }
      }
      
    } catch (error) {
      console.error('Error checking collections:', error);
    } finally {
      mongoose.disconnect();
    }
  })
  .catch(err => console.error('MongoDB Connection Error:', err));