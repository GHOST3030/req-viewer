import { useState, useEffect } from "react";

const SERVER = "http://10.10.10.10";
const API = "/api/";
const img = (id) => API + "ItemImage/" + id;
const stream = (id) => API + "stream/" + id;
const sub = (src) => API + "subtitle/" + src + ".vtt";
const dl = (id) => `${SERVER}/api/downloadItem/${id}/video`;

const jget = async (p) => {
  const r = await fetch(API + p);
  const t = await r.text();
  try { return JSON.parse(t); } catch { return null; }
};

async function findSubtitleOnServer(candidates) {
  for (const c of candidates.filter(Boolean)) {
    try {
      const r = await fetch(sub(c));
      if (!r.ok) continue;
      const t = await r.text();
      if (t.trim().toUpperCase().startsWith("WEBVTT")) return c;
    } catch { /* candidate not available, try next */ }
  }
  return null;
}

const LAST_STATE_KEY = "reqviewer:lastState";
const saveLastState = (s) => {
  try { localStorage.setItem(LAST_STATE_KEY, JSON.stringify(s)); } catch { /* ignore quota/serialize errors */ }
};
const loadLastState = () => {
  try { return JSON.parse(localStorage.getItem(LAST_STATE_KEY)); } catch { return null; }
};
const asArr = (d) =>
  Array.isArray(d) ? d
  : d && typeof d === "object" ? Object.values(d).map(asArr).find(Boolean) || null
  : null;

async function queueDownloads(ids) {
  for (const id of ids) {
    const a = document.createElement("a");
    a.href = dl(id); a.download = "";
    document.body.appendChild(a); a.click(); a.remove();
    await new Promise((r) => setTimeout(r, 1200));
  }
}

