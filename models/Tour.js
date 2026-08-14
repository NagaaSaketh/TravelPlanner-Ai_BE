const mongoose = require("mongoose");

const tourSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    starting_point: {
      type: String,
      required: true,
    },
    destination: {
      type: String,
      required: true,
    },
    best_time: {
      type: String,
      required: true,
    },
    duration_days: {
      type: Number,
      required: true,
    },
    top_attractions: {
      type: [String],
      required: true,
    },
    sample_itinerary: [
      {
        day: Number,
        plan: String,
      },
    ],
    estimated_budget_USD: {
      low: Number,
      mid: Number,
      high: Number,
    },
    local_tips: {
      type: [String],
      required: true,
    },
  },
  {
    timestamps: true,
  },
);

const Tour = mongoose.model("Tour", tourSchema);

module.exports = Tour;
