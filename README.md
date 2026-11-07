# Roman Empire RAG

Ask a question about Edward Gibbon's History of the Decline and Fall of the Roman Empire (6 volumes),
and the app answers only from passages found in the book, with sources: volume and chunk number.
If the book does not contain the answer, it says "I don't know".

How it works: on the first start the app downloads the book, removes the Project Gutenberg header and footnotes,
splits the text into chunks of about 160 words and turns each chunk into a vector with a local model (`all-MiniLM-L6-v2`).
For a question, it finds the most similar chunks (cosine similarity), optionally only in one volume
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

The first start downloads the book and the models and builds the search index (a few minutes, only once).

## Environment variables
Put them in `.env`:

```
OPENAI_API_KEY=your-key
OPENAI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
OPENAI_MODEL=gemini-flash-lite-latest
```

Only `OPENAI_API_KEY` is required. Free Gemini key: https://aistudio.google.com.
Optional for experiments: `CHUNK_WORDS`, `OVERLAP_WORDS`, `TOP_K`, `EMBED_MODEL` (see `.env.example`).
If one of them changes, the index is built again on the next start.

## Run
**Web UI:**
```bash
npm start
```
Then open http://localhost:3000. The Evaluation button checks 30 test questions from `questions.json`
and shows Recall@K and MRR (with or without re-rank).

**CLI:**
```bash
node app.js "Who was Bahram, the son of Jezdegerd?" [--volume 3] [--k 5] [--rerank]
node app.js
```
The second command starts the interactive mode (`/volume 3`, `/rerank on`, `/k 8`, `/exit`).

## Experiments
Evaluation on 30 test questions, k = 5:

| | Recall@5 | MRR |
|---|---|---|
| Without re-rank | 90.0% (27/30) | 0.834 |
| With re-rank | 93.3% (28/30) | 0.883 |

The re-ranker fixed 2 misses (Hegira, Peter the Hermit) and moved several answers to the 1st place,
but lost one (Diocletian / Salona). The Attila question stays a miss in both: the right passage
is not even among the 25 candidates, so the embedding model is the bottleneck there, not the re-ranker.

## Example run
Without a volume filter the search finds two different men called Bahram (volume 3 and volume 4),
and the model mixes them:

```bash
node app.js "Who was Bahram, the son of Jezdegerd?"
```

```
Question: Who was Bahram, the son of Jezdegerd?
Settings: volume: all, k: 5, rerank: off

Based on the provided passages, Varanes, or Bahram, was the son of Jezdegerd who ascended the throne and imitated his father's intolerant zeal by continuing a cruel persecution [1]. Later, after his revolt, he is described by the son of Hormouz as an ungrateful slave, but he was truly descended from the ancient princes of Rei, which was one of the seven families possessing splendid and substantial prerogatives above the Persian nobility [2].

Sources:
  [1] Volume 3, chunk 716 (similarity 0.614) - ... Jerusalem, in the sixty-seventh year of her age; protesting, with her dying breath, that she had never tra...
  [2] Volume 4, chunk 1037 (similarity 0.608) - ... mountains of Hyrcania revealed the correspondence of the Turkish and Roman arms; and their union must have...
  [3] Volume 5, chunk 1259 (similarity 0.533) - ... invested their slaves with the inheritance of kingdoms; and, in the Oriental style, a crowd of princes aro...
  [4] Volume 6, chunk 597 (similarity 0.516) - ... of the mufti, who dared to reject his testimony in a civil cause: a mixture of servitude and freedom not u...
  [5] Volume 5, chunk 243 (similarity 0.513) - ... was reduced to a narrow circle of existence, and deprived of those faithful mirrors, which reflect to our ...
```

With `--volume 3` only the right Bahram is left:

```bash
node app.js "Who was Bahram, the son of Jezdegerd?" --volume 3
```

```
Question: Who was Bahram, the son of Jezdegerd?
Settings: volume: 3, k: 5, rerank: off

Bahram (also called Varanes) was the son of Jezdegerd [1]. He imitated the intolerant zeal of his father and soon ascended the Persian throne [1].

Sources:
  [1] Volume 3, chunk 716 (similarity 0.614) - ... Jerusalem, in the sixty-seventh year of her age; protesting, with her dying breath, that she had never tra...
  [2] Volume 3, chunk 694 (similarity 0.493) - ... very copiously furnished with historical materials, it has not been possible to remark one action that pro...
  [3] Volume 3, chunk 777 (similarity 0.44) - ... to the pious fraud and credulity of the modern Greeks, since the authentic tradition may be traced within ...
  [4] Volume 3, chunk 218 (similarity 0.43) - ... of his son Abibas, his friend Nicodemus, and the illustrious Stephen, the first martyr of the Christian fa...
  [5] Volume 3, chunk 1248 (similarity 0.429) - ... may be found in the situation of two princes, who conquered France by their valor, their policy, and the m...
```

A question the book cannot answer:

```bash
node app.js "Who won the 2018 football World Cup?"
```

```
Question: Who won the 2018 football World Cup?
Settings: volume: all, k: 5, rerank: off

I don't know - the retrieved passages do not answer this question.

Sources:
  [1] Volume 5, chunk 1346 (similarity 0.188) - ... institution, to refine the temper of Barbarians, and to infuse some principles of faith, justice, and huma...
  [2] Volume 1, chunk 749 (similarity 0.15) - ... _truce of God_, so often and so ineffectually proclaimed by the clergy of the eleventh century, was an obv...
  [3] Volume 3, chunk 1394 (similarity 0.149) - ... against the Tartar horse; and Europe is secure from any future irruptionsof Barbarians; since, before the...
  [4] Volume 1, chunk 944 (similarity 0.147) - ... woods, suddenly attacked the legions in the dusk of the evening, and, it is most probable, after the fatig...
  [5] Volume 1, chunk 937 (similarity 0.147) - ... the two horns of the crescent across the Danube, and wheeling them on a sudden towards the centre, enclose...
```
