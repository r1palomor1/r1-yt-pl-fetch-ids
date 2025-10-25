// ---------- Storage helpers ----------
const creationStore = {
  async getItem(k){try{if(window.rabbit?.creationStorage?.getItem)return await window.rabbit.creationStorage.getItem(k);}catch{}return localStorage.getItem(k);},
  async setItem(k,v){try{if(window.rabbit?.creationStorage?.setItem)return await window.rabbit.creationStorage.setItem(k,v);}catch{}localStorage.setItem(k,v);},
  async removeItem(k){try{if(window.rabbit?.creationStorage?.removeItem)return await window.rabbit.creationStorage.removeItem(k);}catch{}localStorage.removeItem(k);}
};

// ---------- Utilities ----------
function extractPlaylistId(input){
  const val=input.trim(); if(!val)return"";
  try{const u=new URL(val);const list=u.searchParams.get("list");if(list)return list;}catch{}
  return val;
}

// ---------- Fetch YouTube playlist (XML feed) ----------
async function fetchXMLPlaylist(id){
  const feed=`https://www.youtube.com/feeds/videos.xml?playlist_id=${id}`;
  const proxy=`https://corsproxy.io/?${encodeURIComponent(feed)}`;
  try{
    const res=await fetch(proxy);
    const xmlText=await res.text();
    const xml=new DOMParser().parseFromString(xmlText,"application/xml");
    const meta={
      playlistTitle:xml.querySelector("feed>title")?.textContent||"Untitled Playlist",
      author:xml.querySelector("author>name")?.textContent||"Unknown"
    };
    const items=[...xml.getElementsByTagName("entry")].map(e=>{
      const vid=e.querySelector("yt\\:videoId")?.textContent||[...e.children].find(n=>n.localName==="videoId")?.textContent;
      const title=e.querySelector("title")?.textContent||"Untitled";
      const thumb=e.getElementsByTagNameNS("*","thumbnail")[0]?.getAttribute("url");
      return vid?{id:vid,title,thumb}:null;
    }).filter(Boolean);
    return {meta,videos:items};
  }catch(err){
    console.error("Playlist fetch error:",err);
    return {meta:null,videos:[]};
  }
}

// ---------- Cache ----------
async function loadFromCache(id){
  const mk=`pl_${id}_meta`,vk=`pl_${id}_videos`;
  const [m,v]=await Promise.all([creationStore.getItem(mk),creationStore.getItem(vk)]);
  let meta=null,videos=[];
  try{meta=m?JSON.parse(m):null;}catch{}
  try{videos=v?JSON.parse(v):[];}catch{}
  return{meta,videos};
}
async function saveToCache(id,m,v){
  await creationStore.setItem(`pl_${id}_meta`,JSON.stringify(m||null));
  await creationStore.setItem(`pl_${id}_videos`,JSON.stringify(v||[]));
}

// ---------- State ----------
const s={playlistId:"",allVideos:[],filtered:null,idx:0,batch:24,busy:false,meta:null,source:"XML"};
function current(){return s.filtered??s.allVideos;}
function clearGrid(){playlist.innerHTML="";s.idx=0;}
function renderNext(){
  if(s.busy)return;
  const list=current(); if(!list||s.idx>=list.length)return;
  s.busy=true;
  const end=Math.min(s.idx+s.batch,list.length);
  const frag=document.createDocumentFragment();
  for(const v of list.slice(s.idx,end)){
    const a=document.createElement("a");
    a.className="video"; a.href="#"; a.dataset.vid=v.id;
    a.innerHTML=`<img class="thumb" src="${v.thumb}" loading="lazy"><div class="title">${v.title}</div>`;
    a.onclick=e=>{e.preventDefault();openMiniPlayer(v.id);};
    frag.append(a);
  }
  playlist.append(frag);
  s.idx=end; s.busy=false;
}
function renderAll(reset=false){
  if(reset)clearGrid(); renderNext();
  sourceTag.textContent=`Source: ${s.source} — ${(current()||[]).length} videos${s.filtered?" (filtered)":""}`;
  playlistMeta.textContent=s.meta?`Playlist: ${s.meta.playlistTitle} | By: ${s.meta.author}`:"";
}

