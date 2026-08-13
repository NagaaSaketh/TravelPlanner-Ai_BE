const express = require("express");
require("dotenv").config();
const OpenAI = require("openai");
const cors = require("cors");
const { initializeDB } = require("./db/db.connect");
const authRouter = require("./routes/auth");
const cookieParser = require("cookie-parser");
const userAuth = require("./middlewares/auth");
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
You are an expert travel planner API. You output machine-readable data only.

OUTPUT FORMAT (strict):
- Output ONLY a single valid JSON object.
- No markdown, no code fences, no commentary, no text before or after the JSON.
- The JSON must be parseable by JSON.parse() with no post-processing.

SCHEMA:
{
  "starting_point": "city, country",
  "destination": "city, country",
  "best_time": "month or season - one short sentence explaining why",
  "duration_days": number,
  "top_attractions": [string, string, string],
  "sample_itinerary": [
    { "day": number, "plan": string }
  ],
  "estimated_budget_USD": { "low": number, "mid": number, "high": number },
  "local_tips": [string, string]
}

HARD CONSTRAINTS:
1. "destination" and "starting_point" must be copied exactly as given by the user — never translate, correct, or substitute them.
2. "duration_days" must equal the requested number of days exactly.
3. "sample_itinerary" must contain exactly one object per requested day, numbered 1 to N with no gaps, duplicates, or skipped days — regardless of how many days are requested (this applies equally whether N is 3, 7, or 10).
4. Each day's "plan" must be distinct and reflect realistic pacing (e.g. arrival logistics on day 1, departure logistics on the last day).
5. "top_attractions" must contain exactly 3 items.
6. "estimated_budget_USD" values must be plain numbers (no currency symbols, no strings).
7. "local_tips" must be specific to the destination, not generic travel advice.

Before outputting, internally verify the itinerary array length matches duration_days. If it doesn't, fix it before responding.
`;

const validDestinations = {
  Paris: "France",
  London: "United Kingdom",
  "New York": "United States",
  Tokyo: "Japan",
  Dubai: "United Arab Emirates",
  Singapore: "Singapore",
  Rome: "Italy",
  Barcelona: "Spain",
  Sydney: "Australia",
  Istanbul: "Turkey",
  Bangkok: "Thailand",
  Amsterdam: "Netherlands",
  "San Francisco": "United States",
  "Los Angeles": "United States",
  Toronto: "Canada",
  Vancouver: "Canada",
  Berlin: "Germany",
  Munich: "Germany",
  Zurich: "Switzerland",
  Vienna: "Austria",
  Seoul: "South Korea",
  "Hong Kong": "China",
  "Kuala Lumpur": "Malaysia",
  Bali: "Indonesia",
  "Cape Town": "South Africa",
};

app.get("/api/travel-plan", userAuth, async (req, res) => {
  const city = (req.query.city || "").toString().trim();
  const country = (req.query.country || "").toString().trim();
  const days = Number(req.query.days);
  const startingCity = (req.query.startingCity || "").toString().trim();
  const startingCountry = (req.query.startingCountry || "India")
    .toString()
    .trim();

  if (!startingCity) {
    return res.status(400).json({
      message: "Starting point is required.",
    });
  }

  if (startingCountry !== "India") {
    return res.status(400).json({
      message: "Starting point must be in India.",
    });
  }

  if (!city || !country) {
    return res.status(400).json({
      message: "City and country are required.",
    });
  }

  if (!validDestinations[city]) {
    return res.status(400).json({
      message: "Unsupported destination.",
    });
  }

  if (validDestinations[city] !== country) {
    return res.status(400).json({
      message: `Invalid destination: ${city} is not in ${country}.`,
    });
  }

  if (!Number.isInteger(days) || days < 1 || days > 10) {
    return res.status(400).json({
      message: "Days must be a number between 1 and 10.",
    });
  }

  const userPrompt = `
Generate a travel plan as JSON with these exact parameters:

starting_point: ${startingCity}, ${startingCountry}
destination: ${city}, ${country}
duration_days: ${days}

Requirements:
- sample_itinerary must have exactly ${days} entries (day 1 through day ${days}).
- Day 1 should account for travel/arrival from ${startingCity} to ${city}.
${days > 1 ? `- Day ${days} should account for departure or wind-down.` : ""}
- Do not alter the destination or starting point given above.
`;

  try {
    const response = await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
    });

    const content = response.choices?.[0]?.message?.content || "";
    try {
      const parsed = JSON.parse(content);
      parsed.starting_point = `${startingCity}, ${startingCountry}`;

      if (parsed.starting_point !== `${startingCity}, ${startingCountry}`) {
        return res.status(502).json({
          message: "Starting point could not be generated correctly.",
        });
      }

      if (parsed.destination !== `${city}, ${country}`) {
        return res.status(502).json({
          message: "AI returned an incorrect destination.",
        });
      }

      if (parsed.duration_days !== days) {
        return res.status(502).json({
          message: "AI returned an incorrect trip duration.",
        });
      }

      if (
        !Array.isArray(parsed.sample_itinerary) ||
        parsed.sample_itinerary.length !== days
      ) {
        return res.status(502).json({
          message: `AI returned ${parsed.sample_itinerary?.length || 0} itinerary days instead of ${days}.`,
        });
      }

      return res.json(parsed);
    } catch (err) {
      console.error("JSON parse failed:", err.message);
      console.error("Raw model output:", content);

      return res.status(502).json({
        message:
          "We couldn't generate your travel plan right now — the AI response was malformed. Please try again.",
        error: err.message,
        ...(process.env.NODE_ENV !== "production" && { raw: content }),
      });
    }
  } catch (err) {
    res.status(500).json({
      message: "Upstream error!",
      error: err?.response?.data || err.message,
    });
  }
});

const PORT = 3000;

app.listen(PORT, () => console.log("Server is running on", PORT));
