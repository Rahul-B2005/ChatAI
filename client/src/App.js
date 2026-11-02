import React, { useEffect, useRef, useState } from "react";
import axios from "axios";
import ReactMarkdown from "react-markdown";
import {
  MdAdd, MdDelete, MdMenu, MdSearch, MdSend, MdClose,
  MdAutoAwesome, MdContentCopy, MdMic, MdLogout
} from "react-icons/md";
import toast, { Toaster } from "react-hot-toast";
import "./App.css";

const API = "http://localhost:5000";
const cleanCitationMarkers = (text) => String(text || "")
  .replace(/【[^】]*】/g, "")
  .replace(/\n[ \t]*\n[ \t]*\n/g, "\n\n")
  .trim();


// Render GitHub/ChatGPT-style Markdown tables without exposing raw | syntax.
const isTableSeparator = (line) => {
  const cells = line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|");
  return cells.length >= 1 && cells.every((cell) => /^\s*:?-{3,}:?\s*$/.test(cell));
};

const splitTableRow = (line) =>
  line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());

const renderMarkdownWithTables = (text) => {
  const source = cleanCitationMarkers(text).replace(/<br\s*\/?\s*>/gi, "\n");
  const lines = source.split("\n");
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    if (i + 1 < lines.length && lines[i].includes("|") && isTableSeparator(lines[i + 1])) {
      const headers = splitTableRow(lines[i]);
      const rows = [];
      i += 2;
      while (i < lines.length && lines[i].trim() && lines[i].includes("|")) {
        rows.push(splitTableRow(lines[i]));
        i += 1;
      }
      blocks.push({ type: "table", headers, rows, key: `table-${i}-${blocks.length}` });
      continue;
    }

    const normal = [];
    while (i < lines.length) {
      if (i + 1 < lines.length && lines[i].includes("|") && isTableSeparator(lines[i + 1])) break;
      normal.push(lines[i]);
      i += 1;
    }
    if (normal.join("\n").trim()) blocks.push({ type: "markdown", content: normal.join("\n"), key: `md-${i}-${blocks.length}` });
  }

  return blocks.map((block) => {
    if (block.type === "table") {
      return (
        <div className="markdown-table-wrap" key={block.key}>
          <table className="markdown-table">
            <thead>
              <tr>{block.headers.map((cell, index) => <th key={index}><ReactMarkdown>{cell}</ReactMarkdown></th>)}</tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r}>
                  {block.headers.map((_, c) => <td key={c}><ReactMarkdown>{row[c] || ""}</ReactMarkdown></td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    return <ReactMarkdown key={block.key}>{block.content}</ReactMarkdown>;
  });
};


// Buckets chats into Today / Yesterday / Previous 7 days / Older, ChatGPT-style.
const groupChatsByDate = (chats) => {
  const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const today = startOfDay(new Date());
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
  const weekAgo = new Date(today); weekAgo.setDate(weekAgo.getDate() - 7);

  const buckets = { Today: [], Yesterday: [], "Previous 7 days": [], Older: [] };
  chats.forEach((chat) => {
    if (!chat.updatedAt) { buckets.Older.push(chat); return; }
    const day = startOfDay(new Date(chat.updatedAt));
    if (day.getTime() === today.getTime()) buckets.Today.push(chat);
    else if (day.getTime() === yesterday.getTime()) buckets.Yesterday.push(chat);
    else if (day.getTime() > weekAgo.getTime()) buckets["Previous 7 days"].push(chat);
    else buckets.Older.push(chat);
  });
  return Object.entries(buckets).filter(([, items]) => items.length > 0);
};

function App() {
  const [token, setToken] = useState(localStorage.getItem("token"));
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem("user")) || null; } catch { return null; }
  });

  const [isLogin, setIsLogin] = useState(true);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [recents, setRecents] = useState([]);
  const [activeSession, setActiveSession] = useState(null);
  const [showSidebar, setShowSidebar] = useState(false);
  const [search, setSearch] = useState("");
  const [listening, setListening] = useState(false);
  const [lastUsedWebSearch, setLastUsedWebSearch] = useState(false);

  const chatRef = useRef(null);
  const recognitionRef = useRef(null);

  useEffect(() => {
    if (!token) return;
    loadSessions();
  }, [token]);

  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
  }, [messages, loading]);

  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = "en-IN";

    recognition.onstart = () => setListening(true);
    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);
    recognition.onresult = (event) => setMessage(event.results[0][0].transcript);

    recognitionRef.current = recognition;
    return () => recognition.stop();
  }, []);

  const register = async () => {
    if (!name.trim() || !email.trim() || !password) return toast.error("Fill all fields");
    try {
      const { data } = await axios.post(`${API}/api/auth/register`, {
        name: name.trim(), email: email.trim(), password
      });
      if (!data.success) return toast.error(data.message || "Registration failed");
      toast.success("Account created. Please login.");
      setIsLogin(true);
      setName(""); setPassword("");
    } catch (err) {
      toast.error(err.response?.data?.message || "Registration failed");
    }
  };

  const login = async () => {
    if (!email.trim() || !password) return toast.error("Enter email and password");
    try {
      const { data } = await axios.post(`${API}/api/auth/login`, {
        email: email.trim(), password
      });
      if (!data.success) return toast.error(data.message || "Login failed");

      localStorage.setItem("token", data.token);
      localStorage.setItem("user", JSON.stringify(data.user));
      setToken(data.token);
      setUser(data.user);
      toast.success("Welcome back");
    } catch (err) {
      toast.error(err.response?.data?.message || "Login failed");
    }
  };

  const loadSessions = async () => {
    try {
      const { data } = await axios.get(`${API}/api/chat/sessions/all`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setRecents(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error(err);
    }
  };

  const openChat = async (id) => {
    try {
      setActiveSession(id);
      const { data } = await axios.get(`${API}/api/chat/${id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setMessages(Array.isArray(data) ? data.map(item => ({ ...item, content: cleanCitationMarkers(item.content) })) : []);
      setShowSidebar(false);
    } catch {
      toast.error("Could not open chat");
    }
  };

  const newChat = () => {
    const id = crypto.randomUUID();
    setActiveSession(id);
    setMessages([]);
    setMessage("");
    setShowSidebar(false);
  };

  const sendMessage = async () => {
    const text = message.trim();
    if (!text || loading) return;

    const sessionId = activeSession || crypto.randomUUID();
    setActiveSession(sessionId);
    setMessage("");
    setLoading(true);

    const userMessage = {
      role: "user",
      content: text,
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    };
    setMessages(prev => [...prev, userMessage]);

    try {
      const { data } = await axios.post(
        `${API}/api/chat`,
        { message: text, sessionId },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (!data.success) throw new Error(data.message || "AI request failed");

      setLastUsedWebSearch(Boolean(data.usedWebSearch));
      setMessages(prev => [...prev, {
        role: "assistant",
        content: cleanCitationMarkers(data.reply),
        time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      }]);
      await loadSessions();
    } catch (err) {
      const msg = err.response?.data?.message || err.message || "AI request failed";
      toast.error(msg, { duration: 4500 });
      setMessages(prev => prev.slice(0, -1));
    } finally {
      setLoading(false);
    }
  };

  const deleteChat = async (id, event) => {
    event?.stopPropagation();
    try {
      await axios.delete(`${API}/api/chat/${id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setRecents(prev => prev.filter(chat => chat._id !== id));
      if (activeSession === id) {
        setActiveSession(null);
        setMessages([]);
      }
      toast.success("Chat deleted");
    } catch {
      toast.error("Delete failed");
    }
  };

  const copyMessage = async (content) => {
    content = cleanCitationMarkers(content);
    try {
      await navigator.clipboard.writeText(content);
      toast.success("Copied");
    } catch {
      toast.error("Copy failed");
    }
  };

  const startListening = () => {
    if (!recognitionRef.current) return toast.error("Voice input is not supported in this browser");
    if (listening) recognitionRef.current.stop();
    else recognitionRef.current.start();
  };

  const logout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    setToken(null);
    setUser(null);
    setMessages([]);
    setRecents([]);
    toast.success("Logged out");
  };

  const filteredChats = recents.filter(chat =>
    (chat.lastMessage || "").toLowerCase().includes(search.toLowerCase())
  );

  const submitAuth = (e) => {
    e.preventDefault();
    isLogin ? login() : register();
  };

  if (!token) {
    return (
      <div className="auth-page">
        <Toaster position="top-right" />

        <aside className="auth-brand">
          <div className="wordmark"><img src="/logo ai.png" alt="ChatAI" /></div>

          <div className="auth-brand-mid">
            <h1>Your AI workspace,<br />ready when you are.</h1>
            <p>Ask questions, draft faster, and pick up every conversation right where you left it.</p>

            <div className="preview-window" aria-hidden="true">
              <div className="preview-bar"><span /><span /><span /></div>
              <div className="preview-body">
                <div className="preview-msg user">Summarize this contract in three bullet points.</div>
                <div className="preview-msg assistant">
                  <div className="preview-avatar"><MdAutoAwesome /></div>
                  <p>Here's the gist — payment terms, the renewal clause, and the termination window.</p>
                </div>
              </div>
              <div className="preview-input"><span>Message ChatAI…</span><i /></div>
            </div>
          </div>

          <div className="auth-brand-foot">Trusted for everyday work, from quick answers to long drafts.</div>
        </aside>

        <main className="auth-form-panel">
          <form className="auth-card" onSubmit={submitAuth}>
            <div className="auth-heading">
              <span>{isLogin ? "Welcome back" : "Get started"}</span>
              <h2>{isLogin ? "Sign in to continue" : "Create your account"}</h2>
            </div>

            {!isLogin && (
              <label>
                <span>Full name</span>
                <input value={name} onChange={e => setName(e.target.value)} placeholder="Your name" />
              </label>
            )}

            <label>
              <span>Email</span>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" />
            </label>

            <label>
              <span>Password</span>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" />
            </label>

            <button className="auth-submit" type="submit">
              {isLogin ? "Sign in" : "Create account"}
            </button>

            <button
              type="button"
              className="switch-auth"
              onClick={() => { setIsLogin(v => !v); setPassword(""); }}
            >
              {isLogin ? "New to ChatAI? Create an account" : "Already have an account? Sign in"}
            </button>
          </form>
        </main>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <Toaster position="top-right" />

      <header className="topbar">
        <div className="topbar-left">
          <button className="icon-button mobile-only" onClick={() => setShowSidebar(v => !v)} aria-label="Menu">
            {showSidebar ? <MdClose /> : <MdMenu />}
          </button>
          <div className="brand">
            <img className="brand-logo" src="/logo ai.png" alt="ChatAI" />
          </div>
        </div>

        <div className="topbar-right">
          <div className="model-pill"><span /> GPT-OSS 120B</div>
          <div className="profile">
            <div className="avatar">{(user?.name || "U").charAt(0).toUpperCase()}</div>
            <div className="profile-copy">
              <strong>{user?.name || "User"}</strong>
              <span>{user?.email}</span>
            </div>
          </div>
          <button className="icon-button" onClick={logout} title="Logout"><MdLogout /></button>
        </div>
      </header>

      <div className="workspace">
        {showSidebar && <div className="sidebar-backdrop" onClick={() => setShowSidebar(false)} />}

        <aside className={`sidebar ${showSidebar ? "open" : ""}`}>
          <button className="new-chat" onClick={newChat}><MdAdd /> New conversation</button>

          <div className="side-search">
            <MdSearch />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search conversations" />
            {search && <button onClick={() => setSearch("")}><MdClose /></button>}
          </div>

          <div className="side-label">Recent conversations</div>
          <div className="history">
            {filteredChats.length === 0 ? (
              <div className="empty-history">
                <MdAutoAwesome />
                <span>{search ? "No matches" : "Your chats will appear here"}</span>
              </div>
            ) : groupChatsByDate(filteredChats).map(([label, items]) => (
              <div className="history-group" key={label}>
                <div className="history-group-label">{label}</div>
                {items.map(chat => (
                  <div
                    key={chat._id}
                    className={`history-item ${activeSession === chat._id ? "active" : ""}`}
                    onClick={() => openChat(chat._id)}
                  >
                    <span className="history-title">{chat.lastMessage || "New conversation"}</span>
                    <button onClick={(e) => deleteChat(chat._id, e)} title="Delete"><MdDelete /></button>
                  </div>
                ))}
              </div>
            ))}
          </div>

          <div className="sidebar-footer">
            <div className="security-note"><span /> Your conversations are private</div>
            <button className="logout-side" onClick={logout}><MdLogout /> Sign out</button>
          </div>
        </aside>

        <main className="chat-panel">
          <div className="chat-scroll" ref={chatRef}>
            {messages.length === 0 && !loading ? (
              <section className="welcome">
                <div className="welcome-icon"><MdAutoAwesome /></div>
                <h2>What can I help you with?</h2>
                <p>Ask a question, brainstorm an idea, write code, or get a clear explanation.</p>
                <div className="prompt-grid">
                  {[
                    ["✦", "Explain a concept", "Explain a difficult topic in simple words"],
                    ["⌘", "Write code", "Help me build a React component"],
                    ["↗", "Improve my writing", "Make this paragraph more professional"],
                    ["◎", "Brainstorm ideas", "Give me ideas for my next project"]
                  ].map(([icon, title, prompt]) => (
                    <button key={title} className="prompt-card" onClick={() => setMessage(prompt)}>
                      <span className="prompt-icon">{icon}</span>
                      <span><strong>{title}</strong><small>{prompt}</small></span>
                    </button>
                  ))}
                </div>
              </section>
            ) : (
              <div className="messages">
                {messages.map((msg, index) => (
                  <div className={`message-row ${msg.role}`} key={`${msg.role}-${index}`}>
                    {msg.role === "assistant" && <div className="message-avatar"><MdAutoAwesome /></div>}
                    <div className="message-block">
                      {msg.role === "assistant" && (
                        <div className="message-meta"><strong>ChatAI</strong><span>{msg.time}</span></div>
                      )}
                      <div className="message-content">
                        {renderMarkdownWithTables(msg.content)}
                      </div>
                      {msg.role === "assistant" ? (
                        <button className="copy-message" onClick={() => copyMessage(msg.content)} title="Copy response">
                          <MdContentCopy /> Copy
                        </button>
                      ) : (
                        <span className="message-time">{msg.time}</span>
                      )}
                    </div>
                  </div>
                ))}
                {loading && (
                  <div className="message-row assistant">
                    <div className="message-avatar"><MdAutoAwesome /></div>
                    <div className="message-block">
                      <div className="message-meta"><strong>ChatAI</strong><span>Thinking…</span></div>
                      <div className="typing"><i /><i /><i /></div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="composer-area">
            <div className="composer">
              <textarea
                rows="1"
                value={message}
                disabled={loading}
                placeholder="Message ChatAI…"
                onChange={e => setMessage(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage();
                  }
                }}
              />
              <button
                className={`voice ${listening ? "recording" : ""}`}
                onClick={startListening}
                title="Voice input"
                type="button"
              >
                <MdMic />
              </button>
              <button className="send" onClick={sendMessage} disabled={loading || !message.trim()} title="Send">
                <MdSend />
              </button>
            </div>
            <div className="composer-hint">Press Enter to send, Shift + Enter for a new line</div>
          </div>
        </main>
      </div>
    </div>
  );
}

export default App;
