const themeToggle = document.getElementById("themeToggle");

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("theme", theme);
  themeToggle.textContent = theme === "dark" ? "☀️ Light" : "🌙 Dark";
}

const savedTheme = localStorage.getItem("theme") ||
  (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");

applyTheme(savedTheme);

themeToggle.onclick = () => {
  const newTheme = document.documentElement.getAttribute("data-theme") === "dark"
    ? "light"
    : "dark";
  applyTheme(newTheme);
};

const SETTINGS_KEY = "bucketBuilderSettings";

function saveSettings() {
  const settings = {
    diffMin: diffMin.value,
    diffMax: diffMax.value,
    maxPerBucket: maxPerBucket.value,
    songTypes: Array.from(document.querySelectorAll(".songType"))
      .filter(cb => cb.checked)
      .map(cb => cb.value),
    includeRebroadcast: includeRebroadcast.checked,
    includeDub: includeDub.checked,
    ignoreDuplicates: ignoreDuplicates.checked,
    includeMissing: includeMissing.checked
  };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function loadSettings() {
  const raw = localStorage.getItem(SETTINGS_KEY);
  if (!raw) return;

  try {
    const s = JSON.parse(raw);
    diffMin.value = s.diffMin ?? 0;
    diffMax.value = s.diffMax ?? 100;
    maxPerBucket.value = s.maxPerBucket ?? 100;

    document.querySelectorAll(".songType").forEach(cb => {
      cb.checked = s.songTypes?.includes(cb.value) ?? true;
    });

    includeRebroadcast.checked = s.includeRebroadcast ?? true;
    includeDub.checked = s.includeDub ?? false;
    ignoreDuplicates.checked = s.ignoreDuplicates ?? false;
    includeMissing.checked = s.includeMissing ?? false;

  } catch (e) {
    console.warn("Failed to load settings:", e);
  }
}

loadSettings();

const settingIds = [
  "diffMin", "diffMax", "maxPerBucket",
  "includeRebroadcast", "includeDub", "ignoreDuplicates", "includeMissing"
];
settingIds.forEach(id => {
  document.getElementById(id).addEventListener("change", saveSettings);
});
document.querySelectorAll(".songType").forEach(cb => {
  cb.addEventListener("change", saveSettings);
});

function difficultyOf(item) {
  return item.songDifficulty ?? 0;
}

function hasAllFiles(item) {
  const audioMissing = !item.audio;
  const mqMissing = !item.MQ;
  const hqMissing = !item.HQ;
  return !(audioMissing && mqMissing && hqMissing);
}

function matchesSongType(item, types) {
  if (!item.songType) return false;
  return types.some(t => item.songType.startsWith(t));
}

function inRange(diff, min, max) {
  return diff >= min && diff <= max;
}

function removeDuplicatesByAmqId(items) {
  const seen = new Set();
  return items.filter(item => {
    if (seen.has(item.amqSongId)) return false;
    seen.add(item.amqSongId);
    return true;
  });
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

function downloadJSON(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

let allItems = [];

const fileInput = document.getElementById("fileInput");
const fileStatus = document.getElementById("fileStatus");
const generateBtn = document.getElementById("generateBtn");
const generateStatus = document.getElementById("generateStatus");
const bucketsContainer = document.getElementById("bucketsContainer");
const downloadAllBtn = document.getElementById("downloadAllBtn");

fileInput.addEventListener("change", async (e) => {
  const files = Array.from(e.target.files || []);
  allItems = [];
  fileStatus.textContent = "Loading...";
  generateBtn.disabled = true;
  bucketsContainer.innerHTML = "";
  generateStatus.textContent = "";

  try {
    for (const file of files) {
      const text = await file.text();
      const json = JSON.parse(text);
      if (Array.isArray(json)) {
        allItems.push(...json);
      }
    }
    fileStatus.textContent = `Loaded ${allItems.length} items from ${files.length} file(s).`;
    if (allItems.length > 0) generateBtn.disabled = false;

  } catch (err) {
    console.error(err);
    fileStatus.textContent = "Error loading files.";
  }
});

generateBtn.addEventListener("click", () => {
  if (!allItems.length) return;

  const config = {
    items: allItems,
    diffMin: Number(diffMin.value),
    diffMax: Number(diffMax.value),
    maxPerBucket: Number(maxPerBucket.value),
    songTypes: Array.from(document.querySelectorAll(".songType"))
      .filter(cb => cb.checked)
      .map(cb => cb.value),
    includeRebroadcast: includeRebroadcast.checked,
    includeDub: includeDub.checked,
    ignoreDuplicates: ignoreDuplicates.checked,
    includeMissing: includeMissing.checked
  };

  generateStatus.textContent = "Generating...";
  bucketsContainer.innerHTML = "";

  const buckets = buildBuckets(config);

  renderBuckets(buckets);
  generateStatus.textContent = `Generated ${buckets.length} JSON file(s).`;
});

function buildBuckets(config) {
  const {
    items,
    diffMin,
    diffMax,
    maxPerBucket,
    songTypes,
    includeRebroadcast,
    includeDub,
    ignoreDuplicates,
    includeMissing
  } = config;

  // STEP 1 — Apply all filters FIRST
  let filtered = items.filter(item => {
    if (!matchesSongType(item, songTypes)) return false;

    const diff = difficultyOf(item);
    if (!inRange(diff, diffMin, diffMax)) return false;

    if (!includeDub && item.isDub) return false;
    if (!includeMissing && !hasAllFiles(item)) return false;
    if (!includeRebroadcast && item.isRebroadcast) return false;

    return true;
  });

  // STEP 2 — Deduplicate AFTER filtering
  if (ignoreDuplicates) {
    const seen = new Set();
    filtered = filtered.filter(item => {
      if (seen.has(item.amqSongId)) return false;
      seen.add(item.amqSongId);
      return true;
    });
  }

  // STEP 3 — Continue with your existing bucket logic
  const buckets = [];

  for (const type of songTypes) {
    const typeItems = filtered.filter(item => matchesSongType(item, [type]));

    if (!typeItems.length) continue;

    const byDifficulty = {};
    for (const item of typeItems) {
      const d = difficultyOf(item);
      if (!byDifficulty[d]) byDifficulty[d] = [];
      byDifficulty[d].push(item);
    }

    const diffs = Object.keys(byDifficulty).map(Number).sort((a, b) => a - b);

    let currentBucket = [];

    for (const diff of diffs) {
      let group = byDifficulty[diff];

      if (group.length > maxPerBucket) {
        const numParts = Math.ceil(group.length / maxPerBucket);
        const partSize = Math.ceil(group.length / numParts);
        const chunks = chunk(group, partSize);

        chunks.forEach((chunkPart, idx) => {
          buckets.push({
            type,
            items: chunkPart,
            diffMin: diff,
            diffMax: diff,
            splitIndex: idx + 1,
            splitTotal: chunks.length
          });
        });

        continue;
      }

      if (currentBucket.length + group.length <= maxPerBucket) {
        currentBucket.push(...group);
      } else {
        const diffsInBucket = currentBucket.map(i => difficultyOf(i));
        buckets.push({
          type,
          items: currentBucket,
          diffMin: Math.min(...diffsInBucket),
          diffMax: Math.max(...diffsInBucket),
          splitIndex: 0,
          splitTotal: 1
        });
        currentBucket = [...group];
      }
    }

    if (currentBucket.length > 0) {
      const diffsInBucket = currentBucket.map(i => difficultyOf(i));
      buckets.push({
        type,
        items: currentBucket,
        diffMin: Math.min(...diffsInBucket),
        diffMax: Math.max(...diffsInBucket),
        splitIndex: 0,
        splitTotal: 1
      });
    }
  }

  return buckets;
}

async function downloadAllBuckets(buckets, zipName = "all.zip") {
  const zip = new JSZip();

  buckets.forEach(b => {
    const diffLabel = b.diffMin === b.diffMax
      ? `${b.diffMin}`
      : `${b.diffMin}-${b.diffMax}`;

    let name = `${b.type}_${diffLabel}`;
    if (b.splitTotal > 1) {
      name += `_part${b.splitIndex}`;
    }
    name += ".json";

    zip.file(name, JSON.stringify(b.items, null, 2));
  });

  const blob = await zip.generateAsync({ type: "blob" });

  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = zipName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function renderCollapsibleBuckets(buckets) {
  bucketsContainer.innerHTML = "";

  if (!buckets.length) {
    bucketsContainer.innerHTML = "<p class='small'>No JSON generated.</p>";
    return;
  }

  const byType = {};
  buckets.forEach(b => {
    if (!byType[b.type]) byType[b.type] = [];
    byType[b.type].push(b);
  });

  Object.values(byType).forEach(list => {
    list.sort((a, b) => {
      if (a.diffMin !== b.diffMin) return a.diffMin - b.diffMin;
      if (a.diffMax !== b.diffMax) return a.diffMax - b.diffMax;
      return a.splitIndex - b.splitIndex;
    });
  });

  Object.keys(byType).forEach(type => {
    const section = document.createElement("details");
    section.open = true;

    const summary = document.createElement("summary");
    summary.textContent = `${type} (${byType[type].length} JSON)`;
    section.appendChild(summary);

    const typeBtn = document.createElement("button");
    typeBtn.textContent = `Download All ${type}`;
    typeBtn.style.margin = "8px 0";
    typeBtn.onclick = () => downloadAllBuckets(byType[type], `all_${type}.zip`);
    section.appendChild(typeBtn);

    byType[type].forEach(b => {
      const div = document.createElement("div");
      div.className = "bucket";

      const diffLabel = b.diffMin === b.diffMax
        ? `${b.diffMin}`
        : `${b.diffMin}-${b.diffMax}`;

      let name = `${b.type}_${diffLabel}`;
      if (b.splitTotal > 1) {
        name += `_part${b.splitIndex}`;
      }
      name += ".json";

      const info = document.createElement("div");
      info.className = "bucket-info";
      info.innerHTML = `
            <div>
              <span class="tag">${b.type}</span>
              <span class="tag">Diff: ${diffLabel}</span>
              ${b.splitTotal > 1 ? `<span class="tag">Part ${b.splitIndex}/${b.splitTotal}</span>` : ""}
            </div>
            <div class="small">
              ${b.items.length} item(s) — ${name}
            </div>
          `;

      const btn = document.createElement("button");
      btn.textContent = "Download";
      btn.onclick = () => downloadJSON(name, b.items);

      div.appendChild(info);
      div.appendChild(btn);
      section.appendChild(div);
    });

    bucketsContainer.appendChild(section);
  });
}

function renderBuckets(buckets) {
  downloadAllBtn.disabled = buckets.length === 0;
  downloadAllBtn.onclick = () => downloadAllBuckets(buckets);

  renderCollapsibleBuckets(buckets);
}