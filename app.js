import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const FITTRACK_CONFIG = window.FITTRACK_CONFIG || {};
const SUPABASE_URL = FITTRACK_CONFIG.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = FITTRACK_CONFIG.SUPABASE_ANON_KEY || "";

const supabase = SUPABASE_URL && SUPABASE_ANON_KEY
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    })
  : null;

function supabaseEnabled() {
  return !!supabase;
}

const STORAGE_KEY = "workout_ledger_v3";
const LEGACY_STORAGE_KEY = "daily_fitness_tracker_v2";
const PENDING_PROFILE_KEY = "fittrack_pending_profile_v1";
const KG_IN_LB = 2.20462;

const DEFAULT_DAY = { pushups: 0, lunges: 0, situps: 0, weight: null, notes: "" };
const EXERCISES = [
  { key: "pushups", label: "Pushups", hint: "Upper body", abbr: "P" },
  { key: "lunges", label: "Lunges", hint: "Legs + balance", abbr: "L" },
  { key: "situps", label: "Situps", hint: "Core", abbr: "S" }
];

let state = loadState();
let selectedDate = startOfDay(new Date());
let chartRange = 30;
let saveTimer = null;
let lastSavedAt = null;
let syncTimer = null;
let currentLbMetric = "total_reps";
let leaderboardCache = [];

let currentUser = null;
let currentProfile = null;
let authMode = "signin";

const exerciseListEl = document.getElementById("exerciseList");
const statsGridEl = document.getElementById("statsGrid");
const goalGridEl = document.getElementById("goalGrid");
const historyListEl = document.getElementById("historyList");
const todayTitleEl = document.getElementById("todayTitle");
const todaySubEl = document.getElementById("todaySub");
const dateInputEl = document.getElementById("dateInput");
const saveNowBtn = document.getElementById("saveNowBtn");
const savedTinyEl = document.getElementById("savedTiny");
const saveStatusEl = document.getElementById("saveStatus");
const saveText = document.getElementById("saveText");
const toastEl = document.getElementById("toast");

const weightInput = document.getElementById("weightInput");
const notesInput = document.getElementById("notesInput");
const streakChip = document.getElementById("streakChip");

const fromDateEl = document.getElementById("fromDate");
const toDateEl = document.getElementById("toDate");
const searchNotesEl = document.getElementById("searchNotes");

const chartCanvas = document.getElementById("chart");
const chartCtx = chartCanvas.getContext("2d");

const accountBtn = document.getElementById("accountBtn");
const authBackdrop = document.getElementById("authBackdrop");
const authCloseBtn = document.getElementById("authCloseBtn");
const authModeEl = document.getElementById("authMode");
const authEmailEl = document.getElementById("authEmail");
const authPasswordEl = document.getElementById("authPassword");
const authUsernameEl = document.getElementById("authUsername");
const authDisplayNameEl = document.getElementById("authDisplayName");
const signupExtraEl = document.getElementById("signupExtra");
const authSubmitBtn = document.getElementById("authSubmitBtn");
const logoutBtn = document.getElementById("logoutBtn");
const authMsgEl = document.getElementById("authMsg");

const refreshLeaderboardsBtn = document.getElementById("refreshLeaderboardsBtn");
const leaderboardListEl = document.getElementById("leaderboardList");
const lbRangeEl = document.getElementById("lbRange");
const lbMetricEl = document.getElementById("lbMetric");
const lbSearchInput = document.getElementById("lbSearchInput");

const profileLookupInput = document.getElementById("profileLookupInput");
const profileLookupBtn = document.getElementById("profileLookupBtn");
const profileViewEl = document.getElementById("profileView");
const myProfileLinkEl = document.getElementById("myProfileLink");

const exerciseEls = new Map();
const goalEls = new Map();

document.getElementById("prevDayBtn").addEventListener("click", () => shiftDay(-1));
document.getElementById("nextDayBtn").addEventListener("click", () => shiftDay(1));
document.getElementById("jumpTodayBtn").addEventListener("click", () => {
  selectedDate = startOfDay(new Date());
  render();
  toast("Jumped to today");
});

dateInputEl.addEventListener("change", () => {
  if (!dateInputEl.value) return;
  selectedDate = startOfDay(new Date(dateInputEl.value + "T00:00:00"));
  render();
  toast("Opened " + prettyDate(selectedDate));
});

saveNowBtn.addEventListener("click", () => {
  flushSaveNow();
  toast("Saved");
});

document.getElementById("resetDayBtn").addEventListener("click", resetDay);
document.getElementById("wipeAllBtn").addEventListener("click", wipeAll);
document.getElementById("copyBtn").addEventListener("click", copySummary);
document.getElementById("exportBtn").addEventListener("click", exportJSON);
document.getElementById("exportCsvBtn").addEventListener("click", exportCSV);
document.getElementById("importBtn").addEventListener("click", importJSON);
document.getElementById("clearFiltersBtn").addEventListener("click", clearFilters);

document.querySelectorAll('[aria-label="Theme"] button').forEach((btn) => {
  btn.addEventListener("click", () => setTheme(btn.dataset.theme));
});

document.querySelectorAll("#unitToggle button").forEach((btn) => {
  btn.addEventListener("click", () => setWeightUnit(btn.dataset.unit));
});

document.querySelectorAll('[aria-label="Chart range"] button').forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll('[aria-label="Chart range"] button').forEach((b) => {
      b.classList.remove("active");
      b.setAttribute("aria-selected", "false");
    });
    btn.classList.add("active");
    btn.setAttribute("aria-selected", "true");
    chartRange = btn.dataset.range === "all" ? "all" : Number(btn.dataset.range);
    renderChart();
  });
});

[fromDateEl, toDateEl, searchNotesEl].forEach((el) => {
  el.addEventListener("input", renderHistory);
});

weightInput.addEventListener("input", () => {
  const key = isoDateLocal(selectedDate);
  const valueLb = parseWeightInput(weightInput.value);
  setDayField(key, "weight", valueLb, false);
  renderStats();
  renderChart();
  renderHistory();
});

notesInput.addEventListener("input", () => {
  const key = isoDateLocal(selectedDate);
  setDayField(key, "notes", notesInput.value.slice(0, 2000), false);
  renderHistory();
});

window.addEventListener("resize", () => {
  resizeCanvas();
  renderChart();
});

initExercises();
initGoals();
applySavedTheme();
applySavedUnit();
initAuthAndCommunity();
resizeCanvas();
render();
updateSavedTiny();
document.body.classList.add("loaded");