function exportList(eps) {
  const urls = eps.map((e) => dl(e.id)).join("\n");
  const script = "# aria2c -i downloads.txt -j 3 -c\n# or: wget -c -i downloads.txt\n\n" + urls + "\n";
  const blob = new Blob([script], { type: "text/plain" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = "downloads.txt"; a.click();
  URL.revokeObjectURL(a.href);
}

export default function App() {
  const [restored] = useState(() => loadLastState());

  const [roots, setRoots] = useState([]);
  const [stack, setStack] = useState(restored?.stack || []);
  const [subs, setSubs] = useState(restored?.subs || null);
  const [items, setItems] = useState(restored?.items || null);
  const [nav, setNav] = useState(restored?.nav || null);
  const [play, setPlay] = useState(null);
  const [sel, setSel] = useState({});
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("...");
  const [q, setQ] = useState("");
  const [noSubs, setNoSubs] = useState(null); // { checking, checked, total, ids: Set }
  const [onlyNoSubs, setOnlyNoSubs] = useState(false);
  const [foundSubs, setFoundSubs] = useState({}); // { [episodeId]: subtitleSrcId }

  useEffect(() => {
    jget("sections").then((d) => {
      const l = (asArr(d) || []).filter((s) => s.is_hidden !== "yes" && !s.in_section);
      setRoots(l); setStatus(l.length + " قسم");
    }).catch((e) => setStatus("خطأ: " + e.message));
  }, []);

  useEffect(() => {
    saveLastState({ stack, subs, items, nav });
  }, [stack, subs, items, nav]);

  const cur = stack[stack.length - 1] || null;

  async function openSection(s) {
    setStack([...stack, s]); setItems(null); setSubs(null); setNav(null); setSel({}); setBusy(true); setQ("");
    setNoSubs(null); setOnlyNoSubs(false); setFoundSubs({});
    const sd = await jget("sections/0/100/" + s.id);
    const secs = (asArr(sd) || []).filter((x) => x.is_hidden !== "yes");
    if (secs.length) { setSubs(secs); setBusy(false); return; }
    const it = await jget("getItems/0/300/" + s.id);
    setItems(asArr(it) || []); setBusy(false);
  }

  function toPlay(pd, fallbackName, posterId, epIndex) {
    return {
      src: pd?.sources?.[0]?.src,
      sources: pd?.sources || [],
      tracks: pd?.tracks || [],
      title: pd?.title || fallbackName,
      poster: posterId,
      epIndex: epIndex ?? null,
    };
  }

  async function openItem(it) {
    setBusy(true); setSel({});
    const pd = await jget("getPlayData/" + it.id);
    if (pd && pd.sources && pd.sources.length) { setPlay(toPlay(pd, it.name, it.id)); setBusy(false); return; }
    const seasons = asArr(await jget("getSeries/" + it.id)) || [];
    if (seasons.length === 1) { openSeason(seasons[0], it.name); return; }
    setNav({ level: "seasons", list: seasons, title: it.name }); setBusy(false);
  }

  async function openSeason(se, seriesName) {
    setBusy(true); setSel({});
    let eps = asArr(await jget("getEpisods/" + se.id)) || [];
    if (!eps.length) eps = asArr(await jget("getSeries/" + se.id)) || [];
    setNav({ level: "episodes", list: eps, title: (seriesName || "") + " " + se.name });
    setNoSubs(null); setOnlyNoSubs(false); setFoundSubs({}); setBusy(false);
  }

  async function findMissingSubs(list) {
    setNoSubs({ checking: true, checked: 0, total: list.length, ids: new Set() });
    const missing = new Set();
    const found = {};
    let checked = 0;
    const queue = [...list];
    const worker = async () => {
      while (queue.length) {
        const ep = queue.shift();
        const pd = await jget("getPlayData/" + ep.id);
        if (!pd || !pd.tracks || pd.tracks.length === 0) {
          const src = await findSubtitleOnServer([pd?.sources?.[0]?.src, ep.id]);
          if (src) found[ep.id] = src; else missing.add(ep.id);
        }
        checked++;
        setNoSubs({ checking: true, checked, total: list.length, ids: new Set(missing) });
        setFoundSubs((f) => ({ ...f, ...found }));
      }
    };
    await Promise.all(Array.from({ length: 4 }, worker));
    setNoSubs({ checking: false, checked: list.length, total: list.length, ids: missing });
  }

  async function playEpisode(ep, index) {
    setBusy(true);
    const pd = await jget("getPlayData/" + ep.id);
    const p = pd?.sources?.length ? toPlay(pd, ep.name, ep.id, index)
                                  : { src: ep.id, sources: [], tracks: [], title: ep.name, poster: ep.id, epIndex: index };
    if (p.tracks.length === 0 && foundSubs[ep.id]) {
      p.tracks = [{ src: foundSubs[ep.id], label: "ترجمة (مكتشفة)" }];
    }
    setPlay(p);
    setBusy(false);
  }

  const epList = nav?.level === "episodes" ? nav.list : null;
  const hasNext = play && epList && play.epIndex != null && play.epIndex + 1 < epList.length;
  const hasPrev = play && epList && play.epIndex != null && play.epIndex - 1 >= 0;
  const goEp = (delta) => {
    const i = play.epIndex + delta;
    playEpisode(epList[i], i);
  };

  function back() {
    if (play) return setPlay(null);
    if (nav) { setNav(null); setSel({}); setNoSubs(null); setOnlyNoSubs(false); setFoundSubs({}); return; }
    setStack(stack.slice(0, -1)); setItems(null); setSubs(null); setQ("");
  }

  const grid = cur ? subs : roots;
  const filt = (l) => l.filter((x) =>
    q ? (x.name || JSON.stringify(x)).toString().toLowerCase().includes(q.toLowerCase()) : true);

  const isEpisodes = nav?.level === "episodes";
  const selIds = nav ? nav.list.filter((e) => sel[e.id]).map((e) => e.id) : [];
  const allSel = nav && selIds.length === nav.list.length && nav.list.length > 0;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 p-4">
      <div className="max-w-6xl mx-auto space-y-4">
        <div className="flex items-center gap-3 flex-wrap">
          {(stack.length > 0 || nav || play) && (
            <button onClick={back} className="text-emerald-400 text-sm">‹ رجوع</button>
          )}
          <h1 className="text-lg text-slate-100">
            {play ? play.title : nav ? nav.title : cur ? cur.name : "الأقسام"}
          </h1>
          <span className="text-xs text-slate-500">{busy ? "..." : items ? items.length + " عنصر" : status}</span>
        </div>

        {play && (
          <div className="space-y-3">
            <video key={play.src} controls autoPlay playsInline crossOrigin="anonymous"
              poster={img(play.poster)} className="w-full rounded bg-black max-h-[70vh]"
              onEnded={() => hasNext && goEp(1)}>
              <source src={stream(play.src)} />
              {play.tracks.map((t, i) => (
                <track key={i} kind="subtitles" src={sub(t.src)}
                  srcLang={t.srclang || t.srcLang || "ar"} label={t.label || "عربي"} default={i === 0} />
              ))}
            </video>

            {epList && play.epIndex != null && (
              <div className="flex gap-2 items-center">
                <button disabled={!hasPrev} onClick={() => goEp(-1)}
                  className="text-sm bg-slate-800 disabled:opacity-40 rounded px-4 py-2">‹ السابقة</button>
                <span className="text-xs text-slate-500 flex-1 text-center">
                  {play.epIndex + 1} / {epList.length}
                </span>
                <button disabled={!hasNext} onClick={() => goEp(1)}
                  className="text-sm bg-emerald-600 disabled:opacity-40 text-white rounded px-4 py-2">التالية ›</button>
              </div>
            )}

            <div className="flex gap-2 flex-wrap items-center">
              <a href={dl(play.src)} className="text-sm bg-sky-600 text-white rounded px-4 py-2">تنزيل</a>
              {play.tracks.length === 0 && <span className="text-xs text-slate-500">لا توجد ترجمة</span>}
              {play.sources.length > 1 && play.sources.map((s) => (
                <button key={s.src} onClick={() => setPlay({ ...play, src: s.src })}
                  className={"text-xs rounded px-3 py-1 border " +
                    (s.src === play.src ? "border-emerald-500 text-emerald-400" : "border-slate-700 text-slate-400")}>
                  {s.label || s.size}
                </button>
              ))}
            </div>
          </div>
        )}

        {!play && nav && (
          <>
            {isEpisodes && nav.list.length > 0 && (
              <div className="flex gap-2 flex-wrap items-center border border-slate-800 rounded p-2">
                <label className="text-sm flex items-center gap-2">
                  <input type="checkbox" checked={allSel}
                    onChange={(e) => setSel(e.target.checked
                      ? Object.fromEntries(nav.list.map((x) => [x.id, true])) : {})} />
                  تحديد الكل
                </label>
                <span className="text-xs text-slate-500">{selIds.length} محدد</span>
                <div className="flex-1" />
                <button disabled={!selIds.length} onClick={() => queueDownloads(selIds)}
                  className="text-sm bg-sky-600 disabled:opacity-40 text-white rounded px-3 py-1.5">تنزيل المحدد</button>
                <button disabled={!selIds.length}
                  onClick={() => exportList(nav.list.filter((e) => sel[e.id]))}
                  className="text-sm border border-slate-600 disabled:opacity-40 text-slate-300 rounded px-3 py-1.5">تصدير قائمة</button>
              </div>
            )}
            {isEpisodes && nav.list.length > 0 && (
              <div className="flex gap-2 flex-wrap items-center border border-slate-800 rounded p-2">
                <button disabled={noSubs?.checking} onClick={() => findMissingSubs(nav.list)}
                  className="text-sm bg-amber-600 disabled:opacity-40 text-white rounded px-3 py-1.5">
                  {noSubs?.checking ? `جارِ الفحص ${noSubs.checked}/${noSubs.total}...` : "فحص الحلقات بدون ترجمة"}
                </button>
                {noSubs && !noSubs.checking && (
                  <>
                    <span className="text-xs text-slate-400">
                      {noSubs.ids.size} حلقة بدون ترجمة من {noSubs.total}
                      {Object.keys(foundSubs).length > 0 && ` (تم العثور على ترجمة لـ ${Object.keys(foundSubs).length})`}
                    </span>
                    {noSubs.ids.size > 0 && (
                      <>
                        <label className="text-sm flex items-center gap-2">
                          <input type="checkbox" checked={onlyNoSubs}
                            onChange={(e) => setOnlyNoSubs(e.target.checked)} />
                          إظهار غير المترجمة فقط
                        </label>
                        <button onClick={() => setSel(Object.fromEntries(
                          nav.list.filter((e) => noSubs.ids.has(e.id)).map((e) => [e.id, true])))}
                          className="text-sm border border-amber-600 text-amber-400 rounded px-3 py-1.5">
                          تحديد غير المترجمة
                        </button>
                      </>
                    )}
                  </>
                )}
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
              {nav.list.map((x, idx) => {
                const missing = noSubs && !noSubs.checking && noSubs.ids.has(x.id);
                const discovered = foundSubs[x.id];
                if (isEpisodes && onlyNoSubs && !missing) return null;
                return (
                  <div key={x.id} className={"bg-slate-900 border rounded p-3 flex items-center gap-3 " +
                    (missing ? "border-amber-600" : discovered ? "border-emerald-600" : "border-slate-800")}>
                    {isEpisodes && (
                      <input type="checkbox" checked={!!sel[x.id]}
                        onChange={(e) => setSel({ ...sel, [x.id]: e.target.checked })} />
                    )}
                    <button onClick={() => (isEpisodes ? playEpisode(x, idx) : openSeason(x, nav.title))}
                      className="flex-1 text-right hover:text-emerald-400">
                      <p className="text-slate-100 text-sm">{x.name}</p>
                      {!isEpisodes && <p className="text-xs text-slate-500">{x.type}</p>}
                      {missing && <p className="text-xs text-amber-500">بدون ترجمة</p>}
                      {discovered && <p className="text-xs text-emerald-500">تم العثور على ترجمة</p>}
                    </button>
                  </div>
                );
              })}
              {nav.list.length === 0 && <p className="text-slate-500 text-sm">لا توجد حلقات.</p>}
              {isEpisodes && onlyNoSubs && noSubs && noSubs.ids.size === 0 && (
                <p className="text-slate-500 text-sm">لا توجد حلقات بدون ترجمة.</p>
              )}
            </div>
          </>
        )}

        {!play && !nav && !items && !busy && grid && grid.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {grid.map((s) => (
              <button key={s.id} onClick={() => openSection(s)}
                className="bg-slate-900 border border-slate-800 rounded p-4 text-right hover:border-emerald-600">
                <p className="text-slate-100">{s.name}</p>
                <p className="text-xs text-slate-500 mt-1">{s.type} · {s.views} مشاهدة</p>
              </button>
            ))}
          </div>
        )}

        {!play && !nav && items && (
          <>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="بحث..."
              className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm" />
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
              {filt(items).map((it) => (
                <button key={it.id} onClick={() => openItem(it)}
                  className="bg-slate-900 border border-slate-800 rounded overflow-hidden text-right hover:border-emerald-600">
                  <img src={img(it.id)} alt="" loading="lazy"
                    className="w-full aspect-[2/3] object-cover bg-slate-800"
                    onError={(e) => (e.currentTarget.style.visibility = "hidden")} />
                  <div className="p-2">
                    <p className="text-sm text-slate-100">{it.name}</p>
                    <p className="text-xs text-slate-500 mt-1">
                      {it.type}{it.NumOfEps ? " · " + it.NumOfEps + " حلقة" : ""}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
