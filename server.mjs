import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number.parseInt(process.env.PORT ?? "4173", 10);
const CLAUDE_KEY = process.env.CLAUDE_KEY ?? "";
const MODEL = "claude-haiku-4-5-20251001";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "public");

const judgeProfiles = [
  {
    id: "mara",
    name: "Mara Voss",
    title: "Deadpan Copy Editor",
    vibe:
      "Clinical, precise, and lightly judgmental. Scans for efficient wording, structural discipline, and whether the punchline earns its keep.",
    rubric:
      "Reward economy, clarity, and a clean landing. Penalize over-explaining, obvious setups, and jokes that wobble.",
  },
  {
    id: "dex",
    name: "Dex Marlow",
    title: "Crowd-pleaser Host",
    vibe:
      "Warm, loud, and stage-savvy. Loves momentum, immediate laughter, and jokes that feel like they could work out loud in a room.",
    rubric:
      "Reward energy, performance value, and memorability. Penalize flat delivery and anything that needs a footnote.",
  },
  {
    id: "nina",
    name: "Dr. Nina Vale",
    title: "Ruthless Joke Professor",
    vibe:
      "Analytical and unsparing, but fair. Evaluates surprise, originality, and whether the joke actually subverts expectation.",
    rubric:
      "Reward novelty, twist logic, and precision. Penalize recycled bits, generic wordplay, and weak reversals.",
  },
];

const fallbackTopics = [
  "airport security",
  "houseplants",
  "group chats",
  "self-checkout",
  "weather apps",
  "calendar invites",
  "ice cream",
  "stationery",
  "park benches",
];

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeTopic(topic) {
  const cleaned = String(topic ?? "").trim().replace(/\s+/g, " ");
  return cleaned.slice(0, 80);
}

function normalizeNsfwLevel(value) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) return 18;
  return clamp(parsed, 0, 100);
}

function nsfwTone(level) {
  if (level < 20) {
    return "clean, work-safe, and broadly friendly.";
  }
  if (level < 45) {
    return "lightly cheeky with a wink, but still safe for most settings.";
  }
  if (level < 70) {
    return "more irreverent and a little risqué, but avoid explicit sexual content, hate, or graphic violence.";
  }
  if (level < 90) {
    return "very edgy and adult-coded, but still not explicit, hateful, or graphic.";
  }
  return "as daring as possible without becoming explicit, hateful, or graphic.";
}

const jsonHeaders = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

function sendJson(res, status, payload) {
  res.writeHead(status, jsonHeaders);
  res.end(JSON.stringify(payload));
}

async function serveStatic(req, res, fileName, contentType) {
  try {
    const data = await readFile(path.join(publicDir, fileName));
    res.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": "no-store",
    });
    if (req.method === "HEAD") {
      res.end();
    } else {
      res.end(data);
    }
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try {
        const body = Buffer.concat(chunks).toString("utf8");
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function extractJson(text) {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Model did not return JSON");
  }
  return JSON.parse(candidate.slice(start, end + 1));
}

async function callClaude({ system, user, maxTokens = 420, temperature = 0.8 }) {
  if (!CLAUDE_KEY) {
    throw new Error("CLAUDE_KEY is not configured");
  }

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": CLAUDE_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      temperature,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Anthropic API ${response.status}: ${detail}`);
  }

  const data = await response.json();
  const text = (data.content ?? [])
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();

  if (!text) {
    throw new Error("Anthropic response was empty");
  }

  return { data, text };
}

function buildFallbackJoke(topic, nsfwLevel) {
  const resolvedTopic = topic || fallbackTopics[Math.floor(Math.random() * fallbackTopics.length)];
  const openers = [
    `I asked ${resolvedTopic} for advice,`,
    `My ${resolvedTopic} tried to help me,`,
    `I brought my confidence to ${resolvedTopic},`,
  ];
  const cleanPunchlines = [
    "and somehow it still had a better exit strategy than I did.",
    "but it immediately became a side quest with poor reviews.",
    "and now we both need a manager.",
  ];
  const cheekyPunchlines = [
    "and somehow it still had a better exit strategy than I did.",
    "but it immediately became a side quest with poor reviews.",
    "and now we both need a manager.",
  ];
  const spicyPunchlines = [
    "and the situation got a little too confident for a weekday.",
    "which is how I discovered my standards have a sense of humor.",
    "and the aftermath required fewer witnesses than expected.",
  ];
  const opener = openers[Math.floor(Math.random() * openers.length)];
  const pool = nsfwLevel < 20 ? cleanPunchlines : nsfwLevel < 70 ? cheekyPunchlines : spicyPunchlines;
  const punchline = pool[Math.floor(Math.random() * pool.length)];
  return {
    topic: resolvedTopic,
    setup: opener,
    punchline,
    joke: `${opener} ${punchline}`,
  };
}

