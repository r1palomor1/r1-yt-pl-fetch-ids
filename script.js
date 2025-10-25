/***********************
 * Storage Utility (creationStorage -> localStorage)
 ***********************/
const creationStore = {
  async getItem(key) {
    try {
      if (window.rabbit?.creationStorage?.getItem) {
        const v = await window.rabbit.creationStorage.getItem(key);
        return v ?? null;
      }
    } catch {}
    return localStorage.getItem(key);
  },
  async setItem(key, value) {
    try {
      if (window.rabbit?.creationStorage?.setItem) {
        await window.rabbit.creationStorage.setItem(key, value);
        return;
      }
    } catch {}
    localStorage.setItem(key, value);
  },
  async removeItem(key) {
    try {
      if (window.rabbit?.creationStorage?.removeItem) {
        await window.rabbit.creationStorage.removeItem(key);
      }
    } catch {}
    localStorage.removeItem(key);
  }
};

/***********************
 * Helpers
 ***********************/
function extractPlaylistId(input) {
  const val = (input || "").trim();
  if (!val) return "";
  try {
    const u = new URL(val);
    const list = u.searchParams.get("list");
    if (list) return list;
  } catch {}
  return val;
}

/***********************
 * Fetch YouTube XML Feed
 ***********************/
async function fetchXMLPlaylist(playlistId) {
  const feed = `https://www.youtube.com/feeds/videos.xml?playlist_id=${playlistId}`;
  const proxy = `https://corsproxy.io/?${encodeURIComponent(feed)}`;
  try {
    const response = await fetch(proxy);
    const xmlText = await response.text();
    const xml = new DOMParser().parseFromString(xmlText, "application/xml");

    const playlistTitle = xml.querySelector("feed > title")?.textContent || "Untitled Playlist";
    const author = xml.querySelector("author > name")?.textContent || "Unknown";

    const entries = Array.from(xml.getElementsByTagName("entry"));
    const items = entries.map(entry => {
      const vid = entry.getElementsByTagNameNS("*","videoId")[0]?.textContent?.trim();
      const title = entry.getElementsByTagName("title")[0]?.textContent?.trim() || "Untitled";
      const thumb = entry.getElementsByTagNameNS("*","thumbnail")[0]?.getAttribute("url");
      return vid ? { id: vid, title, thumb } : null;
    }).filter(Boolean);

    return { meta: { playlistTitle, author }, videos: items };
  } catch (e) {
    console.error("XML fetch/parse error:", e);
    return { meta: null, videos: [] };
  }
}

/***********************
 * Cache helpers
 ***********************/
async function loadFromCache(playlistId) {
  const metaKey = `pl_${playlistId}_meta_v1`;
  const vidsKey = `pl_${playlistId}_videos_v1`;
  const [metaStr, vidsStr] = await Promise.all([
    creationStore.getItem(metaKey),
    creationStore.getItem(vidsKey)
  ]);
  let meta = null, videos = [];
  try { meta = metaStr ? JSON.parse(metaStr) : null; } catch {}
  try { videos = vidsStr ? JSON.parse(vidsStr) : []; } catch {}
  return { meta, videos };
}

async function saveToCache(playlistId, meta, videos) {
  const metaKey = `pl_${playlistId}_meta_v1`;
  const vidsKey = `pl_${playlistId}_videos_v1`;
  await creationStore.setItem(metaKey, JSON.stringify(meta || null));
  await creationStore.setItem(vidsKey, JSON.stringify(videos || []));
}

/***********************
 * State & rendering
 ***********************/
const state = {
  playlistId: "",
  allVideos: [],
  filteredVideos: null,
  renderIndex: 0,
  batchSize: 24,
  busy: false,
  sourceUsed: "XML",
  meta: null
};
function currentList() { return state.filteredVideos ?? state.allVideos; }

function clearGrid() {
  const container = document.getElementById("playlist");
  container.innerHTML = "";
  state.renderIndex = 0;
}

function renderNextBatch() {
  if (state.busy) return;
  const list = currentList();
  if (!list || state.renderIndex >= list.length) return;

  state.busy = true;
  const end = Math.min(state.renderIndex + state.batchSize, list.length);
  const slice = list.slice(state.renderIndex, end);
  const container = document.getElementById("playlist");

  const html = slice.map(v => `
    <a class="video" href="#" data-vid="${v.id}" title="${v.title.replace(/"/g,'&quot;')}">
      <img class="thumb" src="${v.thumb}" loading="lazy" alt="${v.title.replace(/"/g,'&quot;')}">
      <div class="title">${v.title}</div>
    </a>
  `).join("");
  const temp = document.createElement("div");
  temp.innerHTML = html;

  temp.querySelectorAll(".video").forEach(card => {
    card.addEventListener("click", e => {
      e.preventDefault();
      openMiniPlayer(card.getAttribute("data-vid"));
    });
  });

  while (temp.firstChild) container.appendChild(temp.firstChild);

  state.renderIndex = end;
  state.busy = false;
}

function renderAll(reset=false) {
  if (reset) clearGrid();
  renderNextBatch();
  const src = state.sourceUsed || "XML";
  const count = (currentList() || []).length;
  document.getElementById("sourceTag").innerText = `Source: ${src} — ${count} videos ${state.filteredVideos ? "(filtered)" : ""}`;
  document.getElementById("playlistMeta").innerText = state.meta ? `Playlist: ${state.meta.playlistTitle} | By: ${state.meta.author}` : "";
}