// -------------------- helpers --------------------
function pad2(n) {
  return String(n).padStart(2, "0");
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function isoDateLocal(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function toDateObj(key) {
  return new Date(key + "T00:00:00");
}

function prettyDate(d) {
  const today = startOfDay(new Date());
  const diff = Math.round((startOfDay(d) - today) / 86400000);
  if (diff === 0) return "Today";
  if (diff === -1) return "Yesterday";
  if (diff === 1) return "Tomorrow";
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function fullDate(d) {
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

function shortDate(key) {
  const d = toDateObj(key);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function sumReps(dayObj) {
  return EXERCISES.reduce((acc, ex) => acc + (Number(dayObj?.[ex.key]) || 0), 0);
}

function hasAnyActivity(dayObj) {
  if (!dayObj) return false;
  return sumReps(dayObj) > 0 || Number.isFinite(dayObj.weight) || String(dayObj.notes || "").trim().length > 0;
}

function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  }[c]));
}

function haptic(ms = 10) {
  try {
    if (navigator.vibrate) navigator.vibrate(ms);
  } catch (e) {
  }
}

function buildFreshState() {
  return {
    days: {},
    settings: { theme: "auto", weightUnit: "lb" },
    goals: { pushups: 0, lunges: 0, situps: 0 }
  };
}

function loadState() {
  const keys = [STORAGE_KEY, LEGACY_STORAGE_KEY];
  for (const key of keys) {
    const raw = localStorage.getItem(key);
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") continue;
      const next = buildFreshState();
      next.days = parsed.days && typeof parsed.days === "object" ? parsed.days : {};
      next.settings = parsed.settings && typeof parsed.settings === "object" ? { ...next.settings, ...parsed.settings } : next.settings;
      next.goals = parsed.goals && typeof parsed.goals === "object" ? { ...next.goals, ...parsed.goals } : next.goals;
      for (const k of Object.keys(next.days)) {
        next.days[k] = { ...DEFAULT_DAY, ...(next.days[k] || {}) };
      }
      if (key !== STORAGE_KEY) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      }
      return next;
    } catch (e) {
      continue;
    }
  }
  return buildFreshState();
}

function saveState(immediate = false) {
  setSaving("saving");
  clearTimeout(saveTimer);
  if (immediate) {
    flushSaveNow();
    return;
  }
  saveTimer = setTimeout(flushSaveNow, 150);
}

function flushSaveNow() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    lastSavedAt = new Date();
    updateSavedTiny();
    setSaving("saved");
  } catch (e) {
    setSaving("error");
    toast("Save failed");
  }
}

function setSaving(status) {
  if (saveStatusEl) saveStatusEl.dataset.state = status;
  if (status === "saving") {
    saveText.textContent = "Saving";
  } else if (status === "error") {
    saveText.textContent = "Error";
  } else {
    saveText.textContent = "Saved";
  }
}

function updateSavedTiny() {
  if (!savedTinyEl) return;
  if (!lastSavedAt) {
    savedTinyEl.textContent = "Not saved yet";
    return;
  }
  const hh = String(lastSavedAt.getHours()).padStart(2, "0");
  const mm = String(lastSavedAt.getMinutes()).padStart(2, "0");
  savedTinyEl.textContent = `Saved ${hh}:${mm}`;
}

function setTheme(theme) {
  state.settings.theme = theme;
  document.documentElement.setAttribute("data-theme", theme);
  document.querySelectorAll('[aria-label="Theme"] button').forEach((b) => {
    const on = b.dataset.theme === theme;
    b.classList.toggle("active", on);
    b.setAttribute("aria-selected", on ? "true" : "false");
  });
  saveState(true);
}

function applySavedTheme() {
  const theme = state.settings.theme || "auto";
  document.documentElement.setAttribute("data-theme", theme);
  document.querySelectorAll('[aria-label="Theme"] button').forEach((b) => {
    const on = b.dataset.theme === theme;
    b.classList.toggle("active", on);
    b.setAttribute("aria-selected", on ? "true" : "false");
  });
}

function setWeightUnit(unit) {
  if (unit !== "lb" && unit !== "kg") return;
  state.settings.weightUnit = unit;
  applySavedUnit();
  saveState(true);
  render();
}

function getWeightUnit() {
  return state.settings.weightUnit === "kg" ? "kg" : "lb";
}

function applySavedUnit() {
  const unit = getWeightUnit();
  document.querySelectorAll("#unitToggle button").forEach((b) => {
    const on = b.dataset.unit === unit;
    b.classList.toggle("active", on);
    b.setAttribute("aria-selected", on ? "true" : "false");
  });
}

function parseWeightInput(value) {
  const n = parseFloat(value);
  if (!Number.isFinite(n)) return null;
  const unit = getWeightUnit();
  const lb = unit === "kg" ? n * KG_IN_LB : n;
  return clamp(lb, 0, 2000);
}

function formatWeight(valueLb, digits = 1) {
  if (!Number.isFinite(valueLb)) return "";
  const unit = getWeightUnit();
  const value = unit === "kg" ? valueLb / KG_IN_LB : valueLb;
  return value.toFixed(digits);
}

function formatWeightWithUnit(valueLb, digits = 1) {
  const formatted = formatWeight(valueLb, digits);
  if (!formatted) return "";
  return `${formatted} ${getWeightUnit()}`;
}

