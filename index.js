const express = require("express");
require("dotenv").config();
const OpenAI = require("openai");
const cors = require("cors");
const { initializeDB } = require("./db/db.connect");
const authRouter = require("./routes/auth");
const cookieParser = require("cookie-parser");
const userAuth = require("./middlewares/auth");
const Tour = require("./models/Tour");

const app = express();

app.use(express.json());
app.use(cookieParser());

app.use(
  cors({
    origin: process.env.CLIENT_URL,
    credentials: true,
  }),
);

app.use("/", authRouter);

initializeDB();
app.get("/", (req, res) => {
  res.send("AI-Travel Planner BE");
});

if (!process.env.OPENROUTER_API_KEY) {
  throw new Error("OPENROUTER_API_KEY missing in .env");
}

const client = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
});

const MODEL = "nvidia/nemotron-3-nano-30b-a3b:free";

const SYSTEM_PROMPT = `
You are an expert travel planner API.

Your job is to create a practical and realistic travel plan.

IMPORTANT:
Return ONLY one valid JSON object.

Do NOT return:
- Markdown
- Code fences
- Explanations
- Comments
- Text before JSON
- Text after JSON

The response must be directly parseable using JSON.parse().

Use EXACTLY this JSON structure:

{
  "starting_point": "city, country",
  "destination": "city, country",
  "best_time": "month or season - one short sentence explaining why",
  "duration_days": 0,
  "top_attractions": [
    "string",
    "string",
    "string"
  ],
  "sample_itinerary": [
    {
      "day": 1,
      "plan": "string"
    }
  ],
  "estimated_budget_USD": {
    "low": 0,
    "mid": 0,
    "high": 0
  },
  "local_tips": [
    "string",
    "string"
  ]
}

STRICT RULES:

1. starting_point MUST exactly match the starting point provided by the user.

2. destination MUST exactly match the destination provided by the user.

3. Do NOT translate, correct, rename, replace, or modify the city or country names.

4. duration_days MUST exactly equal the requested number of days.

5. sample_itinerary MUST contain EXACTLY the requested number of days.

6. sample_itinerary days MUST start at 1.

7. sample_itinerary days MUST be sequential.

8. There must be no missing or duplicate days.

9. Every itinerary day must contain a unique and realistic plan.

10. Day 1 should include realistic arrival/travel activities from the starting point to the destination.

11. The final day should include realistic departure or wind-down activities.

12. top_attractions MUST contain exactly 3 attractions.

13. estimated_budget_USD.low, mid and high MUST be numbers.

14. local_tips MUST contain useful and destination-specific information.

15. Do not put currency symbols inside budget values.

16. The itinerary should be realistic for the requested number of days.

17. Before returning the response, internally verify:
    - duration_days is correct
    - itinerary length is correct
    - itinerary starts at Day 1
    - itinerary ends at the requested day
    - there are no duplicate days
    - top_attractions has exactly 3 items
    - budget values are numbers

Return ONLY the JSON object.
`;

const parseLocation = (value) => {
  if (!value || typeof value !== "string") {
    return null;
  }

  const parts = value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length < 2) {
    return null;
  }

  const city = parts[0];
  const country = parts.slice(1).join(", ");

  if (!city || !country) {
    return null;
  }

  return {
    city,
    country,
  };
};