// ---------- Infinite scroll ----------
if("IntersectionObserver"in window){
  new IntersectionObserver(e=>{if(e[0].isIntersecting)renderNext();},{rootMargin:"200px"}).observe(sentinel);
}else{
  const btn=document.createElement("button");
  btn.textContent="Load More"; btn.onclick=renderNext;
  sentinel.replaceWith(btn);
}

// ---------- Mini Player ----------
const overlay=playerOverlay,frame=playerFrame,card=playerCard,closeBtn=playerClose;
function openMiniPlayer(id){
  frame.src=`https://www.youtube.com/embed/${id}?autoplay=1&rel=0`;
  overlay.style.display="flex";
  card.classList.remove("zoom-fill","zoom-portrait");
}
function closeMiniPlayer(){
  frame.src="about:blank";
  overlay.style.display="none";
  card.classList.remove("zoom-fill","zoom-portrait");
}
overlay.onclick=e=>{ if(e.target===overlay) closeMiniPlayer(); };
closeBtn.onclick=closeMiniPlayer;

// ---------- Zoom / Aspect Buttons ----------
document.querySelectorAll("#zoomControls button").forEach(btn=>{
  btn.onclick=()=>{
    const mode=btn.dataset.zoom;
    card.classList.remove("zoom-fill","zoom-portrait");
    if(mode==="fill") card.classList.add("zoom-fill");
    if(mode==="portrait") card.classList.add("zoom-portrait");
  };
});

// ---------- Search ----------
searchInput.oninput=e=>{
  const q=e.target.value.toLowerCase().trim();
  s.filtered=q?s.allVideos.filter(v=>v.title.toLowerCase().includes(q)):null;
  renderAll(true);
};

// ---------- Load Playlist ----------
async function showPlaylist(input){
  const id=extractPlaylistId(input);
  if(!id){playlist.textContent="Please enter a valid playlist ID or URL.";return;}
  s.playlistId=id; s.filtered=null; s.allVideos=[]; s.meta=null; s.idx=0;

  playlist.classList.add("loading"); playlist.textContent="Loading cached playlist…";
  const cached=await loadFromCache(id);
  if(cached.videos.length){s.allVideos=cached.videos;s.meta=cached.meta;s.source="Cache";playlist.classList.remove("loading");renderAll(true);}

  playlist.classList.add("loading"); playlist.textContent="Fetching latest playlist…";
  const {meta,videos}=await fetchXMLPlaylist(id);
  playlist.classList.remove("loading");
  if(!videos.length){
    if(!cached.videos.length) playlist.textContent="No videos found or playlist is private.";
    s.source=cached.videos.length?"Cache":"XML"; renderAll(true); return;
  }

  s.allVideos=videos; s.meta=meta; s.source="XML";
  await saveToCache(id,meta,videos); renderAll(true);

  // Warm thumbnail cache
  if("caches"in window){
    try{
      const urls=videos.map(v=>v.thumb).filter(Boolean);
      const cache=await caches.open("yt-thumbs-v1");
      cache.addAll(urls.slice(0,40));
    }catch{}
  }
}

// ---------- Buttons ----------
loadBtn.onclick=()=>showPlaylist(playlistIdInput.value.trim());
playlistIdInput.onkeydown=e=>{if(e.key==="Enter")loadBtn.onclick();};
clearCacheBtn.onclick=async()=>{
  if(!confirm("Clear cached playlists for this viewer?"))return;
  const keys=Object.keys(localStorage).filter(k=>k.startsWith("pl_"));
  keys.forEach(k=>localStorage.removeItem(k));
  if("caches"in window) await caches.delete("yt-thumbs-v1");
  if(window.rabbit?.creationStorage?.removeItem) for(const k of keys) await window.rabbit.creationStorage.removeItem(k);
  alert("✅ Cache cleared");
};

// ---------- Default startup ----------
playlistIdInput.value="PL5-HMe7xBEipV2bC7aZqyCx7th_7JXfI9";
showPlaylist(playlistIdInput.value);
