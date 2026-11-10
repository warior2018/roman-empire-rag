# Sherlock Holmes RAG

Ask a question about the Sherlock Holmes stories by Arthur Conan Doyle (9 books, Project Gutenberg),
and the app answers only from passages found in the books, with sources: book title and chunk number.
If the books do not contain the answer, it says "I don't know".

How it works: on the first start the app downloads the 9 books, removes the Project Gutenberg header and license,
splits the text into chunks of about 160 words and turns each chunk into a vector with a local model (`all-MiniLM-L6-v2`).
For a question, it finds the most similar chunks (cosine similarity), optionally only in one book
and optionally re-ranked by a cross-encoder, then sends them to an OpenAI-compatible AI API (tested with Google Gemini).
If the API fails, it retries (up to 4 attempts).

## Two versions
- **Web UI** (`server.js`) — a local page made with Express: ask questions and run the evaluation.
- **CLI** (`app.js`) — ask a question in the terminal, or use the interactive mode.

Both use the same logic from `rag.js`.

## Setup

```bash
git clone https://github.com/warior2018/roman-empire-rag.git
cd roman-empire-rag
npm install
cp .env.example .env
```

The first start downloads the books and the models and builds the search index (a few minutes, only once).

## Environment variables
Put them in `.env`:

```
OPENAI_API_KEY=your-key
OPENAI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
OPENAI_MODEL=gemini-flash-lite-latest
```

Only `OPENAI_API_KEY` is required. Free Gemini key: https://aistudio.google.com.
Optional for experiments: `CHUNK_WORDS`, `OVERLAP_WORDS`, `TOP_K`, `EMBED_MODEL` (see `.env.example`).
If `CHUNK_WORDS`, `OVERLAP_WORDS` or `EMBED_MODEL` changes, the index is built again on the next start.

## Run
**Web UI:**
```bash
npm start
```
Then open http://localhost:3000. The Evaluation button checks 30 test questions from `questions.json`
and shows Recall@K and MRR (with or without re-rank).

**CLI:**
```bash
node app.js "Who is Irene Adler?" [--book 3] [--k 5] [--rerank]
node app.js
```
The second command starts the interactive mode (`/books`, `/book 3`, `/rerank on`, `/k 8`, `/exit`).

Books: 1 A Study in Scarlet, 2 The Sign of the Four, 3 The Adventures, 4 The Memoirs,
5 The Hound of the Baskervilles, 6 The Return, 7 The Valley of Fear, 8 His Last Bow, 9 The Case-Book.

## Experiments
Evaluation on 30 test questions, k = 5:

| | Recall@5 | MRR |
|---|---|---|
| Without re-rank | 83.3% (25/30) | 0.761 |
| With re-rank | 93.3% (28/30) | 0.861 |

The re-ranker fixed 3 misses (Toby the dog, the curious incident of the dog, Milverton)
and moved several answers to the 1st place. Two questions stay misses in both (Watson's marriage,
the seven-per-cent solution): the right passage is not among the 25 candidates, so the embedding model
is the bottleneck there, not the re-ranker.

## Example run
Without re-rank the vector search misses the passage about Moriarty's fall
(it talks about "the fall" and "a horrible scream", not "die"), so the model honestly says "I don't know":

```bash
node app.js "How did Professor Moriarty die?"
```

```
Question: How did Professor Moriarty die?
Settings: book: all, k: 5, rerank: off

I don't know - the retrieved passages do not answer this question.

Sources:
  [1] The Return of Sherlock Holmes, chunk 70 (similarity 0.657) - ... the line of his pedigree. The person becomes, as it were, the epitome of the history of his own family.” “...
  [2] The Return of Sherlock Holmes, chunk 25 (similarity 0.645) - ... the puffs of his cigarette. “But the tracks!” I cried. “I saw, with my own eyes, that two went down the pa...
  [3] The Memoirs of Sherlock Holmes, chunk 812 (similarity 0.638) - ... putting his finger-tips together and his elbows upon his knees, he explained the situation. “You have prob...
  [4] The Memoirs of Sherlock Holmes, chunk 811 (similarity 0.636) - ... their highest tension. He saw the question in my eyes, and, putting his finger-tips together and his elbow...
  [5] The Memoirs of Sherlock Holmes, chunk 850 (similarity 0.634) - ... spot. He said nothing, but he smiled at me with the air of a man who sees the fulfillment of that which he...
```

With the book filter and re-rank the right passages come first:

```bash
node app.js "How did Professor Moriarty die?" --book 6 --rerank
```

```
Question: How did Professor Moriarty die?
Settings: book: The Return of Sherlock Holmes, k: 5, rerank: on

Professor Moriarty died at the Reichenbach Fall [2][3]. He rushed at Sherlock Holmes and threw his long arms around him, and they tottered together upon the brink of the fall [3].

Sources:
  [1] The Return of Sherlock Holmes, chunk 78 (similarity 0.589, rerank 5.073) - ... the death of the late lamented Professor Moriarty.” “I can hardly think that you would find many decent ci...
  [2] The Return of Sherlock Holmes, chunk 25 (similarity 0.645, rerank 4.855) - ... the puffs of his cigarette. “But the tracks!” I cried. “I saw, with my own eyes, that two went down the pa...
  [3] The Return of Sherlock Holmes, chunk 23 (similarity 0.606, rerank 2.25) - ... had no serious difficulty in getting out of it, for the very simple reason that I never was in it.” “You n...
  [4] The Return of Sherlock Holmes, chunk 77 (similarity 0.471, rerank 1.864) - ... to devote his life to examining those interesting little problems which the complex life of London so plen...
  [5] The Return of Sherlock Holmes, chunk 70 (similarity 0.657, rerank 1.117) - ... the line of his pedigree. The person becomes, as it were, the epitome of the history of his own family.” “...
```

A question the books cannot answer:

```bash
node app.js "Who won the 2018 football World Cup?"
```

```
Question: Who won the 2018 football World Cup?
Settings: book: all, k: 5, rerank: off

I don't know - the retrieved passages do not answer this question.

Sources:
  [1] The Return of Sherlock Holmes, chunk 834 (similarity 0.187) - ... Is there a telegram for me?” “Yes, I opened it. Here it is: “Ask for Pompey from Jeremy Dixon, Trinity Col...
  [2] His Last Bow, chunk 521 (similarity 0.157) - ... Imperial Tokay. The thickset chauffeur, who had seated himself by the table, pushed forward his glass with...
  [3] The Case-Book of Sherlock Holmes, chunk 642 (similarity 0.152) - ... give my husband his death-blow, and yet to leave the evidence that it was the lion which we would loose wh...
  [4] The Return of Sherlock Holmes, chunk 835 (similarity 0.144) - ... evening paper has an excellent account in its last edition. Oxford won by a goal and two tries. The last s...
  [5] The Return of Sherlock Holmes, chunk 8 (similarity 0.137) - ... way affect him. He had played nearly every day at one club or other, but he was a cautious player, and usu...
```
