const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    await mongoose.connect('mongodb://localhost:27017/MovieDB');
    console.log("Successfully connected to Data Base");
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  }
};

module.exports = connectDB;
