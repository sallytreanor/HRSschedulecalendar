/* eslint-disable no-undef */

const STORAGE_KEY = "semesterBlockRotationCalendar.v1";

const SEMESTER = {
  startISO: "2026-08-17",
  endISO: "2026-12-11",
};

// Dates with no classes (do not advance the 8-day rotation).
// Note: Your notes included both "11/2 is a holiday" and "10/30 is day 1, 11/2 is day 2".
// To keep the later anchors consistent, this app treats 11/2 as a holiday (so day 2 will occur on 11/3).
const HOLIDAYS_ISO = new Set([
  "2026-08-21",
  "2026-09-07",
  "2026-10-14", // Squeeze Day (no classes, does not advance rotation)
  "2026-10-12", // derived from: 10/9 is day 6; 10/13 is day 7
  "2026-10-16",
  "2026-10-19",
  "2026-11-02",
  "2026-11-11",
  // 11/23-27 are holidays
  "2026-11-23",
  "2026-11-24",
  "2026-11-25",
  "2026-11-26",
  "2026-11-27",
]);

const ROTATION_LENGTH = 8;

// Exact block order per rotation day.
// Day N means the day-level rotation label (1..8).
const BLOCK_ORDER_BY_ROTATION_DAY = {
  1: [1, 3, 5, 7],
  2: [2, 4, 6, 8],
  3: [3, 5, 7, 1],
  4: [4, 6, 8, 2],
  5: [5, 7, 1, 3],
  6: [6, 8, 2, 4],
  7: [7, 1, 3, 5],
  8: [8, 2, 4, 6],
};

// In the first rotation, skip these rotation-day labels (no classes on the days
// where they would normally land).
const INITIAL_SKIP_ROTATION_DAYS = new Set([3, 4]);

const dom = {
  calendar: document.getElementById("calendar"),
  subtitle: document.getElementById("semesterSubtitle"),
  exportBtn: document.getElementById("exportBtn"),
  importFile: document.getElementById("importFile"),
  resetBtn: document.getElementById("resetBtn"),
  editorDialog: document.getElementById("editorDialog"),
  editorForm: document.getElementById("editorForm"),
  editorTitle: document.getElementById("editorTitle"),
  editorMeta: document.getElementById("editorMeta"),
  editorGrid: document.getElementById("editorGrid"),
  closeBtn: document.getElementById("closeBtn"),
  saveBtn: document.getElementById("saveBtn"),
  clearTemplateBtn: document.getElementById("clearTemplateBtn"),
};

function parseISODate(iso) {
  // ISO "YYYY-MM-DD" -> local Date at midnight
  const [y, m, d] = iso.split("-").map((x) => Number(x));
  return new Date(y, m - 1, d);
}

function toISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function isWeekend(date) {
  const dow = date.getDay(); // Sun=0..Sat=6
  return dow === 0 || dow === 6;
}

function isCandidateSchoolDay(date) {
  const iso = toISODate(date);
  if (isWeekend(date)) return false;
  if (HOLIDAYS_ISO.has(iso)) return false;
  return true;
}

function periodsForRotationDay(rotationDay) {
  return BLOCK_ORDER_BY_ROTATION_DAY[rotationDay] || [];
}

function getCommunityTimeLabel(rotationDay) {
  // Explicit labels for rotation-day 7 (and beyond), as requested.
  if (rotationDay === 7) return "Leadership/Clubs";
  if (rotationDay === 8) return "Office Hours";

  // Schedule given for rotation Days 1..6.
  // For Days 7..8, we repeat the 1..6 pattern.
  const dayIndex = ((rotationDay - 1) % 6) + 1;
  switch (dayIndex) {
    case 1:
      return "Assembly";
    case 2:
      return "Affinity/Study Hall";
    case 3:
      return "Grade Level Mtg";
    case 4:
      return "Office Hours";
    case 5:
      return "Advising";
    case 6:
      return "Affinity/Study Hall";
    default:
      return "";
  }
}

