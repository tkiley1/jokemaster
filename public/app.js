const $ = (selector) => document.querySelector(selector);

const judges = [
  {
    id: "mara",
    name: "Mara Voss",
    title: "Deadpan Copy Editor",
    weight: 0.32,
  },
  {
    id: "dex",
    name: "Dex Marlow",
    title: "Crowd-pleaser Host",
    weight: 0.34,
  },
  {
    id: "nina",
    name: "Dr. Nina Vale",
    title: "Ruthless Joke Professor",
    weight: 0.34,
  },
];

const state = {
  joke: null,
  judges: {},
  roundId: 0,
  active: false,
  timers: [],
  tickTimer: null,
  startedAt: 0,
};

const generateButton = $("#generate-button");
const againButton = $("#again-button");
const statusChip = $("#status-chip");
const topicLine = $("#topic-line");
const jokeText = $("#joke-text");
const countdownLabel = $("#countdown-label");
const finalScoreLabel = $("#final-score-label");
const meterFill = $("#meter-fill");
const averageScore = $("#average-score");
const verdictText = $("#verdict-text");
const statusCopy = $("#status-copy");
const judgesNodes = new Map(
  judges.map((judge) => [judge.id, document.querySelector(`[data-judge="${judge.id}"]`)])
);

const formatPercent = (value) => `${Math.round(value)}%`;

function setChip(text) {
  statusChip.textContent = text;
}

function clearTimers() {
  for (const timer of state.timers) {
    window.clearTimeout(timer);
  }
  state.timers = [];
  if (state.tickTimer) {
    window.clearInterval(state.tickTimer);
    state.tickTimer = null;
  }
}

function resetJudgeCards() {
  for (const judge of judges) {
    const node = judgesNodes.get(judge.id);
    if (!node) continue;
    node.classList.remove("revealed");
    node.querySelector(".judge-score").textContent = "--";
    node.querySelector(".judge-reveal").textContent = "Waiting for review.";
  }
}

function setJudgeCard(judgeId, result) {
  const node = judgesNodes.get(judgeId);
  if (!node) return;
  node.classList.add("revealed");
  node.querySelector(".judge-score").textContent = String(result.score);
  node.querySelector(".judge-reveal").textContent = `${result.label}. ${result.review}`;
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Request failed with status ${response.status}`);
  }

  return response.json();
}

function startCountdown() {
  const intervalMs = 200;
  const totalMs = 30_000;
  state.startedAt = Date.now();

  state.tickTimer = window.setInterval(() => {
    const elapsed = Date.now() - state.startedAt;
    const remaining = Math.max(0, totalMs - elapsed);
    meterFill.style.width = `${((totalMs - remaining) / totalMs) * 100}%`;
    const nextMark = remaining > 20_000 ? 30 : remaining > 10_000 ? 20 : remaining > 0 ? 10 : 0;
    countdownLabel.textContent =
      nextMark > 0 ? `${Math.ceil(remaining / 1000)}s until next judge` : "All judges complete";
    if (remaining <= 0) {
      window.clearInterval(state.tickTimer);
      state.tickTimer = null;
    }
  }, intervalMs);
}

function finishRound() {
  const entries = judges.map((judge) => state.judges[judge.id]).filter(Boolean);
  const weighted = entries.reduce((sum, entry) => {
    const judge = judges.find((item) => item.id === entry.judgeId);
    return sum + entry.score * (judge?.weight ?? 0);
  }, 0);
  const total = Math.round(weighted);

  averageScore.textContent = String(total);
  finalScoreLabel.textContent = `Score: ${total}`;
  verdictText.textContent =
    total >= 85 ? "Standing ovation" : total >= 70 ? "Respectable chuckle" : total >= 55 ? "Needs work" : "Completely unhinged";
  statusCopy.textContent = "The judges have spoken. Generate another joke to run a fresh round.";
  againButton.classList.remove("hidden");
  generateButton.textContent = "Generate Another Joke";
  generateButton.disabled = false;
  setChip("Round complete");
  state.active = false;
}

async function revealJudge(index) {
  const judge = judges[index];
  if (!state.joke) return;
  setChip(`Judge ${index + 1} of 3`);
  const result = await postJson("/api/judge", {
    joke: state.joke.joke,
    judgeId: judge.id,
  });
  state.judges[judge.id] = result;
  setJudgeCard(judge.id, result);

  const visibleEntries = judges.map((entry) => state.judges[entry.id]).filter(Boolean);
  if (visibleEntries.length === 3) {
    finishRound();
  } else {
    const nextScore = visibleEntries.reduce((sum, entry) => sum + entry.score, 0);
    averageScore.textContent = String(Math.round(nextScore / visibleEntries.length));
  }
}

async function startRound() {
  if (state.active) return;
  state.active = true;
  state.roundId += 1;
  clearTimers();
  resetJudgeCards();
  state.joke = null;
  state.judges = {};
  statusCopy.textContent = "The joke generator is warming up.";
  verdictText.textContent = "Waiting";
  finalScoreLabel.textContent = "Score: -";
  averageScore.textContent = "--";
  meterFill.style.width = "0%";
  countdownLabel.textContent = "Fetching joke...";
  setChip("Writing");
  generateButton.disabled = true;
  againButton.classList.add("hidden");

  try {
    const joke = await postJson("/api/joke", {});
    if (!state.active) return;
    state.joke = joke;
    topicLine.textContent = `Topic: ${joke.topic}`;
    jokeText.textContent = joke.joke;
    setChip(joke.source === "claude" ? "Haiku-generated" : "Demo fallback");
    statusCopy.textContent = "The first judge arrives in 10 seconds. Then the pressure rises.";
    generateButton.textContent = "Judging in progress";
    startCountdown();

    [10_000, 20_000, 30_000].forEach((delay, index) => {
      state.timers.push(
        window.setTimeout(() => {
          revealJudge(index).catch((error) => {
            setChip("Judge failed");
            statusCopy.textContent = `A judge could not finish: ${error.message}`;
            generateButton.disabled = false;
            state.active = false;
          });
        }, delay),
      );
    });
  } catch (error) {
    setChip("Error");
    statusCopy.textContent = error.message;
    generateButton.disabled = false;
    state.active = false;
    generateButton.textContent = "Generate Joke";
    countdownLabel.textContent = "Waiting for a joke...";
  }
}

generateButton.addEventListener("click", startRound);
againButton.addEventListener("click", () => {
  generateButton.disabled = false;
  generateButton.textContent = "Generate Another Joke";
  startRound();
});

window.addEventListener("beforeunload", clearTimers);
