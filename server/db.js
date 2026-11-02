const mongoose = require("mongoose");

const connectDB = async () => {
  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI is missing in server/.env");
  }

  await mongoose.connect(process.env.MONGO_URI);
  console.log("MongoDB connected");
};

module.exports = connectDB;
