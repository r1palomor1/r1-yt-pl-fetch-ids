/***********************
 * Storage Utility
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
 * Playlist ID extractor
 ***********************/
function extractPlaylistId(input) {
  const val = input.trim();
  if (!val) return "";
  try {
    const u = new URL(val);
    const list = u.searchParams.get("list");
    if (list) return list;
  } catch (_) {}
  return val;
}

/***********************
 * Fetch YouTube XML feed
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
      const videoIdNode = Array.from(entry.children).find(n => n.localName === "videoId");
      const titleNode = Array.from(entry.children).find(n => n.localName === "title");
      const thumbNode = entry.getElementsByTagNameNS("*", "thumbnail")[0];
      const id = videoIdNode?.textContent?.trim();
      const title = titleNode?.textContent?.trim() || "Untitled";
      const thumb = thumbNode?.getAttribute("url");
      return id ? { id, title, thumb } : null;
    }).filter(Boolean);
    return { meta: { playlistTitle, author }, videos: items };
  } catch (e) {
    console.error("❌ XML fetch/parse error:", e);
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
    <a class="video" href="#" data-vid="${v.id}" data-title="${encodeURIComponent(v.title)}">
      <img class="thumb" src="${v.thumb}" loading="lazy" alt="${v.title}">
      <div class="title">${v.title}</div>
    </a>
  `).join("");
  const temp = document.createElement("div");
  temp.innerHTML = html;
  temp.querySelectorAll(".video").forEach(card => {
    card.addEventListener("click", (e) => {
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
  document.getElementById("sourceTag").innerText = 
    `Source: ${src} — ${count} videos ${state.filteredVideos ? "(filtered)" : ""}`;
  document.getElementById("playlistMeta").innerText =
    state.meta ? `Playlist: ${state.meta.playlistTitle} | By: ${state.meta.author}` : "";
}

/***********************
 * Infinite scroll + fallback
 ***********************/
const sentinel = document.getElementById("sentinel");
if ("IntersectionObserver" in window) {
  const io = new IntersectionObserver((entries)=>{
    if (entries[0].isIntersecting) renderNextBatch();
  }, {root:null, rootMargin:"200px", threshold:0});
  io.observe(sentinel);
} else {
  const btn = document.createElement("button");
  btn.textContent = "Load More";
  btn.onclick = renderNextBatch;
  sentinel.replaceWith(btn);
}

/***********************
 * Mini Player with adaptive + presets + saved size
 ***********************/
const overlay = document.getElementById("playerOverlay");
const frame = document.getElementById("playerFrame");
const closeBtn = document.getElementById("playerClose");
const playerCard = document.getElementById("playerCard");
const sizeBtns = document.querySelectorAll("#sizeButtons button");

async function loadSavedSize() {
  const key = "player_size_pref";
  let val = null;
  try { val = await creationStore.getItem(key); } catch {}
  if (!val) val = localStorage.getItem(key);
  if (val) playerCard.className = `size-${val}`;
}

async function saveSizePref(size) {
  const key = "player_size_pref";
  await creationStore.setItem(key, size);
  localStorage.setItem(key, size);
}

function openMiniPlayer(id) {
  // Apply saved size before showing
  loadSavedSize();
  frame.src = `https://www.youtube.com/embed/${id}?autoplay=1&rel=0`;
  overlay.style.display = "flex";
}

function closeMiniPlayer() {
  frame.src = "about:blank";
  overlay.style.display = "none";
}

overlay.addEventListener("click", e => { if (e.target===overlay) closeMiniPlayer(); });
closeBtn.addEventListener("click", closeMiniPlayer);

// Manual size presets with persistence
sizeBtns.forEach(btn=>{
  btn.addEventListener("click", async ()=>{
    const size = btn.dataset.size;
    playerCard.className = size ? `size-${size}` : "";
    await saveSizePref(size);
  });
});

/***********************
 * UI helpers
 ***********************/
function setLoading(isLoading, msg="Fetching playlist…") {
  const c = document.getElementById("playlist");
  if (isLoading) { c.classList.add("loading"); c.innerText = msg; }
  else c.classList.remove("loading");
}

/***********************
 * Main controller
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

  // 1) Cached
  setLoading(true, "Loading cached playlist…");
  const cached = await loadFromCache(pid);
  if (cached.videos?.length) {
    state.allVideos = cached.videos;
    state.meta = cached.meta;
    state.sourceUsed = "Cache";
    setLoading(false);
    renderAll(true);
  }

  // 2) Fresh
  setLoading(true, "Fetching latest playlist…");
  const {meta, videos} = await fetchXMLPlaylist(pid);
  setLoading(false);
  if (!videos.length) {
    if (!cached.videos?.length) container.innerText="No videos found or playlist is private.";
    state.sourceUsed = cached.videos?.length ? "Cache" : "XML";
    renderAll(true);
    return;
  }

  state.allVideos = videos;
  state.meta = meta;
  state.sourceUsed = "XML";
  await saveToCache(pid, meta, videos);
  renderAll(true);

  // Optional: warm thumbnail cache
  if ("caches" in window) {
    try {
      const urls = videos.map(v => v.thumb).filter(Boolean);
      const cache = await caches.open("yt-thumbs-v1");
      cache.addAll(urls.slice(0, 40));
    } catch {}
  }
}

/***********************
 * Search filter
 ***********************/
document.getElementById("searchInput").addEventListener("input", e => {
  const q = e.target.value.toLowerCase().trim();
  state.filteredVideos = q ? state.allVideos.filter(v=>v.title.toLowerCase().includes(q)) : null;
  renderAll(true);
});

/***********************
 * Load playlist
 ***********************/
document.getElementById("loadBtn").addEventListener("click", ()=>{
  const val = document.getElementById("playlistIdInput").value.trim();
  showPlaylist(val);
});
document.getElementById("playlistIdInput").addEventListener("keydown", e=>{
  if (e.key==="Enter") document.getElementById("loadBtn").click();
});

/***********************
 * Clear Cache button
 ***********************/
document.getElementById("clearCacheBtn").addEventListener("click", async ()=>{
  if (!confirm("Clear cached playlists for this viewer?")) return;
  const keys = Object.keys(localStorage).filter(k=>k.startsWith("pl_"));
  keys.forEach(k=>localStorage.removeItem(k));
  if ("caches" in window) await caches.delete("yt-thumbs-v1");
  if (window.rabbit?.creationStorage?.removeItem) {
    for (const k of keys) await window.rabbit.creationStorage.removeItem(k);
  }
  alert("✅ Cache cleared for this app.");
});

/***********************
 * Initial default playlist
 ***********************/
const defaultId = "PLMmqTuUsDkRKv4ulZiAYRoWLu1184CAkt";
document.getElementById("playlistIdInput").value = defaultId;
showPlaylist(defaultId);
