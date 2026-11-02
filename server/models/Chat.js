const mongoose = require("mongoose");

const ChatSchema = new mongoose.Schema(
  {
    userId: String,
    sessionId: String,
    role: {
      type: String,
      enum: ["user", "assistant"],
    },
    content: String,

    // 🔍 SEARCH FEATURE
    searchQuery: String,
  },
  { timestamps: true }
);

module.exports = mongoose.model("Chat", ChatSchema);