app.get("/api/travel-plan", userAuth, async (req, res) => {
  try {
    const startingCity = (req.query.startingCity || "").toString().trim();
    const startingCountry = (req.query.startingCountry || "").toString().trim();
    const city = (req.query.city || "").toString().trim();
    const country = (req.query.country || "").toString().trim();
    const days = Number(req.query.days);

    if (!startingCity || !startingCountry) {
      return res.status(400).json({
        message: "Starting point city and country are required.",
      });
    }

    if (!city || !country) {
      return res.status(400).json({
        message: "Destination city and country are required.",
      });
    }

    if (!Number.isInteger(days) || days < 1 || days > 10) {
      return res.status(400).json({
        message: "Days must be a number between 1 and 10.",
      });
    }

    const startingPoint = `${startingCity}, ${startingCountry}`;
    const destination = `${city}, ${country}`;

    if (
      startingCity.toLowerCase() === city.toLowerCase() &&
      startingCountry.toLowerCase() === country.toLowerCase()
    ) {
      return res.status(400).json({
        message: "Starting point and destination cannot be the same.",
      });
    }

    const userPrompt = `
Create a ${days}-day travel plan.

Starting point:
${startingPoint}

Destination:
${destination}

Number of days:
${days}

The starting point MUST remain exactly:
${startingPoint}

The destination MUST remain exactly:
${destination}

Do not change the city or country names.

Create exactly ${days} itinerary days.

Day 1 should include realistic travel or arrival activities from:
${startingPoint}

to:
${destination}

${
  days > 1
    ? `Day ${days} should include realistic departure, checkout, or wind-down activities.`
    : `Since this is a one-day trip, keep the itinerary realistic and concise.`
}

Return ONLY the required JSON object.
`;

    const response = await client.chat.completions.create({
      model: MODEL,
      messages: [
        {
          role: "system",
          content: SYSTEM_PROMPT,
        },
        {
          role: "user",
          content: userPrompt,
        },
      ],
    });

    const content = response.choices?.[0]?.message?.content || "";

    if (!content) {
      return res.status(502).json({
        message: "AI did not return a travel plan. Please try again.",
      });
    }

    let parsed;

    try {
      parsed = JSON.parse(content);
    } catch (err) {
      console.error("JSON parse failed:", err.message);
      console.error("Raw model output:", content);

      return res.status(502).json({
        message:
          "We couldn't generate your travel plan right now. Please try again.",
      });
    }

    parsed.starting_point = startingPoint;
    parsed.destination = destination;
    parsed.duration_days = days;

    if (!Array.isArray(parsed.sample_itinerary)) {
      return res.status(502).json({
        message: "AI returned an invalid itinerary.",
      });
    }

    if (parsed.sample_itinerary.length !== days) {
      return res.status(502).json({
        message: `AI returned ${parsed.sample_itinerary.length} itinerary days instead of ${days}.`,
      });
    }

    const validDayNumbers = parsed.sample_itinerary.every(
      (item, index) => item.day === index + 1,
    );

    if (!validDayNumbers) {
      return res.status(502).json({
        message: "AI returned invalid itinerary day numbers.",
      });
    }

    if (
      !Array.isArray(parsed.top_attractions) ||
      parsed.top_attractions.length !== 3
    ) {
      return res.status(502).json({
        message: "AI returned an invalid attractions list.",
      });
    }

    if (
      typeof parsed.estimated_budget_USD?.low !== "number" ||
      typeof parsed.estimated_budget_USD?.mid !== "number" ||
      typeof parsed.estimated_budget_USD?.high !== "number"
    ) {
      return res.status(502).json({
        message: "AI returned an invalid budget.",
      });
    }

    if (!Array.isArray(parsed.local_tips)) {
      return res.status(502).json({
        message: "AI returned invalid local tips.",
      });
    }

    const savedTour = await Tour.create({
      user: req.user._id,
      starting_point: parsed.starting_point,
      destination: parsed.destination,
      best_time: parsed.best_time,
      duration_days: parsed.duration_days,
      top_attractions: parsed.top_attractions,
      sample_itinerary: parsed.sample_itinerary,
      estimated_budget_USD: parsed.estimated_budget_USD,
      local_tips: parsed.local_tips,
    });

    return res.status(200).json({
      ...parsed,
      tourId: savedTour._id,
    });
  } catch (err) {
    console.error("Travel plan error:", err);

    return res.status(500).json({
      message: "Something went wrong while generating your travel plan.",
      error: process.env.NODE_ENV !== "production" ? err.message : undefined,
    });
  }
});

app.get("/api/my-tours", userAuth, async (req, res) => {
  try {
    const tours = await Tour.find({
      user: req.user._id,
    }).sort({ createdAt: -1 });

    res.status(200).json({
      tours,
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      message: "Unable to fetch your tours.",
    });
  }
});

const PORT = 3000;

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
