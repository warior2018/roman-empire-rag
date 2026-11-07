const readline = require("readline");
const { config, hasIndex, buildIndex, ask } = require("./rag");

// Show how to use the program
function printHelp() {
  console.log(`Usage:
  node app.js "your question" [--volume 1-6] [--k 5] [--rerank] [--full]
  node app.js                 (interactive mode)

Options:
  --volume N   search only in volume N (1-6)
  --k N        how many passages to give the AI (default ${config.topK})
  --rerank     re-rank results with a cross-encoder (slower, more accurate)
  --full       print the full text of every source

Interactive commands:
  /volume N | /volume all    /k N    /rerank on|off    /full on|off    /help    /exit`);
}

// Check that a value is a whole number in a range
function toInt(value, name, min, max) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${name} must be a whole number from ${min} to ${max}`);
  return n;
}

// Read the question and options from the command line
function parseArgs(argv) {
  const options = { k: config.topK, volume: null, rerank: false, full: false };
  const words = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--rerank") options.rerank = true;
    else if (arg === "--full") options.full = true;
    else if (arg === "--volume") options.volume = toInt(argv[++i], "--volume", 1, 6);
    else if (arg === "--k") options.k = toInt(argv[++i], "--k", 1, 20);
    else if (arg.startsWith("--")) throw new Error(`Unknown option ${arg}. Run with --help`);
    else words.push(arg);
  }
  return { question: words.join(" ").trim(), options };
}

// Print the answer and where it came from
function printResult({ answer, sources }, full) {
  console.log(`\n${answer}\n`);
  if (sources.length === 0) return;
  console.log("Sources:");
  for (const s of sources) {
    const rerank = s.rerankScore === undefined ? "" : `, rerank ${s.rerankScore}`;
    const text = full ? `\n${s.text}\n` : ` - ${s.text.slice(0, 110).replace(/\s+/g, " ")}...`;
    console.log(`  [${s.n}] Volume ${s.volume}, chunk ${s.position} (similarity ${s.score}${rerank})${text}`);
  }
}

// Describe the current search settings
function describe(options) {
  return `volume: ${options.volume ?? "all"}, k: ${options.k}, rerank: ${options.rerank ? "on" : "off"}`;
}

// Interactive mode: ask questions one after another
async function repl(options) {
  console.log("Roman Empire RAG - ask about Gibbon's Decline and Fall. Type /help for commands.");
  console.log(`Settings: ${describe(options)}`);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: "\n> " });
  rl.prompt();

  for await (const input of rl) {
    const line = input.trim();

    if (line.startsWith("/")) {
      const [command, value] = line.slice(1).split(/\s+/);
      if (command === "exit" || command === "quit") break;
      try {
        if (command === "help") printHelp();
        else if (command === "volume") options.volume = value === "all" ? null : toInt(value, "volume", 1, 6);
        else if (command === "k") options.k = toInt(value, "k", 1, 20);
        else if (command === "rerank") options.rerank = value === "on";
        else if (command === "full") options.full = value === "on";
        else console.log("Unknown command. Type /help");
        if (command !== "help") console.log(`Settings: ${describe(options)}`);
      } catch (err) {
        console.log(err.message);
      }
    } else if (line) {
      try {
        printResult(await ask(line, options), options.full);
      } catch (err) {
        console.error(`Error: ${err.message}`);
      }
    }
    rl.prompt();
  }
  rl.close();
}

// Build the index first if it does not exist yet (only on the first run)
async function ensureIndex() {
  if (hasIndex()) return;
  console.log("No index yet - downloading the book and building it (one time, a few minutes)...");
  await buildIndex(({ stage, done, total }) => {
    const count = total ? ` ${done}/${total}` : "";
    process.stdout.write(`\r${stage}${count}`.padEnd(60));
  });
  process.stdout.write("\n");
}

// Main program
async function main() {
  const { question, options } = parseArgs(process.argv.slice(2));
  if (options.help) return printHelp();
  await ensureIndex();
  if (!question) return repl(options);

  console.log(`Question: ${question}`);
  console.log(`Settings: ${describe(options)}`);
  printResult(await ask(question, options), options.full);
}

main().catch((err) => {
  console.error(`\nError: ${err.message}`);
  process.exitCode = 1;
});