function formatSignedWeight(deltaLb) {
  if (!Number.isFinite(deltaLb)) return "--";
  const unit = getWeightUnit();
  const value = unit === "kg" ? deltaLb / KG_IN_LB : deltaLb;
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)} ${unit}`;
}

function ensureDay(dateKey) {
  if (!state.days[dateKey]) state.days[dateKey] = { ...DEFAULT_DAY };
  else state.days[dateKey] = { ...DEFAULT_DAY, ...(state.days[dateKey] || {}) };
  return state.days[dateKey];
}

function getDay(dateKey) {
  return ensureDay(dateKey);
}

function shiftDay(delta) {
  const d = new Date(selectedDate);
  d.setDate(d.getDate() + delta);
  selectedDate = startOfDay(d);
  render();
}

function setDayField(dateKey, field, value, doRender = true) {
  const day = ensureDay(dateKey);
  day[field] = value;
  saveState();
  scheduleSyncUp(dateKey);
  if (doRender) render();
}

function setRep(dateKey, exKey, newVal) {
  const day = ensureDay(dateKey);
  day[exKey] = clamp(Math.trunc(newVal), 0, 999999);
  saveState();
  scheduleSyncUp(dateKey);
  renderExercises();
  renderStats();
  renderHistory();
  renderStreak();
  renderChart();
}

function render() {
  const key = isoDateLocal(selectedDate);
  if (dateInputEl) dateInputEl.value = key;

  const day = ensureDay(key);
  todayTitleEl.textContent = prettyDate(selectedDate);
  todaySubEl.textContent = fullDate(selectedDate);

  renderExercises();
  renderGoals(day);

  weightInput.value = formatWeight(day.weight);
  notesInput.value = String(day.notes || "");

  renderStats();
  renderHistory();
  renderStreak();
  renderChart();
}

function initExercises() {
  exerciseListEl.innerHTML = "";
  EXERCISES.forEach((ex) => {
    const row = document.createElement("div");
    row.className = "exercise";

    const info = document.createElement("div");
    info.className = "exercise-info";
    const title = document.createElement("h3");
    title.textContent = ex.label;
    const hint = document.createElement("p");
    hint.textContent = ex.hint;
    info.appendChild(title);
    info.appendChild(hint);

    const controls = document.createElement("div");
    controls.className = "exercise-controls";

    const stepper = document.createElement("div");
    stepper.className = "stepper";
    const minus = document.createElement("button");
    minus.className = "btn ghost";
    minus.type = "button";
    minus.textContent = "-";
    minus.addEventListener("click", () => {
      const key = isoDateLocal(selectedDate);
      const current = Number(getDay(key)[ex.key]) || 0;
      setRep(key, ex.key, current - 1);
    });

    const input = document.createElement("input");
    input.className = "numInput";
    input.type = "number";
    input.inputMode = "numeric";
    input.min = "0";
    input.step = "1";
    input.addEventListener("input", () => {
      const n = parseInt(input.value, 10);
      if (!Number.isFinite(n)) return;
      setRep(isoDateLocal(selectedDate), ex.key, n);
    });

    const plus = document.createElement("button");
    plus.className = "btn ghost";
    plus.type = "button";
    plus.textContent = "+";
    plus.addEventListener("click", () => {
      const key = isoDateLocal(selectedDate);
      const current = Number(getDay(key)[ex.key]) || 0;
      setRep(key, ex.key, current + 1);
    });

    addHoldRepeat(plus, () => {
      const key = isoDateLocal(selectedDate);
      const current = Number(getDay(key)[ex.key]) || 0;
      setRep(key, ex.key, current + 1);
    });
    addHoldRepeat(minus, () => {
      const key = isoDateLocal(selectedDate);
      const current = Number(getDay(key)[ex.key]) || 0;
      setRep(key, ex.key, current - 1);
    });

    stepper.appendChild(minus);
    stepper.appendChild(input);
    stepper.appendChild(plus);

    const quick = document.createElement("div");
    quick.className = "quick";
    [5, 10, 25].forEach((amount) => {
      const chip = document.createElement("button");
      chip.className = "chip-btn";
      chip.type = "button";
      chip.textContent = `+${amount}`;
      chip.addEventListener("click", () => {
        const key = isoDateLocal(selectedDate);
        const current = Number(getDay(key)[ex.key]) || 0;
        setRep(key, ex.key, current + amount);
      });
      quick.appendChild(chip);
    });

    const progress = document.createElement("div");
    progress.className = "mini-progress";
    const progressFill = document.createElement("span");
    progress.appendChild(progressFill);

    const meta = document.createElement("div");
    meta.className = "mini-meta";

    controls.appendChild(stepper);
    controls.appendChild(quick);
    controls.appendChild(progress);
    controls.appendChild(meta);

    row.appendChild(info);
    row.appendChild(controls);
    exerciseListEl.appendChild(row);

    exerciseEls.set(ex.key, { input, progressFill, meta });
  });
}

function renderExercises() {
  const key = isoDateLocal(selectedDate);
  const day = ensureDay(key);
  EXERCISES.forEach((ex) => {
    const el = exerciseEls.get(ex.key);
    if (!el) return;
    const value = Number(day[ex.key]) || 0;
    if (document.activeElement !== el.input) {
      el.input.value = String(value);
    }
    const goal = Number(state.goals?.[ex.key]) || 0;
    const pct = goal > 0 ? clamp(value / goal, 0, 1) : 0;
    el.progressFill.style.width = `${Math.round(pct * 100)}%`;
    el.meta.textContent = goal > 0 ? `${value} of ${goal}` : "Set a daily goal";
  });
}

function initGoals() {
  goalGridEl.innerHTML = "";
  EXERCISES.forEach((ex) => {
    const card = document.createElement("div");
    card.className = "goal-card";

    const title = document.createElement("div");
    title.className = "goal-title";
    const label = document.createElement("span");
    label.textContent = ex.label;
    const value = document.createElement("span");
    value.textContent = "--";
    title.appendChild(label);
    title.appendChild(value);

    const input = document.createElement("input");
    input.className = "goal-input";
    input.type = "number";
    input.inputMode = "numeric";
    input.min = "0";
    input.step = "1";
    input.placeholder = "Goal";
    input.addEventListener("input", () => {
      const v = parseInt(input.value, 10);
      state.goals[ex.key] = Number.isFinite(v) ? clamp(v, 0, 999999) : 0;
      saveState(true);
      renderExercises();
      renderGoals(ensureDay(isoDateLocal(selectedDate)));
      renderStats();
    });

    const progress = document.createElement("div");
    progress.className = "mini-progress";
    const progressFill = document.createElement("span");
    progress.appendChild(progressFill);

    const meta = document.createElement("div");
    meta.className = "goal-meta";

    card.appendChild(title);
    card.appendChild(input);
    card.appendChild(progress);
    card.appendChild(meta);
    goalGridEl.appendChild(card);

    goalEls.set(ex.key, { input, progressFill, meta, value });
  });
}

function renderGoals(day) {
  EXERCISES.forEach((ex) => {
    const el = goalEls.get(ex.key);
    if (!el) return;
    const goal = Number(state.goals?.[ex.key]) || 0;
    const current = Number(day?.[ex.key]) || 0;
    const pct = goal > 0 ? clamp(current / goal, 0, 1) : 0;
    if (document.activeElement !== el.input) {
      el.input.value = goal ? String(goal) : "";
    }
    el.progressFill.style.width = `${Math.round(pct * 100)}%`;
    el.meta.textContent = goal > 0 ? `${current} of ${goal} today` : "Set a daily target";
    el.value.textContent = goal > 0 ? `${Math.round(pct * 100)}%` : "--";
  });
}

function totalsForLastNDays(days) {
  const today = startOfDay(new Date());
  let total = 0;
  let weightSum = 0;
  let weightCount = 0;
  let activeDays = 0;

  for (let i = 0; i < days; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = isoDateLocal(d);
    const day = state.days[key];
    if (day && hasAnyActivity(day)) activeDays++;
    total += sumReps(day);
    if (day && Number.isFinite(day.weight)) {
      weightSum += day.weight;
      weightCount++;
    }
  }

  return {
    total,
    avg: total / days,
    weightAvg: weightCount ? weightSum / weightCount : null,
    activeDays
  };
}

function totalsForRange(startAgo, endAgo) {
  const today = startOfDay(new Date());
  let total = 0;
  for (let i = startAgo; i <= endAgo; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = isoDateLocal(d);
    const day = state.days[key];
    total += sumReps(day);
  }
  return { total };
}

function getBestDay() {
  const keys = Object.keys(state.days || {});
  let bestKey = null;
  let bestTotal = -1;
  keys.forEach((k) => {
    const total = sumReps(state.days[k]);
    if (total > bestTotal) {
      bestTotal = total;
      bestKey = k;
    }
  });
  if (!bestKey || bestTotal <= 0) return null;
  return { key: bestKey, total: bestTotal };
}

function weightTrend(days) {
  const today = startOfDay(new Date());
  let first = null;
  let last = null;
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = isoDateLocal(d);
    const w = state.days[key]?.weight;
    if (!Number.isFinite(w)) continue;
    if (!first) first = { key, weight: w };
    last = { key, weight: w };
  }
  if (!first || !last || first.key === last.key) return null;
  return { delta: last.weight - first.weight, first, last };
}

function renderStats() {
  const todayKey = isoDateLocal(selectedDate);
  const today = getDay(todayKey);
  const repsTotal = sumReps(today);
  const goals = state.goals || { pushups: 0, lunges: 0, situps: 0 };
  const goalTotal = EXERCISES.reduce((acc, ex) => acc + (Number(goals[ex.key]) || 0), 0);
  const pct = goalTotal > 0 ? Math.round((repsTotal / goalTotal) * 100) : null;

  const last7 = totalsForLastNDays(7);
  const prev7 = totalsForRange(7, 13);
  const delta7 = last7.total - prev7.total;
  const deltaText = prev7.total > 0 ? `${delta7 >= 0 ? "+" : ""}${delta7} vs prev 7d` : "First week logged";

  const last30 = totalsForLastNDays(30);
  const best = getBestDay();
  const trend = weightTrend(14);

  statsGridEl.innerHTML = "";
  statsGridEl.appendChild(statCard(
    "Today total",
    String(repsTotal),
    pct === null ? "Set goals for progress" : `${pct}% of daily goal`
  ));
  statsGridEl.appendChild(statCard(
    "7 day average",
    String(Math.round(last7.avg)),
    deltaText
  ));
  statsGridEl.appendChild(statCard(
    "30 day volume",
    String(last30.total),
    `${last30.activeDays} days logged`
  ));
  statsGridEl.appendChild(statCard(
    "Best day",
    best ? String(best.total) : "--",
    best ? shortDate(best.key) : "Log reps to set a PR"
  ));
  statsGridEl.appendChild(statCard(
    "Weight trend",
    trend ? formatSignedWeight(trend.delta) : "--",
    trend ? `${shortDate(trend.first.key)} to ${shortDate(trend.last.key)}` : "Log weight to see change"
  ));
}

function statCard(title, value, meta) {
  const el = document.createElement("div");
  el.className = "stat-card";
  const titleEl = document.createElement("div");
  titleEl.className = "stat-title";
  titleEl.textContent = title;
  const valueEl = document.createElement("div");
  valueEl.className = "stat-value";
  valueEl.textContent = value;
  const metaEl = document.createElement("div");
  metaEl.className = "stat-meta";
  metaEl.textContent = meta;
  el.appendChild(titleEl);
  el.appendChild(valueEl);
  el.appendChild(metaEl);
  return el;
}

function computeHistoryRows() {
  const keys = Object.keys(state.days || {}).sort().reverse();
  let filtered = keys;

  const from = fromDateEl.value ? fromDateEl.value : null;
  const to = toDateEl.value ? toDateEl.value : null;
  if (from) filtered = filtered.filter((k) => k >= from);
  if (to) filtered = filtered.filter((k) => k <= to);

  const q = (searchNotesEl.value || "").trim().toLowerCase();
  if (q) {
    filtered = filtered.filter((k) => String(state.days[k]?.notes || "").toLowerCase().includes(q));
  }

  filtered = filtered.filter((k) => hasAnyActivity(state.days[k]));

  return filtered.map((k) => {
    const obj = state.days[k] || {};
    const reps = sumReps(obj);
    const parts = [];
    if (reps > 0) parts.push(`${reps} reps`);
    if (Number.isFinite(obj.weight)) parts.push(formatWeightWithUnit(obj.weight));
    if (String(obj.notes || "").trim()) parts.push("notes");
    return {
      key: k,
      label: prettyDate(toDateObj(k)),
      subtitle: parts.length ? parts.join(" | ") : "No details",
      pushups: Number(obj.pushups) || 0,
      lunges: Number(obj.lunges) || 0,
      situps: Number(obj.situps) || 0
    };
  });
}

function renderHistory() {
  const rows = computeHistoryRows();
  historyListEl.innerHTML = "";

  if (rows.length === 0) {
    const empty = document.createElement("p");
    empty.className = "note";
    empty.textContent = "No matching entries yet. Log a day or adjust filters.";
    historyListEl.appendChild(empty);
    return;
  }

  rows.slice(0, 200).forEach((r) => {
    const row = document.createElement("div");
    row.className = "history-row";

    const left = document.createElement("div");
    const date = document.createElement("p");
    date.className = "date";
    date.textContent = r.label;
    const mini = document.createElement("p");
    mini.className = "mini";
    mini.textContent = r.subtitle;
    left.appendChild(date);
    left.appendChild(mini);

    const right = document.createElement("div");
    right.className = "history-tags";
    right.innerHTML = `
      <span>P ${r.pushups}</span>
      <span>L ${r.lunges}</span>
      <span>S ${r.situps}</span>
    `;

    row.addEventListener("click", () => {
      selectedDate = startOfDay(new Date(r.key + "T00:00:00"));
      render();
      toast("Opened " + r.label);
    });

    row.appendChild(left);
    row.appendChild(right);
    historyListEl.appendChild(row);
  });

  if (rows.length > 200) {
    const more = document.createElement("p");
    more.className = "note";
    more.textContent = `Showing newest 200 matches (you have ${rows.length}). Tighten filters to narrow down.`;
    historyListEl.appendChild(more);
  }
}

function renderStreak() {
  const today = startOfDay(new Date());
  let streak = 0;
  for (let i = 0; i < 3650; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = isoDateLocal(d);
    const obj = state.days[key] || null;
    if (sumReps(obj) > 0) streak++;
    else break;
  }
  streakChip.textContent = `Streak: ${streak}`;
}

function resetDay() {
  const key = isoDateLocal(selectedDate);
  if (!confirm("Reset this day to empty values?")) return;
  state.days[key] = { ...DEFAULT_DAY };
  saveState();
  scheduleSyncUp(key);
  render();
  toast("Day reset");
  haptic();
}

function wipeAll() {
  if (!confirm("This will delete all saved days on this device. Continue?")) return;
  state = buildFreshState();
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
  }
  setSaving("saved");
  render();
  toast("All data wiped");
  haptic(18);
}

async function copySummary() {
  const key = isoDateLocal(selectedDate);
  const d = toDateObj(key);
  const day = getDay(key);
  const reps = sumReps(day);
  const weight = Number.isFinite(day.weight) ? formatWeightWithUnit(day.weight) : "--";
  const notes = String(day.notes || "").trim();
  const text = [
    `Workout Ledger - ${prettyDate(d)} (${key})`,
    `Pushups: ${Number(day.pushups) || 0}`,
    `Lunges: ${Number(day.lunges) || 0}`,
    `Situps: ${Number(day.situps) || 0}`,
    `Total: ${reps} reps`,
    `Weight: ${weight}`,
    `Notes: ${notes || "--"}`
  ].join("\n");

  try {
    await navigator.clipboard.writeText(text);
    toast("Copied");
    haptic();
  } catch (e) {
    prompt("Copy this:", text);
  }
}

function exportJSON() {
  const payload = JSON.stringify(state, null, 2);
  downloadBlob(payload, "application/json", "workout-ledger-export.json");
  toast("Exported");
  haptic();
}

function exportCSV() {
  const keys = Object.keys(state.days || {}).sort();
  const header = ["date", "pushups", "lunges", "situps", "total_reps", "weight_lb", "notes"];
  const lines = [header.join(",")];
  for (const k of keys) {
    const d = state.days[k] || {};
    if (!hasAnyActivity(d)) continue;
    const row = [
      k,
      Number(d.pushups) || 0,
      Number(d.lunges) || 0,
      Number(d.situps) || 0,
      sumReps(d),
      Number.isFinite(d.weight) ? d.weight.toFixed(1) : "",
      csvEscape(String(d.notes || ""))
    ];
    lines.push(row.join(","));
  }
  downloadBlob(lines.join("\n"), "text/csv", "workout-ledger.csv");
  toast("CSV exported");
  haptic();
}

function csvEscape(s) {
  const needs = /[",\n]/.test(s);
  const t = s.replace(/"/g, "\"\"");
  return needs ? `"${t}"` : t;
}

function downloadBlob(text, mime, filename) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function importJSON() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/json";
  input.onchange = async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== "object" || !parsed.days || typeof parsed.days !== "object") {
        alert("Invalid file format.");
        return;
      }
      state = buildFreshState();
      state.days = parsed.days;
      state.settings = parsed.settings && typeof parsed.settings === "object" ? { ...state.settings, ...parsed.settings } : state.settings;
      state.goals = parsed.goals && typeof parsed.goals === "object" ? { ...state.goals, ...parsed.goals } : state.goals;
      for (const k of Object.keys(state.days)) {
        state.days[k] = { ...DEFAULT_DAY, ...(state.days[k] || {}) };
      }
      saveState(true);
      applySavedTheme();
      applySavedUnit();
      render();
      toast("Imported");
      haptic();
    } catch (e) {
      alert("Import failed.");
    }
  };
  input.click();
}

function clearFilters() {
  fromDateEl.value = "";
  toDateEl.value = "";
  searchNotesEl.value = "";
  renderHistory();
  toast("Filters cleared");
}

function addHoldRepeat(btn, action) {
  let t = null;
  let interval = null;
  const start = () => {
    action();
    t = setTimeout(() => {
      interval = setInterval(action, 70);
    }, 350);
  };
  const stop = () => {
    clearTimeout(t);
    clearInterval(interval);
    t = null;
    interval = null;
  };
  btn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    start();
  });
  btn.addEventListener("pointerup", stop);
  btn.addEventListener("pointercancel", stop);
  btn.addEventListener("pointerleave", stop);
  btn.addEventListener("contextmenu", (e) => e.preventDefault());
}

// -------------------- chart --------------------
function resizeCanvas() {
  const rect = chartCanvas.getBoundingClientRect();
  const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
  chartCanvas.width = Math.floor(rect.width * dpr);
  chartCanvas.height = Math.floor(rect.height * dpr);
  chartCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function getChartKeys() {
  const keys = Object.keys(state.days || {}).sort();
  if (keys.length === 0) return [];
  if (chartRange === "all") return keys;
  const today = startOfDay(new Date());
  const min = new Date(today);
  min.setDate(min.getDate() - (chartRange - 1));
  const minKey = isoDateLocal(min);
  return keys.filter((k) => k >= minKey);
}

function renderChart() {
  const rect = chartCanvas.getBoundingClientRect();
  const W = rect.width;
  const H = rect.height;
  if (!W || !H) return;

  const keys = getChartKeys().filter((k) => hasAnyActivity(state.days[k]));
  chartCtx.clearRect(0, 0, W, H);

  const cs = getComputedStyle(document.documentElement);
  const text = cs.getPropertyValue("--text").trim() || "#fff";
  const muted = cs.getPropertyValue("--muted-2").trim() || "rgba(255,255,255,.55)";
  const stroke = cs.getPropertyValue("--stroke").trim() || "rgba(255,255,255,.1)";
  const pushupsColor = cs.getPropertyValue("--accent").trim() || "#f06b4f";
  const lungesColor = cs.getPropertyValue("--accent-2").trim() || "#f4b13c";
  const situpsColor = cs.getPropertyValue("--accent-3").trim() || "#45b5b0";

  const padL = 44;
  const padR = 14;
  const padT = 12;
  const padB = 28;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  chartCtx.globalAlpha = 1;
  chartCtx.lineWidth = 1;
  chartCtx.strokeStyle = stroke;
  chartCtx.beginPath();
  chartCtx.moveTo(padL, padT);
  chartCtx.lineTo(padL, padT + innerH);
  chartCtx.lineTo(padL + innerW, padT + innerH);
  chartCtx.stroke();

  if (keys.length === 0) {
    chartCtx.fillStyle = muted;
    chartCtx.font = "12px " + getComputedStyle(document.body).fontFamily;
    chartCtx.fillText("No chart data yet. Log reps or weight to see trends.", padL, padT + 24);
    return;
  }

  const series = keys.map((k) => {
    const d = state.days[k] || {};
    const p = Number(d.pushups) || 0;
    const l = Number(d.lunges) || 0;
    const s = Number(d.situps) || 0;
    const total = p + l + s;
    const w = Number.isFinite(d.weight) ? d.weight : null;
    return { k, p, l, s, total, w };
  });

  const maxReps = Math.max(10, ...series.map((x) => x.total));
  const weights = series.map((x) => x.w).filter((v) => Number.isFinite(v));
  const wMin = weights.length ? Math.min(...weights) : null;
  const wMax = weights.length ? Math.max(...weights) : null;
  const wSpan = weights.length && wMin != null && wMax != null ? Math.max(1e-6, wMax - wMin) : null;

  const n = series.length;
  const gap = Math.max(2, Math.min(10, innerW / n * 0.15));
  const barW = Math.max(6, Math.min(18, (innerW - gap * (n - 1)) / n));

  chartCtx.fillStyle = muted;
  chartCtx.font = "11px " + getComputedStyle(document.body).fontFamily;
  const ticks = 4;
  for (let i = 0; i <= ticks; i++) {
    const t = i / ticks;
    const y = padT + innerH - t * innerH;
    chartCtx.strokeStyle = stroke;
    chartCtx.beginPath();
    chartCtx.moveTo(padL, y);
    chartCtx.lineTo(padL + innerW, y);
    chartCtx.stroke();
    const val = Math.round(t * maxReps);
    chartCtx.fillText(String(val), 8, y + 4);
  }

  for (let i = 0; i < n; i++) {
    const x = padL + i * (barW + gap);
    const item = series[i];
    const scaleY = (v) => (v / maxReps) * innerH;
    const hp = scaleY(item.p);
    const hl = scaleY(item.l);
    const hs = scaleY(item.s);

    let yBase = padT + innerH;

    chartCtx.fillStyle = situpsColor;
    chartCtx.globalAlpha = 0.65;
    chartCtx.fillRect(x, yBase - hs, barW, hs);
    yBase -= hs;

    chartCtx.fillStyle = lungesColor;
    chartCtx.globalAlpha = 0.6;
    chartCtx.fillRect(x, yBase - hl, barW, hl);
    yBase -= hl;

    chartCtx.fillStyle = pushupsColor;
    chartCtx.globalAlpha = 0.6;
    chartCtx.fillRect(x, yBase - hp, barW, hp);

    chartCtx.globalAlpha = 1;
  }

  if (weights.length) {
    chartCtx.strokeStyle = text;
    chartCtx.lineWidth = 2;
    chartCtx.globalAlpha = 0.9;
    chartCtx.beginPath();

    let started = false;
    for (let i = 0; i < n; i++) {
      const item = series[i];
      if (!Number.isFinite(item.w)) {
        started = false;
        continue;
      }
      const x = padL + i * (barW + gap) + barW / 2;
      const y = padT + innerH - ((item.w - wMin) / wSpan) * innerH;
      if (!started) {
        chartCtx.moveTo(x, y);
        started = true;
      } else {
        chartCtx.lineTo(x, y);
      }
    }
    chartCtx.stroke();

    chartCtx.fillStyle = muted;
    chartCtx.globalAlpha = 1;
    chartCtx.fillText(formatWeightWithUnit(wMax), padL + innerW - 70, padT + 12);
    chartCtx.fillText(formatWeightWithUnit(wMin), padL + innerW - 70, padT + innerH);
  }

  chartCtx.fillStyle = muted;
  const first = series[0].k;
  const last = series[series.length - 1].k;
  chartCtx.fillText(shortDate(first), padL, padT + innerH + 18);
  const lastW = chartCtx.measureText(shortDate(last)).width;
  chartCtx.fillText(shortDate(last), padL + innerW - lastW, padT + innerH + 18);
}

let toastTimer = null;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 1600);
}

// -------------------- auth + community --------------------
function initAuthAndCommunity() {
  if (accountBtn) {
    accountBtn.addEventListener("click", openAuthModal);
  }
  if (authCloseBtn) {
    authCloseBtn.addEventListener("click", closeAuthModal);
  }
  if (authBackdrop) {
    authBackdrop.addEventListener("click", (e) => {
      if (e.target === authBackdrop) closeAuthModal();
    });
  }

  if (authModeEl) {
    authModeEl.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => {
        authMode = btn.dataset.mode;
        authModeEl.querySelectorAll("button").forEach((b) => {
          const on = b.dataset.mode === authMode;
          b.classList.toggle("active", on);
          b.setAttribute("aria-selected", on ? "true" : "false");
        });
        updateAuthUI();
        setAuthMessage("");
      });
    });
  }

  if (authSubmitBtn) {
    authSubmitBtn.addEventListener("click", async () => {
      await handleAuthSubmit();
    });
  }
  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      if (!supabaseEnabled()) return;
      await supabase.auth.signOut();
      toast("Signed out");
    });
  }

  if (lbRangeEl) {
    lbRangeEl.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", async () => {
        lbRangeEl.querySelectorAll("button").forEach((b) => {
          const on = b.dataset.range === btn.dataset.range;
          b.classList.toggle("active", on);
          b.setAttribute("aria-selected", on ? "true" : "false");
        });
        await loadLeaderboards();
      });
    });
  }
  if (lbMetricEl) {
    currentLbMetric = lbMetricEl.querySelector("button.active")?.dataset?.metric || currentLbMetric;
    lbMetricEl.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => {
        lbMetricEl.querySelectorAll("button").forEach((b) => {
          const on = b.dataset.metric === btn.dataset.metric;
          b.classList.toggle("active", on);
          b.setAttribute("aria-selected", on ? "true" : "false");
        });
        currentLbMetric = btn.dataset.metric || "total_reps";
        renderLeaderboards(leaderboardCache);
      });
    });
  }
  if (lbSearchInput) {
    lbSearchInput.addEventListener("input", () => {
      renderLeaderboards(leaderboardCache);
    });
  }
  if (refreshLeaderboardsBtn) {
    refreshLeaderboardsBtn.addEventListener("click", async () => {
      await loadLeaderboards();
      toast("Leaderboards refreshed");
    });
  }
  if (profileLookupBtn) {
    profileLookupBtn.addEventListener("click", async () => {
      const u = (profileLookupInput?.value || "").trim();
      await loadPublicProfile(u);
    });
  }
  if (profileLookupInput) {
    profileLookupInput.addEventListener("keydown", async (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const u = (profileLookupInput.value || "").trim();
        await loadPublicProfile(u);
      }
    });
  }

  if (!supabaseEnabled()) {
    if (leaderboardListEl) {
      leaderboardListEl.innerHTML = '<p class="note">Add your Supabase URL and anon key in index.html to enable accounts and leaderboards.</p>';
    }
    if (profileViewEl) {
      profileViewEl.innerHTML = "<p class=\"note\">Supabase not configured.</p>";
    }
    if (myProfileLinkEl) {
      myProfileLinkEl.textContent = "Sign in to generate";
    }
    updateAuthUI();
    return;
  }

  supabase.auth.getSession().then(({ data }) => {
    currentUser = data?.session?.user || null;
    onAuthStateChanged();
  });

  supabase.auth.onAuthStateChange((_event, session) => {
    currentUser = session?.user || null;
    onAuthStateChanged();
  });
}

function openAuthModal() {
  if (!authBackdrop) return;
  authBackdrop.hidden = false;
  updateAuthUI();
  setAuthMessage("");
  if (!supabaseEnabled()) {
    setAuthMessage("Supabase is not configured yet. Add SUPABASE_URL and SUPABASE_ANON_KEY in index.html.");
  }
}

function closeAuthModal() {
  if (!authBackdrop) return;
  authBackdrop.hidden = true;
}

function updateAuthUI() {
  const isSignup = authMode === "signup";
  if (signupExtraEl) signupExtraEl.hidden = !isSignup;
  if (authSubmitBtn) {
    authSubmitBtn.textContent = currentUser && isSignup ? "Save Profile" : "Continue";
  }
  if (authEmailEl) {
    authEmailEl.disabled = !!currentUser && isSignup;
  }
  if (authPasswordEl) {
    authPasswordEl.disabled = !!currentUser && isSignup;
  }
  if (logoutBtn) {
    logoutBtn.hidden = !currentUser;
  }
  if (accountBtn) {
    accountBtn.textContent = currentUser ? "Account (Signed in)" : "Account";
  }
}

function setAuthMessage(msg) {
  if (authMsgEl) authMsgEl.textContent = msg || "";
}

async function handleAuthSubmit() {
  if (!supabaseEnabled()) return;

  const email = (authEmailEl?.value || "").trim();
  const password = (authPasswordEl?.value || "").trim();

  if (currentUser && authMode === "signup") {
    const username = normalizeUsername(authUsernameEl?.value || "");
    const displayName = (authDisplayNameEl?.value || "").trim();
    const err = validateProfile(username, displayName);
    if (err) {
      setAuthMessage(err);
      return;
    }
    await upsertMyProfile({ username, display_name: displayName });
    setAuthMessage("Profile saved.");
    updateMyProfileLink();
    await loadLeaderboards();
    return;
  }

  if (!email || !password) {
    setAuthMessage("Enter email and password.");
    return;
  }

  try {
    setAuthMessage("");
    if (authMode === "signup") {
      const username = normalizeUsername(authUsernameEl?.value || "");
      const displayName = (authDisplayNameEl?.value || "").trim();
      const err = validateProfile(username, displayName);
      if (err) {
        setAuthMessage(err);
        return;
      }
      savePendingProfile({ username, display_name: displayName });
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { username, display_name: displayName } }
      });
      if (error) throw error;
      setAuthMessage("Check your email to confirm, then sign in to finish setup.");
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      closeAuthModal();
    }
  } catch (err) {
    setAuthMessage(err?.message || "Auth failed");
  }
}

function normalizeUsername(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeSearch(value) {
  return String(value || "").trim().toLowerCase().replace(/^@/, "");
}

function leaderboardMetricLabel(metricKey) {
  switch (metricKey) {
    case "total_pushups":
      return "Pushups";
    case "total_lunges":
      return "Lunges";
    case "total_situps":
      return "Situps";
    case "days_logged":
      return "Days";
    case "total_reps":
    default:
      return "Reps";
  }
}

function leaderboardMetricValue(row, metricKey) {
  return Number(row?.[metricKey]) || 0;
}

function validateProfile(username, displayName) {
  if (!username || !/^[a-z0-9_]{3,20}$/.test(username)) {
    return "Username must be 3-20 chars: letters, numbers, underscore.";
  }
  if (!displayName) {
    return "Add a display name.";
  }
  return "";
}

function loadPendingProfile() {
  try {
    const raw = localStorage.getItem(PENDING_PROFILE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch (e) {
    return null;
  }
}

function savePendingProfile(profile) {
  try {
    localStorage.setItem(PENDING_PROFILE_KEY, JSON.stringify(profile));
  } catch (e) {
  }
}

function clearPendingProfile() {
  try {
    localStorage.removeItem(PENDING_PROFILE_KEY);
  } catch (e) {
  }
}

async function onAuthStateChanged() {
  updateAuthUI();
  if (!currentUser) {
    currentProfile = null;
    if (myProfileLinkEl) myProfileLinkEl.textContent = "Sign in to generate";
    await loadLeaderboards();
    await loadPublicProfileFromUrl();
    return;
  }

  await ensureProfile();
  updateMyProfileLink();
  await syncDownMyWorkouts();
  await syncUpAllLocalDays();
  render();
  await loadLeaderboards();
  await loadPublicProfileFromUrl();
}

async function loadPublicProfileFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const u = params.get("u");
  if (u) await loadPublicProfile(u);
}

async function ensureProfile() {
  await loadMyProfile();
  if (currentProfile) return;
  const pending = loadPendingProfile();
  const meta = currentUser?.user_metadata || {};
  const username = normalizeUsername(pending?.username || meta.username || "");
  const displayName = (pending?.display_name || meta.display_name || "").trim();
  if (username && displayName) {
    await upsertMyProfile({ username, display_name: displayName });
    clearPendingProfile();
    await loadMyProfile();
  } else {
    setAuthMessage("Complete your profile to appear on leaderboards.");
  }
}

async function loadMyProfile() {
  if (!supabaseEnabled() || !currentUser) return;
  const { data, error } = await supabase
    .from("profiles")
    .select("id, username, display_name, is_public")
    .eq("id", currentUser.id)
    .maybeSingle();
  if (error) {
    console.warn("Profile load error", error);
    return;
  }
  currentProfile = data || null;
}

async function upsertMyProfile({ username, display_name }) {
  if (!supabaseEnabled() || !currentUser) return;
  const payload = { id: currentUser.id, username, display_name, is_public: true };
  const { error } = await supabase.from("profiles").upsert(payload, { onConflict: "id" });
  if (error) {
    setAuthMessage(error.message || "Profile save failed");
  } else {
    await loadMyProfile();
  }
}

function updateMyProfileLink() {
  if (!myProfileLinkEl) return;
  if (currentProfile?.username) {
    const url = new URL(window.location.href);
    url.searchParams.set("u", currentProfile.username);
    myProfileLinkEl.textContent = url.toString();
  } else {
    myProfileLinkEl.textContent = "Complete your profile to share";
  }
}

async function syncDownMyWorkouts() {
  if (!supabaseEnabled() || !currentUser) return;
  const { data, error } = await supabase
    .from("workouts")
    .select("date, pushups, lunges, situps, weight_lb, notes")
    .eq("user_id", currentUser.id);
  if (error) {
    console.warn("Sync down error", error);
    return;
  }
  for (const row of data || []) {
    const key = row.date;
    const local = state.days[key] || null;
    const remote = {
      ...DEFAULT_DAY,
      pushups: row.pushups || 0,
      lunges: row.lunges || 0,
      situps: row.situps || 0,
      weight: Number.isFinite(row.weight_lb) ? Number(row.weight_lb) : (row.weight_lb ?? null),
      notes: row.notes || ""
    };
    if (!local || !hasAnyActivity(local)) {
      state.days[key] = remote;
    }
  }
  saveState(true);
}

async function syncUpAllLocalDays() {
  if (!supabaseEnabled() || !currentUser) return;
  const keys = Object.keys(state.days || {});
  for (const key of keys) {
    const day = state.days[key];
    if (!hasAnyActivity(day)) continue;
    await syncUpDay(key);
  }
}

function scheduleSyncUp(dateKey) {
  if (!supabaseEnabled() || !currentUser) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => syncUpDay(dateKey), 400);
}

async function syncUpDay(dateKey) {
  if (!supabaseEnabled() || !currentUser) return;
  const day = ensureDay(dateKey);
  const payload = {
    user_id: currentUser.id,
    date: dateKey,
    pushups: Number(day.pushups) || 0,
    lunges: Number(day.lunges) || 0,
    situps: Number(day.situps) || 0,
    weight_lb: Number.isFinite(day.weight) ? day.weight : null,
    notes: String(day.notes || "").slice(0, 2000)
  };
  const { error } = await supabase.from("workouts").upsert(payload, { onConflict: "user_id,date" });
  if (error) {
    console.warn("Sync up error", error);
    toast("Cloud sync failed");
  }
}

async function loadLeaderboards() {
  if (!supabaseEnabled()) return;
  const range = lbRangeEl?.querySelector("button.active")?.dataset?.range || "7d";
  const fnName = range === "all" ? "leaderboard_all_time" : "leaderboard_7d";
  if (leaderboardListEl) leaderboardListEl.innerHTML = '<p class="note">Loading...</p>';

  const { data, error } = await supabase.rpc(fnName, { limit_count: 50 });
  if (error) {
    if (leaderboardListEl) {
      leaderboardListEl.innerHTML = '<p class="note">Leaderboard not configured yet. Check the SQL functions.</p>';
    }
    console.warn("Leaderboard error", error);
    leaderboardCache = [];
    return;
  }
  leaderboardCache = data || [];
  renderLeaderboards(leaderboardCache);
}

function renderLeaderboards(rows) {
  if (!leaderboardListEl) return;
  if (!supabaseEnabled()) return;
  const allRows = Array.isArray(rows) ? rows : [];
  const query = normalizeSearch(lbSearchInput?.value || "");
  let filtered = allRows;
  if (query) {
    filtered = allRows.filter((r) => {
      const name = normalizeSearch(r.display_name || "");
      const username = normalizeSearch(r.username || "");
      return name.includes(query) || username.includes(query);
    });
  }
  const metricKey = currentLbMetric || "total_reps";
  const metricLabel = leaderboardMetricLabel(metricKey);
  const sorted = [...filtered].sort((a, b) => {
    const diff = leaderboardMetricValue(b, metricKey) - leaderboardMetricValue(a, metricKey);
    if (diff !== 0) return diff;
    return leaderboardMetricValue(b, "total_reps") - leaderboardMetricValue(a, "total_reps");
  });
  if (!sorted.length) {
    leaderboardListEl.innerHTML = query
      ? '<p class="note">No matches found.</p>'
      : '<p class="note">No leaderboard data yet.</p>';
    return;
  }
  leaderboardListEl.innerHTML = "";
  sorted.forEach((r, idx) => {
    const el = document.createElement("div");
    el.className = "lb-row";
    if (currentUser && r.user_id === currentUser.id) {
      el.classList.add("me");
    }
    const name = r.display_name || r.username || "Anonymous";
    const handle = r.username ? "@" + r.username : "";
    const daysLogged = Number(r.days_logged) || 0;
    const totalReps = Number(r.total_reps) || 0;
    const metricValue = leaderboardMetricValue(r, metricKey);
    el.innerHTML = `
      <div class="lb-left">
        <div class="lb-name"><span class="lb-rank">${idx + 1}.</span> ${escapeHTML(name)} <span class="mono lb-handle">${escapeHTML(handle)}</span></div>
        <div class="lb-meta">${daysLogged} days logged | ${totalReps} reps</div>
      </div>
      <div class="lb-right">
        <div class="lb-score">
          <div class="lb-score-label">${escapeHTML(metricLabel)}</div>
          <div class="lb-score-value">${metricValue}</div>
        </div>
        <div class="lb-tags">
          <span class="lb-pill">P ${Number(r.total_pushups) || 0}</span>
          <span class="lb-pill">L ${Number(r.total_lunges) || 0}</span>
          <span class="lb-pill">S ${Number(r.total_situps) || 0}</span>
        </div>
      </div>
    `;
    el.addEventListener("click", async () => {
      if (r.username) await loadPublicProfile(r.username);
    });
    leaderboardListEl.appendChild(el);
  });
}

async function loadPublicProfile(username) {
  const u = normalizeUsername(username || "");
  if (!u) {
    if (profileViewEl) profileViewEl.innerHTML = "<p class=\"note\">Enter a username.</p>";
    return;
  }
  if (!supabaseEnabled()) {
    if (profileViewEl) profileViewEl.innerHTML = "<p class=\"note\">Supabase not configured.</p>";
    return;
  }
  if (profileViewEl) profileViewEl.innerHTML = "<p class=\"note\">Loading...</p>";

  const { data: prof, error: pErr } = await supabase
    .from("profiles")
    .select("id, username, display_name, is_public")
    .eq("username", u)
    .maybeSingle();
  if (pErr || !prof) {
    if (profileViewEl) profileViewEl.innerHTML = "<p class=\"note\">Profile not found.</p>";
    return;
  }
  if (!prof.is_public) {
    if (profileViewEl) profileViewEl.innerHTML = "<p class=\"note\">This profile is private.</p>";
    return;
  }

  const { data: allRows } = await supabase.rpc("leaderboard_all_time", { limit_count: 500 });
  const sums = (allRows || []).find((r) => r.user_id === prof.id) || null;
  const totals = sums || { total_pushups: 0, total_lunges: 0, total_situps: 0, total_reps: 0, days_logged: 0 };

  let workoutRows = [];
  let workoutNote = "";
  const { data: workoutData, error: workoutErr } = await supabase.rpc("profile_workouts", {
    p_username: prof.username,
    limit_count: 120
  });
  if (workoutErr) {
    console.warn("Profile workouts error", workoutErr);
    workoutNote = "Workout list unavailable.";
  } else {
    workoutRows = workoutData || [];
  }

  const name = prof.display_name || prof.username;
  const workoutListHtml = workoutRows.map((row) => {
    const dateKey = row.workout_date || row.date;
    const dateLabel = dateKey ? fullDate(toDateObj(dateKey)) : "Unknown date";
    const pushups = Number(row.pushups) || 0;
    const lunges = Number(row.lunges) || 0;
    const situps = Number(row.situps) || 0;
    const total = pushups + lunges + situps;
    const weightLabel = Number.isFinite(Number(row.weight_lb)) ? formatWeightWithUnit(Number(row.weight_lb)) : "";
    const notes = String(row.notes || "").trim();
    return `
      <div class="profile-workout-row">
        <div class="profile-workout-date">${escapeHTML(dateLabel)}</div>
        <div class="profile-workout-tags">
          <span>P ${pushups}</span>
          <span>L ${lunges}</span>
          <span>S ${situps}</span>
          <span class="total">Total ${total}</span>
          ${weightLabel ? `<span class="weight">${escapeHTML(weightLabel)}</span>` : ""}
        </div>
        ${notes ? `<div class="profile-note">${escapeHTML(notes)}</div>` : ""}
      </div>
    `;
  }).join("");

  const workoutsHtml = workoutNote
    ? `<p class="note">${escapeHTML(workoutNote)}</p>`
    : workoutRows.length
      ? `<div class="profile-workouts-list">${workoutListHtml}</div>`
      : '<p class="note">No workouts logged yet.</p>';

  profileViewEl.innerHTML = `
    <div class="profile-title">
      <h4>${escapeHTML(name)}</h4>
      <div class="handle">@${escapeHTML(prof.username)}</div>
    </div>
    <div class="profile-stats">
      <div class="profile-stat"><div class="k">Total reps</div><div class="v">${Number(totals.total_reps) || 0}</div></div>
      <div class="profile-stat"><div class="k">Days logged</div><div class="v">${Number(totals.days_logged) || 0}</div></div>
      <div class="profile-stat"><div class="k">Best category</div><div class="v">${bestCategoryLabel(totals)}</div></div>
    </div>
    <div class="profile-workouts">
      <div class="profile-workouts-title">Recent activity</div>
      ${workoutsHtml}
    </div>
  `;
  profileViewEl.scrollIntoView({ behavior: "smooth", block: "start" });

  const url = new URL(window.location.href);
  url.searchParams.set("u", prof.username);
  window.history.replaceState({}, "", url.toString());
}

function bestCategoryLabel(t) {
  const p = Number(t.total_pushups) || 0;
  const l = Number(t.total_lunges) || 0;
  const s = Number(t.total_situps) || 0;
  const arr = [["Pushups", p], ["Lunges", l], ["Situps", s]];
  arr.sort((a, b) => b[1] - a[1]);
  return arr[0][0];
}
