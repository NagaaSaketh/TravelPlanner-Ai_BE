const express = require("express");
require("dotenv").config();
const OpenAI = require("openai");
const cors = require("cors");
const { initializeDB } = require("./db/db.connect");
const app = express();

app.use(express.json());
app.use(cors());

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
You are an AI assistant acting as a helpful travel agent.
Respond with JSON only. No prose,markdown or backtick

Use exactly this schema and field names:
{
"destination":"string - city,country",
"best_time":"string - month(s)/season with one sentence only why",
"duration_days":number,
"top_attractions":["string","string","string"],
"sample_itinerary":[
{"day":1,"plan":"string"},
{"day":2,"plan":"string"},
{"day":3,"plan":"string"},
],
"estimated_budget_USD":{"low":number,"mid":number,"high":number},
"local_tips":["string","string"]
}

Rules:
-Output valid JSON only, nothing else.
-Keep numbers unquoted
- If unsure , use null or [] but keep the schema.
`;

app.get("/api/travel-plan", async (req, res) => {
  const city = (req.query.city || "Paris").toString();
  const country = (req.query.country || "France").toString();
  const days = req.query.days || 4 || 4;

  const userPrompt = `Create a short ${days}-day travel plan for ${city},${country} for a first-time visitor`;

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
      return res.json(parsed);
    } catch (err) {
      return res
        .status(502)
        .json({ message: "Model did not return valid JSON", raw: content });
    }
  } catch (err) {
    res.status(500).json({ message: "Upstream error!", error: err?.response?.data || err.message, });
  }
});

const PORT = 3000;

app.listen(PORT, () => console.log("Server is running on", PORT));
