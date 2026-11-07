const askForm = document.getElementById("ask");
const evalForm = document.getElementById("eval");
const buttons = document.querySelectorAll("button");

// Make an HTML element with text
function make(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}

// Show a message under a form (red if it is an error)
function setStatus(id, text, isError = false) {
  const element = document.getElementById(id);
  element.className = isError ? "status error" : "status";
  element.textContent = text;
}

// Send JSON to the server and get JSON back
async function post(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Something went wrong");
  return data;
}

// Ask the server if the index is ready; show progress until it is
async function checkStatus() {
  const status = await (await fetch("/api/status")).json();
  const box = document.getElementById("preparing");

  if (status.ready) {
    box.hidden = true;
    buttons.forEach((b) => (b.disabled = false));
    return;
  }

  box.hidden = false;
  const count = status.total ? ` ${status.done} / ${status.total}` : "";
  document.getElementById("stage").textContent = status.error ? `Error: ${status.error}` : `${status.stage}${count}...`;
  document.getElementById("bar").style.width = status.total ? `${(status.done / status.total) * 100}%` : "0";
  if (!status.error) setTimeout(checkStatus, 1000);
}

// Show the answer and its sources
function showAnswer({ answer, sources }) {
  const box = make("div", undefined, "box");
  box.append(make("h2", "Answer"));
  box.append(make("div", answer, "answer"));

  if (sources.length > 0) {
    box.append(make("h2", "Sources"));
    for (const s of sources) {
      const rerank = s.rerankScore === undefined ? "" : `, rerank ${s.rerankScore}`;
      const details = make("details");
      details.append(make("summary", `[${s.n}] Volume ${s.volume}, chunk ${s.position} (similarity ${s.score}${rerank})`));
      details.append(make("p", s.text));
      box.append(details);
    }
  }
  document.getElementById("answer").replaceChildren(box);
}

// Show the evaluation result as a table
function showEvaluation(result) {
  const box = make("div", undefined, "box");
  const recall = (result.recall * 100).toFixed(1);
  box.append(make("h2", `Recall@${result.k}: ${recall}% (${result.hits}/${result.total})   MRR: ${result.mrr.toFixed(3)}   Re-rank: ${result.rerank ? "on" : "off"}`));

  const table = make("table");
  for (const r of result.results) {
    const row = make("tr");
    row.append(make("td", r.rank ? `HIT@${r.rank}` : "MISS", r.rank ? "hit" : "miss"));
    row.append(make("td", r.question));
    table.append(row);
  }
  box.append(table);
  document.getElementById("eval-result").replaceChildren(box);
}

// Send the question and show the answer
askForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(askForm);
  const button = askForm.querySelector("button");
  button.disabled = true;
  setStatus("ask-status", "Searching the book and asking the AI...");

  try {
    showAnswer(
      await post("/api/ask", {
        question: data.get("question"),
        volume: data.get("volume"),
        k: data.get("k"),
        rerank: data.get("rerank") === "on",
      })
    );
    setStatus("ask-status", "");
  } catch (err) {
    setStatus("ask-status", `Error: ${err.message}`, true);
  } finally {
    button.disabled = false;
  }
});

// Run the evaluation and show the table
evalForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(evalForm);
  const button = evalForm.querySelector("button");
  button.disabled = true;
  setStatus("eval-status", "Running 30 searches...");

  try {
    showEvaluation(await post("/api/eval", { k: data.get("k"), rerank: data.get("rerank") === "on" }));
    setStatus("eval-status", "");
  } catch (err) {
    setStatus("eval-status", `Error: ${err.message}`, true);
  } finally {
    button.disabled = false;
  }
});

checkStatus();
