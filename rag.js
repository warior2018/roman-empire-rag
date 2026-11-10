const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// Read settings from the .env file (if it exists)
try {
  process.loadEnvFile();
} catch {
  // no .env file, use normal environment variables
}

const env = process.env;
const dataDir = path.join(__dirname, "data");

// All settings in one place
const config = {
  // AI that writes the answer (Gemini through its OpenAI-compatible API)
  apiKey: env.OPENAI_API_KEY,
  baseUrl: (env.OPENAI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta/openai").replace(/\/+$/, ""),
  chatModel: env.OPENAI_MODEL || "gemini-flash-lite-latest",

  // Local models, downloaded once from Hugging Face
  embedModel: env.EMBED_MODEL || "Xenova/all-MiniLM-L6-v2",
  embedPooling: env.EMBED_POOLING || "mean",
  queryPrefix: env.QUERY_PREFIX || "",
  rerankModel: env.RERANK_MODEL || "Xenova/ms-marco-MiniLM-L-6-v2",

  // Chunking (in words; MiniLM reads at most ~256 tokens, about 190 words)
  chunkWords: Number(env.CHUNK_WORDS || 160),
  overlapWords: Number(env.OVERLAP_WORDS || 25),

  // Retrieval
  topK: Number(env.TOP_K || 5),
  rerankCandidates: Number(env.RERANK_CANDIDATES || 25),

  // Files
  rawDir: path.join(dataDir, "raw"),
  indexFile: path.join(dataDir, env.INDEX_NAME || "index.json"),

  // The 9 Sherlock Holmes books by Arthur Conan Doyle on Project Gutenberg
  books: [
    { book: 1, title: "A Study in Scarlet", gutenbergId: 244 },
    { book: 2, title: "The Sign of the Four", gutenbergId: 2097 },
    { book: 3, title: "The Adventures of Sherlock Holmes", gutenbergId: 1661 },
    { book: 4, title: "The Memoirs of Sherlock Holmes", gutenbergId: 834 },
    { book: 5, title: "The Hound of the Baskervilles", gutenbergId: 2852 },
    { book: 6, title: "The Return of Sherlock Holmes", gutenbergId: 108 },
    { book: 7, title: "The Valley of Fear", gutenbergId: 3289 },
    { book: 8, title: "His Last Bow", gutenbergId: 2350 },
    { book: 9, title: "The Case-Book of Sherlock Holmes", gutenbergId: 69700 },
  ],
};

// Count words in a text
const countWords = (text) => text.trim().split(/\s+/).filter(Boolean).length;

// Remove the Project Gutenberg header and license, keep only the book
function stripGutenberg(text) {
  const clean = text.replace(/\r\n/g, "\n");
  const start = clean.search(/\*\*\* ?START OF (THE|THIS) PROJECT GUTENBERG EBOOK/i);
  const end = clean.search(/\*\*\* ?END OF (THE|THIS) PROJECT GUTENBERG EBOOK/i);

  const from = start === -1 ? 0 : clean.indexOf("\n", start) + 1;
  const to = end === -1 ? clean.length : end;
  return clean.slice(from, to).trim();
}

// Download the books from Project Gutenberg (only the missing ones)
async function downloadBooks(onProgress) {
  fs.mkdirSync(config.rawDir, { recursive: true });
  for (const { book, title, gutenbergId } of config.books) {
    const file = path.join(config.rawDir, `book-${book}.txt`);
    if (fs.existsSync(file)) continue;

    onProgress({ stage: `Downloading book ${book} of ${config.books.length}: ${title}` });
    const url = `https://www.gutenberg.org/cache/epub/${gutenbergId}/pg${gutenbergId}.txt`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Download failed (${res.status}): ${url}`);
    fs.writeFileSync(file, await res.text());
  }
}

// Load all downloaded books
function loadBooks(config) {
  return config.books.map(({ book, title }) => {
    const source = `book-${book}.txt`;
    const file = path.join(config.rawDir, source);
    if (!fs.existsSync(file)) {
      throw new Error(`Missing ${file}`);
    }
    return { book, title, source, text: stripGutenberg(fs.readFileSync(file, "utf8")) };
  });
}

// Split text into paragraphs (an empty line starts a new paragraph)
function toParagraphs(text) {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter((p) => p.length > 0);
}

// Cut a very long paragraph into groups of sentences
function splitLong(paragraph, maxWords) {
  const sentences = paragraph.match(/[^.!?]+[.!?]+["'”’)\]]*|[^.!?]+$/g) || [paragraph];
  const parts = [];
  let current = [];
  let words = 0;

  for (const sentence of sentences.map((s) => s.trim()).filter(Boolean)) {
    const w = countWords(sentence);
    if (words + w > maxWords && current.length > 0) {
      parts.push(current.join(" "));
      current = [];
      words = 0;
    }
    current.push(sentence);
    words += w;
  }
  if (current.length > 0) parts.push(current.join(" "));
  return parts;
}

// Same text always gets the same id, so building the index again creates no duplicates
function makeId(book, text) {
  const hash = crypto.createHash("sha1").update(`${book}\n${text}`).digest("hex").slice(0, 12);
  return `book${book}-${hash}`;
}

// Join paragraphs into chunks of about chunkWords words, with a small overlap
function chunkBook(doc, { chunkWords, overlapWords }) {
  const pieces = toParagraphs(doc.text).flatMap((p) =>
    countWords(p) > chunkWords ? splitLong(p, chunkWords) : [p]
  );

  const texts = [];
  let current = [];
  let words = 0;
  let hasNew = false; // current has more than just the overlap from the last chunk

  for (const piece of pieces) {
    const w = countWords(piece);
    if (hasNew && words + w > chunkWords) {
      const text = current.join("\n\n");
      texts.push(text);

      // Start the next chunk with the last words of this one
      const tail = overlapWords > 0 ? text.split(/\s+/).slice(-overlapWords).join(" ") : "";
      current = tail ? [`... ${tail}`] : [];
      words = countWords(tail);
      hasNew = false;
    }
    current.push(piece);
    words += w;
    hasNew = true;
  }
  if (hasNew) texts.push(current.join("\n\n"));

  return texts.map((text, i) => ({
    id: makeId(doc.book, text),
    text,
    metadata: { book: doc.book, title: doc.title, source: doc.source, position: i + 1 },
  }));
}

let extractorPromise;
let rerankerPromise;

// Load the embedding model once (the first time it is downloaded)
function getExtractor() {
  if (!extractorPromise) {
    extractorPromise = import("@huggingface/transformers").then(({ pipeline }) =>
      pipeline("feature-extraction", config.embedModel, { dtype: "fp32" })
    );
  }
  return extractorPromise;
}

// Turn texts into vectors (one normalized vector per text)
async function embed(texts, { isQuery = false } = {}) {
  const extractor = await getExtractor();
  const input = isQuery && config.queryPrefix ? texts.map((t) => config.queryPrefix + t) : texts;
  const output = await extractor(input, { pooling: config.embedPooling, normalize: true });
  return output.tolist();
}

// Load the re-ranker (cross-encoder) once
function getReranker() {
  if (!rerankerPromise) {
    rerankerPromise = import("@huggingface/transformers").then(
      async ({ AutoTokenizer, AutoModelForSequenceClassification }) => ({
        tokenizer: await AutoTokenizer.from_pretrained(config.rerankModel),
        model: await AutoModelForSequenceClassification.from_pretrained(config.rerankModel, { dtype: "fp32" }),
      })
    );
  }
  return rerankerPromise;
}

// Read the question and each passage together and score how well they match
async function rerankScores(question, passages) {
  const { tokenizer, model } = await getReranker();
  const inputs = tokenizer(new Array(passages.length).fill(question), {
    text_pair: passages,
    padding: true,
    truncation: true,
  });
  const { logits } = await model(inputs);
  return logits.tolist().map((row) => row[0]);
}

let cached = null;

// Read the index file from disk (null if it does not exist yet)
function readIndex() {
  if (!fs.existsSync(config.indexFile)) return null;
  return JSON.parse(fs.readFileSync(config.indexFile, "utf8"));
}

// Save the index file to disk
function saveIndex(index) {
  fs.mkdirSync(path.dirname(config.indexFile), { recursive: true });
  fs.writeFileSync(config.indexFile, JSON.stringify(index));
  cached = index;
}

// Settings that change the vectors; if one changes, the index must be built again
function indexSettings() {
  return {
    books: config.books.map((b) => b.gutenbergId),
    embedModel: config.embedModel,
    embedPooling: config.embedPooling,
    chunkWords: config.chunkWords,
    overlapWords: config.overlapWords,
  };
}

// Get the index for searching (loaded once per program run)
function getIndex() {
  if (!cached) {
    const index = readIndex();
    if (index && JSON.stringify(index.settings) === JSON.stringify(indexSettings())) cached = index;
  }
  if (!cached) throw new Error("The index is not ready yet. It is built on the first start.");
  return cached;
}

// Is there a ready index for the current settings?
function hasIndex() {
  try {
    getIndex();
    return true;
  } catch {
    return false;
  }
}

// Cosine similarity (vectors are normalized, so it is just the dot product)
function cosine(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

// Find the k chunks most similar to the question vector
function search(queryVector, { k, book } = {}) {
  return getIndex()
    .chunks.filter((chunk) => !book || chunk.metadata.book === book)
    .map((chunk) => ({ id: chunk.id, text: chunk.text, metadata: chunk.metadata, score: cosine(queryVector, chunk.vector) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

const MAX_ATTEMPTS = 4;
const TIMEOUT_MS = 60_000;

// Error with info: can we try again or not
class ApiError extends Error {
  constructor(message, retryable) {
    super(message);
    this.retryable = retryable;
  }
}

// Take the short error message from the API answer
function errorMessage(body) {
  try {
    const data = JSON.parse(body);
    const item = Array.isArray(data) ? data[0] : data;
    return item?.error?.message || body.slice(0, 200);
  } catch {
    return body.slice(0, 200);
  }
}

// Send messages to the AI and get the answer text
async function callApi(messages) {
  let res;
  try {
    res = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({ model: config.chatModel, messages, temperature: 0.2 }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    const reason = err.name === "TimeoutError" ? `no answer within ${TIMEOUT_MS / 1000}s` : err.message;
    throw new ApiError(`Network error: ${reason}`, true);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    if (res.status === 401) throw new ApiError("API key was rejected (401). Check OPENAI_API_KEY in .env", false);
    const retryable = res.status === 429 || res.status >= 500;
    throw new ApiError(`API returned ${res.status}: ${errorMessage(body)}`, retryable);
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new ApiError("API answer had no text", true);
  return content.trim();
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Try again if the API fails for a short time (waits 2s, 4s, 8s)
async function chat(messages) {
  if (!config.apiKey) throw new Error("OPENAI_API_KEY is not set. Copy .env.example to .env and add your key");
  for (let attempt = 1; ; attempt++) {
    try {
      return await callApi(messages);
    } catch (err) {
      if (!err.retryable || attempt >= MAX_ATTEMPTS) throw err;
      const delay = 2000 * 2 ** (attempt - 1);
      console.error(`Attempt ${attempt}/${MAX_ATTEMPTS} failed: ${err.message}. Retrying in ${delay / 1000}s...`);
      await sleep(delay);
    }
  }
}

const NO_ANSWER = "I don't know - the retrieved passages do not answer this question.";

// Step 1: find the best chunks for the question
async function retrieve(question, { k = config.topK, book = null, rerank = false } = {}) {
  const [queryVector] = await embed([question], { isQuery: true });

  // With re-ranking: take more candidates first, then keep the best k
  const candidates = search(queryVector, { k: rerank ? Math.max(config.rerankCandidates, k) : k, book });
  if (!rerank || candidates.length === 0) return candidates;

  const scores = await rerankScores(question, candidates.map((c) => c.text));
  return candidates
    .map((c, i) => ({ ...c, rerankScore: scores[i] }))
    .sort((a, b) => b.rerankScore - a.rerankScore)
    .slice(0, k);
}

// Step 2: build the prompt with rules, numbered passages and the question
function buildMessages(question, chunks) {
  const system = `You answer questions about the Sherlock Holmes stories by Arthur Conan Doyle.
Rules:
- Use ONLY the numbered passages below. Do not add facts from your own knowledge.
- People can be named in different ways (for example "Holmes" and "Sherlock Holmes"); treat them as the same person.
- If the passages answer the question fully or in part, answer with what they say.
- After each fact, cite the passage number, like [1] or [2][3].
- Only if no passage is about the question, reply exactly: "${NO_ANSWER}"
- Answer in clear modern English, in at most 150 words.`;

  const passages = chunks
    .map((c, i) => `[${i + 1}] (${c.metadata.title}, chunk ${c.metadata.position})\n${c.text}`)
    .join("\n\n");

  return [
    { role: "system", content: system },
    { role: "user", content: `Passages:\n\n${passages}\n\nQuestion: ${question}` },
  ];
}

// Step 3: retrieve, ask the AI, return the answer with its sources
async function ask(question, options = {}) {
  const chunks = await retrieve(question, options);
  if (chunks.length === 0) {
    return { answer: NO_ANSWER, sources: [] };
  }

  const answer = await chat(buildMessages(question, chunks));
  const sources = chunks.map((c, i) => ({
    n: i + 1,
    id: c.id,
    book: c.metadata.book,
    title: c.metadata.title,
    position: c.metadata.position,
    score: Number(c.score.toFixed(3)),
    rerankScore: c.rerankScore === undefined ? undefined : Number(c.rerankScore.toFixed(3)),
    text: c.text,
  }));
  return { answer, sources };
}

// Build the index: download books -> cut into chunks -> make vectors -> save
async function buildIndex(onProgress = () => {}) {
  await downloadBooks(onProgress);

  onProgress({ stage: "Cutting the book into chunks" });
  const chunks = loadBooks(config).flatMap((doc) => chunkBook(doc, config));
  const unique = [...new Map(chunks.map((c) => [c.id, c])).values()];

  // Keep vectors we already have (same id = same text), so nothing is done twice
  const old = readIndex();
  const sameSettings = old && JSON.stringify(old.settings) === JSON.stringify(indexSettings());
  const known = new Map(sameSettings ? old.chunks.map((c) => [c.id, c.vector]) : []);
  const todo = unique.filter((c) => !known.has(c.id));

  // Make vectors in small batches
  const BATCH_SIZE = 32;
  for (let i = 0; i < todo.length; i += BATCH_SIZE) {
    onProgress({ stage: "Making vectors", done: i, total: todo.length });
    const batch = todo.slice(i, i + BATCH_SIZE);
    const vectors = await embed(batch.map((c) => c.text));
    batch.forEach((c, j) => known.set(c.id, vectors[j].map((v) => Math.round(v * 1e5) / 1e5)));
  }

  onProgress({ stage: "Saving the index" });
  saveIndex({
    settings: indexSettings(),
    createdAt: new Date().toISOString(),
    chunks: unique.map((c) => ({ ...c, vector: known.get(c.id) })),
  });
  onProgress({ stage: "Ready", done: unique.length, total: unique.length });
}

// Check search quality: is a right passage in the top k for each test question?
async function evaluate({ k = config.topK, rerank = false } = {}) {
  const questions = JSON.parse(fs.readFileSync(path.join(__dirname, "questions.json"), "utf8"));
  const results = [];

  for (const q of questions) {
    const chunks = await retrieve(q.question, { k, rerank });
    const index = chunks.findIndex((c) => q.expected.some((word) => c.text.toLowerCase().includes(word.toLowerCase())));
    results.push({ question: q.question, rank: index === -1 ? null : index + 1 });
  }

  const hits = results.filter((r) => r.rank !== null);
  return {
    k,
    rerank,
    recall: hits.length / results.length,
    mrr: hits.reduce((sum, r) => sum + 1 / r.rank, 0) / results.length,
    hits: hits.length,
    total: results.length,
    results,
  };
}

module.exports = { config, hasIndex, buildIndex, ask, evaluate };