async function generateJoke(body = {}) {
  const requestedTopic = normalizeTopic(body.topic);
  const nsfwLevel = normalizeNsfwLevel(body.nsfwLevel);
  const topic = requestedTopic || fallbackTopics[Math.floor(Math.random() * fallbackTopics.length)];
  const system = [
    "You write short, original jokes for a playful web app.",
    "Return only valid JSON with keys: topic, setup, punchline, joke.",
    `The joke topic is: ${topic}.`,
    `The requested tone is: ${nsfwTone(nsfwLevel)}`,
    "The joke should be one or two sentences and broadly funny.",
    "Avoid explaining the joke. Avoid references to real people or protected traits.",
  ].join(" ");

  const user = [
    `Write one fresh joke about: ${topic}.`,
    `Respect this tone setting: ${nsfwTone(nsfwLevel)}`,
    "Return JSON only.",
  ].join("\n");

  try {
    const { text } = await callClaude({ system, user, maxTokens: 300, temperature: 0.95 });
    const joke = extractJson(text);
    return {
      topic: String(joke.topic ?? topic),
      setup: String(joke.setup ?? "").trim(),
      punchline: String(joke.punchline ?? "").trim(),
      joke: String(joke.joke ?? "").trim(),
      source: "claude",
      nsfwLevel,
    };
  } catch {
    const fallback = buildFallbackJoke(topic, nsfwLevel);
    return { ...fallback, source: "fallback", nsfwLevel };
  }
}

async function judgeJoke(joke, profile, nsfwLevel = 18) {
  const system = [
    `You are ${profile.name}, ${profile.title}.`,
    profile.vibe,
    profile.rubric,
    "You are judging a joke on a 1-100 scale.",
    `The joke was requested with an NSFW setting of ${nsfwLevel}/100.`,
    "Return only valid JSON with keys: score, review, label.",
    "The review should be 1-2 sentences, distinct in voice, and specific.",
    "Do not mention policy, instructions, or that you are an AI model.",
  ].join(" ");

  const user = [
    `Joke: ${joke}`,
    "Give the score and a short review.",
  ].join("\n");

  try {
    const { text } = await callClaude({ system, user, maxTokens: 260, temperature: 0.7 });
    const parsed = extractJson(text);
    const score = Math.max(1, Math.min(100, Number.parseInt(parsed.score, 10) || 0));
    return {
      judgeId: profile.id,
      name: profile.name,
      title: profile.title,
      score,
      label: String(parsed.label ?? "Strong bit").trim(),
      review: String(parsed.review ?? "").trim(),
      source: "claude",
    };
  } catch {
    const fallbackScores = { mara: 76, dex: 83, nina: 71 };
    const fallbackReviews = {
      mara: "Tight enough to pass the desk test. One cleaner turn and this would really snap.",
      dex: "This has stage energy. I can hear a room leaning forward on the punchline.",
      nina: "The premise is solid, and the twist lands with enough surprise to earn a nod.",
    };
    return {
      judgeId: profile.id,
      name: profile.name,
      title: profile.title,
      score: fallbackScores[profile.id] ?? 75,
      label: "Fallback score",
      review: fallbackReviews[profile.id] ?? "Decent joke.",
      source: "fallback",
    };
  }
}

async function handleApiJoke(req, res) {
  const body = await readBody(req);
  const joke = await generateJoke(body);
  sendJson(res, 200, joke);
}

async function handleApiJudge(req, res) {
  const body = await readBody(req);
  const joke = String(body.joke ?? "").trim();
  const judgeId = String(body.judgeId ?? "").trim();
  const nsfwLevel = normalizeNsfwLevel(body.nsfwLevel);
  const profile = judgeProfiles.find((entry) => entry.id === judgeId);

  if (!joke) {
    sendJson(res, 400, { error: "Missing joke text" });
    return;
  }
  if (!profile) {
    sendJson(res, 400, { error: "Unknown judge" });
    return;
  }

  const result = await judgeJoke(joke, profile, nsfwLevel);
  sendJson(res, 200, result);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const { pathname } = url;

  if ((req.method === "GET" || req.method === "HEAD") && pathname === "/") {
    return serveStatic(req, res, "index.html", "text/html; charset=utf-8");
  }
  if ((req.method === "GET" || req.method === "HEAD") && pathname === "/styles.css") {
    return serveStatic(req, res, "styles.css", "text/css; charset=utf-8");
  }
  if ((req.method === "GET" || req.method === "HEAD") && pathname === "/app.js") {
    return serveStatic(req, res, "app.js", "application/javascript; charset=utf-8");
  }
  if ((req.method === "GET" || req.method === "HEAD") && pathname === "/favicon.svg") {
    return serveStatic(req, res, "favicon.svg", "image/svg+xml");
  }
  if (req.method === "GET" && pathname === "/healthz") {
    sendJson(res, 200, { ok: true });
    return;
  }
  if (req.method === "POST" && pathname === "/api/joke") {
    await handleApiJoke(req, res);
    return;
  }
  if (req.method === "POST" && pathname === "/api/judge") {
    await handleApiJudge(req, res);
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not found");
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Jokemaster listening on 0.0.0.0:${PORT}`);
});
