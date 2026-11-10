const express = require("express");
const path = require("path");
const { config, hasIndex, buildIndex, ask, evaluate } = require("./rag");

const app = express();
const PORT = process.env.PORT || 3000;

// What the server is doing now (the page shows it)
const status = { ready: hasIndex(), stage: "", done: 0, total: 0, error: null };

// On the first start: download the book and build the index in the background
if (!status.ready) {
  console.log("No index yet - building it in the background (a few minutes)...");
  buildIndex((progress) => Object.assign(status, { done: 0, total: 0 }, progress))
    .then(() => {
      status.ready = true;
      console.log("Index is ready");
    })
    .catch((err) => {
      status.error = err.message;
      console.error(`Error while building the index: ${err.message}`);
    });
}

// Read JSON from requests
app.use(express.json());

// Send our HTML page from the "public" folder
app.use(express.static(path.join(__dirname, "public")));

// The page asks here if the index is ready
app.get("/api/status", (req, res) => {
  res.json(status);
});

// Stop a request if the index is not ready yet
function needIndex(req, res, next) {
  if (status.ready) return next();
  res.status(503).json({ error: "The index is still being built. Please wait." });
}

// Read k from the request (1-20)
function readK(body) {
  return Math.min(Math.max(Number(body?.k) || config.topK, 1), 20);
}

// The page sends the question here and gets the answer with sources
app.post("/api/ask", needIndex, async (req, res) => {
  const question = String(req.body?.question ?? "").trim();
  if (!question) return res.status(400).json({ error: "Please write a question" });

  const book = Number(req.body?.book) || null;
  const rerank = Boolean(req.body?.rerank);

  try {
    res.json(await ask(question, { book, k: readK(req.body), rerank }));
  } catch (err) {
    console.error(`Error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// The page runs the evaluation here (search quality on questions.json)
app.post("/api/eval", needIndex, async (req, res) => {
  try {
    res.json(await evaluate({ k: readK(req.body), rerank: Boolean(req.body?.rerank) }));
  } catch (err) {
    console.error(`Error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Sherlock Holmes RAG is running: http://localhost:${PORT}`);
});
