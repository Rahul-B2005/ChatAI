const router = require("express").Router();
const Chat = require("../models/Chat");
const auth = require("../middleware/auth");
const axios = require("axios");
require("dotenv").config();

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-120b";

// Questions containing these terms are treated as time-sensitive and get
// Groq's built-in browser_search tool. Normal questions stay on the model only.
const LIVE_PATTERNS = [
  /\b(current|currently|latest|today|tonight|tomorrow|now|right now|recent|recently|this week|this month|live|breaking)\b/i,
  /\b(news|weather|forecast|temperature|rain|storm|price|prices|rate|rates|stock|share price|gold|silver|petrol|diesel|fuel|crypto|bitcoin|exchange rate)\b/i,
  /\b(politics|political|election|elections|minister|chief minister|cm|prime minister|pm|president|governor|government)\b/i,
  /\b(result|results|score|standings|schedule|match|matches)\b/i,
  /\b(இன்று|தற்போதைய|சமீபத்திய|செய்தி|செய்திகள்|வானிலை|விலை|விலைகள்|அரசியல்|தேர்தல்|முதல்வர்|பிரதமர்|நிகழ்நேரம்)\b/i
];

const needsLiveSearch = (message) => LIVE_PATTERNS.some((pattern) => pattern.test(message));

const trimMessages = (items) => items.slice(-12).map((item) => ({
  role: item.role === "assistant" ? "assistant" : "user",
  content: String(item.content || "").slice(0, 6000)
}));

const getAIReply = async (message, history = []) => {
  if (!process.env.GROQ_API_KEY || process.env.GROQ_API_KEY.includes("PASTE_YOUR")) {
    throw new Error("GROQ_API_KEY is missing in server/.env");
  }

  const liveSearch = needsLiveSearch(message);

  const system = liveSearch
    ? "You are ChatAI. This is a time-sensitive question. Use the browser_search tool to verify current information before answering. Prefer recent, authoritative sources. Clearly state the relevant date/time when useful. Do not claim old training knowledge is current. Answer concisely in Markdown. Do not include citation/reference markers such as 【1†L7-L10】 in the final answer."
    : "You are ChatAI, a helpful, accurate and concise AI assistant. Use Markdown when it improves readability. Never invent facts. Do not pretend old knowledge is current.";

  const body = {
    model: MODEL,
    messages: [
      { role: "system", content: system },
      ...trimMessages(history),
      { role: "user", content: String(message).trim() }
    ],
    max_completion_tokens: 2048,
    temperature: 1
  };

  // IMPORTANT: Do NOT send citation_options and do NOT use groq/compound here.
  // GPT-OSS 120B supports Groq's browser_search tool directly.
  if (liveSearch) {
    // Force Groq to perform browser search for time-sensitive questions.
    // Without tool_choice:"required", the model may decide to answer from
    // its existing knowledge instead of searching the live web.
    body.tools = [{ type: "browser_search" }];
    body.tool_choice = "required";
  }

  const response = await axios.post(GROQ_URL, body, {
    headers: {
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      "Content-Type": "application/json"
    },
    timeout: 90000
  });

  const choice = response.data?.choices?.[0];
  const rawReply = choice?.message?.content || "I couldn't generate a response.";
  // Remove Groq/search citation markers from the user-visible response.
  // Examples: 【1†L7-L10】, 【3†L26-L34】, 【12†source】.
  const reply = String(rawReply)
    .replace(/【[^】]*】/g, "")
    .replace(/\n[ \t]*\n[ \t]*\n/g, "\n\n")
    .trim();
  const executedTools = choice?.message?.executed_tools || [];
  const usedWebSearch = executedTools.some((tool) =>
    JSON.stringify(tool).toLowerCase().includes("browser_search") ||
    JSON.stringify(tool).toLowerCase().includes('"type":"search"') ||
    JSON.stringify(tool).toLowerCase().includes("search")
  );

  return { reply, usedWebSearch: liveSearch || usedWebSearch, model: MODEL };
};

router.post("/", auth, async (req, res) => {
  try {
    const message = String(req.body?.message || "").trim();
    const sessionId = String(req.body?.sessionId || "").trim();

    if (!message || !sessionId) {
      return res.status(400).json({ success: false, message: "Message and sessionId are required." });
    }

    await Chat.create({
      userId: req.user.id,
      sessionId,
      role: "user",
      content: message
    });

    // Use a small, recent history window so requests do not grow without bound.
    const previous = await Chat.find({
      userId: req.user.id,
      sessionId
    }).sort({ createdAt: 1 }).lean();

    // The current user message was just stored; don't send it twice.
    const history = previous.slice(0, -1);
    const result = await getAIReply(message, history);

    await Chat.create({
      userId: req.user.id,
      sessionId,
      role: "assistant",
      content: result.reply
    });

    return res.json({
      success: true,
      reply: result.reply,
      model: result.model,
      usedWebSearch: result.usedWebSearch
    });
  } catch (err) {
    const apiError = err.response?.data?.error;
    console.error("AI request:", apiError || err.message);

    const status = err.response?.status || 500;
    let message = "AI request failed. Please try again.";

    if (apiError?.code === "model_not_found") {
      message = `Groq model "${MODEL}" is unavailable. Set GROQ_MODEL=openai/gpt-oss-120b in server/.env.`;
    } else if (apiError?.message) {
      message = apiError.message;
    } else if (err.code === "ECONNABORTED") {
      message = "Groq request timed out. Please try again.";
    }

    return res.status(status).json({ success: false, message });
  }
});

router.get("/sessions/all", auth, async (req, res) => {
  try {
    const sessions = await Chat.aggregate([
      { $match: { userId: req.user.id } },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: "$sessionId",
          lastMessage: { $first: "$content" },
          updatedAt: { $first: "$createdAt" }
        }
      },
      { $sort: { updatedAt: -1 } }
    ]);
    res.json(sessions);
  } catch (err) {
    console.error("Sessions:", err.message);
    res.status(500).json([]);
  }
});

router.get("/:sessionId", auth, async (req, res) => {
  try {
    const chats = await Chat.find({
      userId: req.user.id,
      sessionId: req.params.sessionId
    }).sort({ createdAt: 1 });
    res.json(chats);
  } catch (err) {
    console.error("Chat history:", err.message);
    res.status(500).json([]);
  }
});

router.delete("/:sessionId", auth, async (req, res) => {
  try {
    await Chat.deleteMany({ userId: req.user.id, sessionId: req.params.sessionId });
    res.json({ success: true, message: "Chat deleted successfully" });
  } catch (err) {
    console.error("Delete:", err.message);
    res.status(500).json({ success: false, message: "Delete failed" });
  }
});

module.exports = router;