/***********************
 * Infinite scroll + fallback
 ***********************/
const sentinel = document.getElementById("sentinel");
if ("IntersectionObserver" in window) {
  const io = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting) renderNextBatch();
  }, { root: null, rootMargin: "200px", threshold: 0 });
  io.observe(sentinel);
} else {
  // Fallback button
  const btn = document.createElement("button");
  btn.textContent = "Load More";
  btn.onclick = renderNextBatch;
  sentinel.replaceWith(btn);
}

/***********************
 * Mini Player + Aspect presets + Toast
 ***********************/
const overlay = document.getElementById("playerOverlay");
const frame = document.getElementById("playerFrame");
const playerCard = document.getElementById("playerCard");
const closeBtn = document.getElementById("playerClose");
const aspectBtns = document.querySelectorAll("#aspectButtons button");
const toast = document.getElementById("toast");

function showToast(text) {
  toast.textContent = text;
  toast.classList.add("show");
  // fade only (no slide)
  setTimeout(() => toast.classList.remove("show"), 1400);
}

async function saveAspect(aspect) {
  await creationStore.setItem("player_aspect_pref", aspect);
  localStorage.setItem("player_aspect_pref", aspect);
}

async function loadAspect() {
  let val = await creationStore.getItem("player_aspect_pref");
  if (!val) val = localStorage.getItem("player_aspect_pref");
  if (val) playerCard.className = `aspect-${val}`;
}

function openMiniPlayer(videoId) {
  loadAspect(); // apply saved aspect before showing
  frame.src = `https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0`;
  overlay.style.display = "flex";
}
function closeMiniPlayer() {
  frame.src = "about:blank";
  overlay.style.display = "none";
}

overlay.addEventListener("click", (e) => { if (e.target === overlay) closeMiniPlayer(); });
closeBtn.addEventListener("click", closeMiniPlayer);

aspectBtns.forEach(btn => {
  btn.addEventListener("click", async () => {
    const aspect = btn.dataset.aspect;
    playerCard.className = `aspect-${aspect}`;
    await saveAspect(aspect);
    const label = {portrait:"Portrait",wide:"Widescreen",classic:"Classic",square:"Square"}[aspect] || aspect;
    showToast(`${label} mode selected`);
  });
});

/***********************
 * Search filter
 ***********************/
document.getElementById("searchInput").addEventListener("input", e => {
  const q = e.target.value.toLowerCase().trim();
  state.filteredVideos = q ? state.allVideos.filter(v => v.title.toLowerCase().includes(q)) : null;
  renderAll(true);
});

/***********************
 * Load playlist
 ***********************/
async function showPlaylist(input) {
  const container = document.getElementById("playlist");
  const pid = extractPlaylistId(input);
  if (!pid) { container.innerText = "Please enter a valid playlist ID or URL."; return; }

  state.playlistId = pid;
  state.filteredVideos = null;
  state.allVideos = [];
  state.meta = null;
  state.renderIndex = 0;

  // 1) Cached first
  container.classList.add("loading");
  container.textContent = "Loading cached playlist…";
  const cached = await loadFromCache(pid);
  if (cached.videos?.length) {
    state.allVideos = cached.videos;
    state.meta = cached.meta;
    state.sourceUsed = "Cache";
    container.classList.remove("loading");
    renderAll(true);
  }

  // 2) Fresh
  container.classList.add("loading");
  container.textContent = "Fetching latest playlist…";
  const { meta, videos } = await fetchXMLPlaylist(pid);
  container.classList.remove("loading");
  if (!videos.length) {
    if (!cached.videos?.length) container.innerText = "No videos found or playlist is private.";
    state.sourceUsed = cached.videos?.length ? "Cache" : "XML";
    renderAll(true);
    return;
  }

  state.allVideos = videos;
  state.meta = meta;
  state.sourceUsed = "XML";
  await saveToCache(pid, meta, videos);
  renderAll(true);

  // Warm thumbnail cache (best-effort)
  if ("caches" in window) {
    try {
      const urls = videos.map(v => v.thumb).filter(Boolean);
      const cache = await caches.open("yt-thumbs-v1");
      cache.addAll(urls.slice(0, 40));
    } catch {}
  }
}

document.getElementById("loadBtn").addEventListener("click", () => {
  const raw = document.getElementById("playlistIdInput").value.trim();
  showPlaylist(raw);
});
document.getElementById("playlistIdInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("loadBtn").click();
});

/***********************
 * Clear Cache button
 ***********************/
document.getElementById("clearCacheBtn").addEventListener("click", async () => {
  if (!confirm("Clear cached playlists for this viewer?")) return;
  const keys = Object.keys(localStorage).filter(k => k.startsWith("pl_"));
  keys.forEach(k => localStorage.removeItem(k));
  if ("caches" in window) await caches.delete("yt-thumbs-v1");
  if (window.rabbit?.creationStorage?.removeItem) {
    for (const k of keys) await window.rabbit.creationStorage.removeItem(k);
  }
  showToast("Cache cleared");
});

/***********************
 * Init default playlist
 ***********************/
const defaultId = "PLMmqTuUsDkRKv4ulZiAYRoWLu1184CAkt";
document.getElementById("playlistIdInput").value = defaultId;
showPlaylist(defaultId);