function makeDefaultState() {
  const template = {};
  for (let day = 1; day <= ROTATION_LENGTH; day++) {
    template[String(day)] = {};
    for (const period of periodsForRotationDay(day)) {
      template[String(day)][String(period)] = "";
    }
  }
  return { version: 1, template };
}

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return makeDefaultState();
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return makeDefaultState();
    if (!parsed.template || typeof parsed.template !== "object") return makeDefaultState();
    return parsed;
  } catch {
    return makeDefaultState();
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function buildCalendarModel() {
  const start = parseISODate(SEMESTER.startISO);
  const end = parseISODate(SEMESTER.endISO);

  // Map ISO -> model info
  const model = new Map();

  // labelCursor drives rotation-day assignment on candidate school days.
  // cycleIndex == 0 means we're still in the first 1..8 rotation.
  let labelCursor = 1;
  let cycleIndex = 0;

  for (let cur = new Date(start); cur <= end; cur.setDate(cur.getDate() + 1)) {
    const iso = toISODate(cur);

    if (isWeekend(cur)) {
      model.set(iso, { dateISO: iso, isInstructional: false, offReason: "Weekend" });
      continue;
    }

    if (HOLIDAYS_ISO.has(iso)) {
      model.set(iso, { dateISO: iso, isInstructional: false, offReason: "Holiday" });
      continue;
    }

    // Candidate school day (weekday & not a holiday)
    if (iso === SEMESTER.startISO) {
      labelCursor = 1;
      model.set(iso, {
        dateISO: iso,
        isInstructional: true,
        rotationDay: 1,
        activePeriods: periodsForRotationDay(1),
      });
      labelCursor = 2;
      continue;
    }

    if (cycleIndex === 0 && INITIAL_SKIP_ROTATION_DAYS.has(labelCursor)) {
      model.set(iso, {
        dateISO: iso,
        isInstructional: false,
        offReason: `Skipped rotation day ${labelCursor}`,
      });
      labelCursor = (labelCursor % ROTATION_LENGTH) + 1;
      if (labelCursor === 1) cycleIndex = 1; // wrapped past day 8
      continue;
    }

    // Instructional day
    if (isCandidateSchoolDay(cur)) {
      const rotationDay = labelCursor;
      model.set(iso, {
        dateISO: iso,
        isInstructional: true,
        rotationDay,
        activePeriods: periodsForRotationDay(rotationDay),
      });
      if (rotationDay === ROTATION_LENGTH) cycleIndex = 1;
      labelCursor = (labelCursor % ROTATION_LENGTH) + 1;
      continue;
    }

    // Fallback (should be unreachable given checks above)
    model.set(iso, { dateISO: iso, isInstructional: false, offReason: "Off" });
  }

  return model;
}

function getMonthStart(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function getMonthEnd(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function weekdayLabelSunFirst(idx) {
  // idx: 0..6 where 0=Sun
  const labels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return labels[idx];
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "className") node.className = v;
    else if (k.startsWith("data-")) node.setAttribute(k, v);
    else if (k === "textContent") node.textContent = v;
    else node.setAttribute(k, v);
  }
  for (const child of children) node.appendChild(child);
  return node;
}

function renderCalendar(model) {
  dom.calendar.innerHTML = "";
  const start = parseISODate(SEMESTER.startISO);
  const end = parseISODate(SEMESTER.endISO);

  const monthCursor = getMonthStart(start);
  while (monthCursor <= end) {
    const monthEnd = getMonthEnd(monthCursor);

    const monthSection = el("section", { className: "month" });

    const header = el("div", { className: "monthHeader" });
    const title = el("div", { className: "monthTitle", textContent: monthCursor.toLocaleString(undefined, { month: "long", year: "numeric" }) });
    const meta = el("div", { className: "monthMeta", textContent: `${monthCursor.getFullYear()}` });
    header.appendChild(title);
    header.appendChild(meta);

    const dowRow = el("div", { className: "dowRow" });
    for (let i = 0; i < 7; i++) {
      dowRow.appendChild(el("div", { textContent: weekdayLabelSunFirst(i) }));
    }

    const daysGrid = el("div", { className: "daysGrid" });

    // Leading empty cells (Sunday-first)
    const firstOfMonth = new Date(monthCursor.getFullYear(), monthCursor.getMonth(), 1);
    const leading = firstOfMonth.getDay(); // 0=Sun..6=Sat
    for (let i = 0; i < leading; i++) {
      daysGrid.appendChild(el("div", { textContent: "" }));
    }

    // Days
    const lastOfMonth = monthEnd;
    for (let day = new Date(firstOfMonth); day <= lastOfMonth; day.setDate(day.getDate() + 1)) {
      const iso = toISODate(day);
      const info = model.get(iso);

      // If outside semester range, render an empty cell
      if (!info) {
        daysGrid.appendChild(el("div", { textContent: "" }));
        continue;
      }

      const cell = el("div", { className: "dayCell" });
      cell.setAttribute("role", "button");
      cell.setAttribute("tabindex", info.isInstructional ? "0" : "-1");
      cell.dataset.dateISO = iso;

      if (!info.isInstructional) {
        cell.classList.add("off");
        if (info.offReason === "Weekend") {
          cell.classList.add("weekend");
        }
      }

      const dateRow = el("div", { className: "dateRow" });
      const dateNum = el("div", { className: "dateNum", textContent: String(day.getDate()) });
      const hasRotationLabel = Number.isInteger(info.rotationDay);
      const badge = el("div", { className: `rotationBadge ${hasRotationLabel ? "" : "empty"}` });
      badge.textContent = hasRotationLabel ? `Day ${info.rotationDay}` : "";

      dateRow.appendChild(dateNum);
      dateRow.appendChild(badge);
      cell.appendChild(dateRow);

      const miniRow = el("div", { className: "blockMini" });
      if (info.isInstructional) {
        let anyFilled = false;
        const periods = info.activePeriods || [];

        const renderCourseBlock = (period) => {
          const course = (state.template[String(info.rotationDay)]?.[String(period)] ?? "").trim();
          if (course) anyFilled = true;
          const mini = el("div", { className: `miniBlock ${course ? "filled" : ""}` });
          mini.appendChild(el("span", { className: "period", textContent: `P${period}` }));
          mini.appendChild(el("span", { textContent: course ? course : "—" }));
          miniRow.appendChild(mini);
        };

        // Render first course block
        if (periods[0] != null) {
          renderCourseBlock(periods[0]);
        }

        // Insert Community Time after the first course block
        const communityLabel = getCommunityTimeLabel(info.rotationDay);
        if (communityLabel) {
          const mini = el("div", { className: "miniBlock communityTime" });
          mini.appendChild(el("span", { className: "period", textContent: "CT" }));
          mini.appendChild(el("span", { textContent: communityLabel }));
          miniRow.appendChild(mini);

          // If Community Time is Advising, highlight the entire day (not just CT).
          if (communityLabel === "Advising") {
            cell.classList.add("advisingDay");
          }
        }

        // Render remaining course blocks
        for (const period of periods.slice(1)) {
          renderCourseBlock(period);
        }
        if (anyFilled) {
          cell.classList.add("filledDay");
        }
      } else {
        const label = el("div", { textContent: info.offReason });
        label.style.fontSize = "11px";
        label.style.color = "var(--muted)";
        miniRow.appendChild(label);
      }
      cell.appendChild(miniRow);

      if (info.isInstructional) {
        const openEditor = () => openEditorForDate(iso, model);
        cell.addEventListener("click", openEditor);
        cell.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openEditor();
          }
        });
      }

      daysGrid.appendChild(cell);
    }

    monthSection.appendChild(header);
    monthSection.appendChild(dowRow);
    monthSection.appendChild(daysGrid);
    dom.calendar.appendChild(monthSection);

    monthCursor.setMonth(monthCursor.getMonth() + 1);
  }
}

