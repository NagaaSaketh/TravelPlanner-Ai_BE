const mongoose = require("mongoose");

const mongo = process.env.MONGO_URI;

const initializeDB = async () => {
  await mongoose
    .connect(mongo)
    .then(() => console.log("Database connected successfully!"))
    .catch((err) => console.log("Error connecting to db", err));
};

module.exports = { initializeDB };
