require("dotenv").config();

const express = require("express");
const cors = require("cors");
const connectDB = require("./db");

const authRoutes = require("./routes/authRoutes");
const chatRoutes = require("./routes/chatRoutes");

const app = express();
const PORT = process.env.PORT || 5000;

connectDB().catch((err) => {
  console.error("MongoDB connection failed:", err.message);
  process.exit(1);
});

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (req, res) => {
  res.json({ ok: true, service: "ChatAI", model: process.env.GROQ_MODEL || "openai/gpt-oss-120b" });
});

app.use("/api/auth", authRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/history", chatRoutes);

app.listen(PORT, () => console.log(`Server running on ${PORT}`));