let currentEdit = null;

function openEditorForDate(dateISO, model) {
  const info = model.get(dateISO);
  if (!info || !info.isInstructional) return;

  currentEdit = {
    dateISO,
    rotationDay: info.rotationDay,
  };

  dom.editorTitle.textContent = `Edit rotation Day ${info.rotationDay}`;
  dom.editorMeta.textContent = `Applies to every instructional date that falls on rotation Day ${info.rotationDay}. (${dateISO})`;

  dom.editorGrid.innerHTML = "";
  const active = info.activePeriods;

  for (const period of active) {
    const card = el("div", { className: "fieldCard" });
    const label = el("div", { className: "fieldLabel", textContent: `Period P${period}` });
    const input = el("input", { type: "text", name: `p${period}`, "aria-label": `Period P${period}` });
    input.value = state.template[String(info.rotationDay)]?.[String(period)] ?? "";
    card.appendChild(label);
    card.appendChild(input);
    dom.editorGrid.appendChild(card);
  }

  dom.editorDialog.showModal();

  // Focus first input
  const firstInput = dom.editorGrid.querySelector('input[type="text"]');
  if (firstInput) firstInput.focus();
}

dom.editorForm.addEventListener("submit", (e) => {
  e.preventDefault();
  if (!currentEdit) return;

  const rotationDay = currentEdit.rotationDay;
  const activePeriods = periodsForRotationDay(rotationDay);

  for (const period of activePeriods) {
    const input = dom.editorGrid.querySelector(`input[name="p${period}"]`);
    const value = input ? input.value.trim() : "";
    state.template[String(rotationDay)][String(period)] = value;
  }

  saveState();
  dom.editorDialog.close();

  // Re-render so mini blocks update immediately
  calendarModel && renderCalendar(calendarModel);
});

dom.clearTemplateBtn.addEventListener("click", (e) => {
  e.preventDefault();
  const inputs = dom.editorGrid.querySelectorAll('input[type="text"]');
  inputs.forEach((i) => {
    i.value = "";
  });
});

dom.closeBtn.addEventListener("click", () => {
  dom.editorDialog.close();
});

function exportState() {
  const payload = JSON.stringify(state, null, 2);
  const blob = new Blob([payload], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = "semester-block-rotation-calendar-export.json";
  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(url);
}

dom.exportBtn.addEventListener("click", exportState);

dom.importFile.addEventListener("change", async () => {
  const file = dom.importFile.files && dom.importFile.files[0];
  if (!file) return;

  const text = await file.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    alert("Import failed: file is not valid JSON.");
    return;
  }

  if (!parsed || typeof parsed !== "object" || !parsed.template) {
    alert("Import failed: unexpected JSON shape.");
    return;
  }

  state = parsed;
  saveState();
  renderCalendar(calendarModel);
  alert("Imported successfully.");
});

dom.resetBtn.addEventListener("click", () => {
  const ok = confirm("Reset all rotation templates back to blank? This cannot be undone.");
  if (!ok) return;
  state = makeDefaultState();
  saveState();
  renderCalendar(calendarModel);
});

let state = makeDefaultState();
let calendarModel = null;

function init() {
  state = loadState();
  calendarModel = buildCalendarModel();

  dom.subtitle.textContent = `${SEMESTER.startISO} → ${SEMESTER.endISO}. Initial skip: rotation days 3 & 4.`;

  // Seed a few values for usability? Leave blank by default.
  renderCalendar(calendarModel);
}

window.addEventListener("DOMContentLoaded", init);

