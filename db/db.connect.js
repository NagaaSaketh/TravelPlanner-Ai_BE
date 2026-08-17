const mongoose = require("mongoose");
require("dotenv").config();

const mongoUri = process.env.MONGO_URI;

const initialiseDB = async () => {
  await mongoose
    .connect(mongoUri)
    .then(() => console.log("Database connected successfully!"))
    .catch((err) => console.log("Error connecting to database", err.message));
};

module.exports = { initialiseDB };
