/* Swat or Buy front-end. Works in two modes: live (talks to /api) and static (a result
   JSON embedded in the page by report.write_bundle). */
(function () {
  const $ = (s, el = document) => el.querySelector(s);
  const fmt = (x, d = 2) => (x === null || x === undefined || Number.isNaN(x)) ? "–" : (x >= 0 ? "+" : "") + Number(x).toFixed(d);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function renderGate(gate, el) {
    if (!gate) { el.hidden = true; return; }
    el.hidden = false;
    el.className = "gate" + (gate.deep_structured ? " ok" : "");
    const checks = (gate.checks || []).map((c) =>
      `<li><span class="${c.passed ? "pass" : "fail"}">${c.passed ? "PASS" : "FAIL"}</span> ${esc(c.name)} <span class="small">· ${esc(c.detail)}</span></li>`).join("");
    el.innerHTML = `<details><summary>Model gate: ${esc(gate.summary)}</summary><ul>${checks}</ul></details>`;
  }

  function gauge(name, cls, r, meta, structured, unit) {
    const dead = !structured;
    return `<div class="gauge ${cls}${dead ? " dead" : ""}">
      <div class="word">${name}</div>
      <div class="val">${fmt(r.mean, unit === "mV" ? 2 : 3)} ${unit}</div>
      <div class="ci">95% [${fmt(r.lo, 2)}, ${fmt(r.hi, 2)}] · n=${r.n}</div>
      <div class="note">${esc(meta.reads_as)}${dead ? " · not seeing image structure in this model build" : ""}</div>
    </div>`;
  }

  function readoutTable(ad, data) {
    const gate = data.gate || {};
    const controls = Object.keys(ad.controls);
    const head = `<tr><th>readout</th><th class="num">ad</th>${controls.map((c) => `<th class="num" title="${esc(data.controls[c] || c)}">${esc(c)}</th>`).join("")}</tr>`;
    const rows = Object.entries(ad.ad.readouts).map(([k, r]) => {
      const st = gate.readouts && gate.readouts[k] ? gate.readouts[k].structured : true;
      const cells = controls.map((c) => {
        const cr = ad.controls[c].readouts[k];
        const sep = ad.controls[c].versus_ad[k];
        return `<td class="num${st ? "" : " dead"}">${fmt(cr.mean, 2)} ${sep.distinct ? '<span class="chip yes" title="ad differs from this control beyond trial noise">≠</span>' : '<span class="chip no" title="ad and control overlap within trial noise">=</span>'}</td>`;
      }).join("");
      return `<tr><td${st ? "" : ' class="dead"'}>${esc(k)} <span class="small">${esc(data.readouts[k].unit)}</span></td><td class="num${st ? "" : " dead"}"><b>${fmt(r.mean, 2)}</b></td>${cells}</tr>`;
    }).join("");
    return `<div style="overflow-x:auto"><table>${head}${rows}</table></div>
      <p class="small">≠ means the ad differs from that control beyond the bootstrap interval of the trials. Greyed readouts failed the model gate.</p>`;
  }

  function pixelTable(ad, data) {
    return `<details class="more"><summary>Pixel statistics the fly must beat</summary><table>${Object.entries(ad.pixel_stats).map(([k, v]) =>
      `<tr><td>${esc(k)} <span class="small">${esc(data.baselines[k] || "")}</span></td><td class="num">${Number(v).toFixed(3)}</td></tr>`).join("")}
      <tr><td>fly map vs spectral-residual saliency, correlation</td><td class="num">${Number(ad.map_correlation_with_pixel_saliency).toFixed(2)}</td></tr></table></details>`;
  }

  function adCard(ad, data, base) {
    const gate = data.gate || {};
    const st = (k) => gate.readouts && gate.readouts[k] ? gate.readouts[k].structured : true;
    const r = ad.ad.readouts;
    const v = ad.verdict || {};
    const lines = (v.lines || []).map((l) => `<li>${esc(l)}</li>`).join("");
    const clip = ad.clip;
    return `<article class="card">
      <div><h3>${esc(clip.name)}</h3><div class="mono">${clip.video ? `${clip.frames} frames · ${clip.total_ms} ms` : `still · ${clip.total_ms} ms`} · ${ad.trials} trials · ${Math.round(ad.wall_seconds)} s of compute</div></div>
      <img id="img-${ad.tag}" src="${base}${ad.images.fly_map}" alt="${esc(clip.name)} with the fly's optic-lobe change overlaid">
      <div class="toggle" data-tag="${ad.tag}" data-base="${base}" data-ad="${ad.images.ad}" data-fly="${ad.images.fly_map}" data-pix="${ad.images.pixel_map}">
        <button type="button" data-k="fly" aria-pressed="true">Fly map</button>
        <button type="button" data-k="ad" aria-pressed="false">Ad</button>
        <button type="button" data-k="pix" aria-pressed="false">Pixel saliency</button>
      </div>
      <div class="gauges">
        ${gauge("Swat", "swat", r.swat, data.readouts.swat, st("swat"), "Hz")}
        ${gauge("Buy", "buy", r.buy, data.readouts.buy, st("buy"), "mV")}
        ${gauge("Glance", "glance", r.glance, data.readouts.glance, st("glance"), "Hz")}
        ${gauge("Boredom", "boredom", r.boredom, data.readouts.boredom, st("boredom"), "1/s")}
      </div>
      <div class="verdict">${v.layout_matters_to_lamina ? "The lamina response depends on layout, not just on brightness: the ad differs from its own pixel scramble." : "The lamina response does not separate this ad from its own pixel scramble; what the fly sees here is brightness and colour, not layout."}
        ${lines ? `<ul>${lines}</ul>` : ""}</div>
      ${readoutTable(ad, data)}
      ${pixelTable(ad, data)}
    </article>`;
  }

  function pairBlock(p, data, base) {
    if (!p) return "";
    const share = p.salience_share_a;
    const pct = Math.round(share * 100);
    return `<section class="pair">
      <div class="mono">Side by side · both orders · ${p.trials} trials</div>
      <div class="big">${p.winner ? `${esc(p.winner)} held more of the optic lobe` : "No side-by-side preference"}</div>
      <div>${esc(p.a)} took <b>${pct}%</b> of the optic-lobe change, ${esc(p.b)} took <b>${100 - pct}%</b>, averaged over both screen orders. ${esc(p.why)}.</div>
      <div class="small">Steering (DNa02 left minus right) toward ${esc(p.a)}: ${fmt(p.turn_toward_a.mean, 3)} Hz, 95% [${fmt(p.turn_toward_a.lo, 3)}, ${fmt(p.turn_toward_a.hi, 3)}]${data.gate && data.gate.readouts && !data.gate.readouts.turn.structured ? " · descending neurons are not seeing image structure in this model build" : ""}</div>
      <div class="imgs">
        <figure><img src="${base}${p.images.ab_fly}" alt="${esc(p.a)} left, ${esc(p.b)} right"><figcaption class="small">${esc(p.a)} | ${esc(p.b)}</figcaption></figure>
        <figure><img src="${base}${p.images.ba_fly}" alt="${esc(p.b)} left, ${esc(p.a)} right"><figcaption class="small">${esc(p.b)} | ${esc(p.a)}</figcaption></figure>
      </div>
    </section>`;
  }

  function renderResult(container, data, base) {
    container.hidden = false;
    container.innerHTML = `<h2>${data.ads.length === 2 ? "Two ads, one fly" : "One ad, one fly"}</h2>
      <div class="grid">${data.ads.map((ad) => adCard(ad, data, base)).join("")}</div>
      ${pairBlock(data.pair, data, base)}
      <p class="small" style="margin-top:1rem">Fly map: absolute change in firing of every column-assigned optic-lobe cell against a grey screen, drawn at the column's screen position. Pixel saliency: spectral-residual saliency of the image itself, for comparison. Every number is stimulus minus grey baseline over the exposure, with a bootstrap interval over jittered trials.</p>`;
    container.querySelectorAll(".toggle").forEach((t) => {
      t.addEventListener("click", (e) => {
        const b = e.target.closest("button"); if (!b) return;
        t.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", x === b ? "true" : "false"));
        $(`#img-${t.dataset.tag}`).src = t.dataset.base + t.dataset[b.dataset.k];
      });
    });
    renderGate(data.gate, $("#gate"));
  }

  // ---- static mode ----
  const embedded = document.getElementById("result");
  if (embedded && embedded.tagName === "SCRIPT") {
    const data = JSON.parse(embedded.textContent);
    const up = $("#upload"); if (up) up.hidden = true;
    const container = document.createElement("section"); container.className = "result";
    embedded.parentNode.insertBefore(container, embedded);
    renderResult(container, data, "");
    return;
  }

  // ---- live mode ----
  const form = $("#form"), files = $("#files"), picked = $("#picked"), status = $("#status"), go = $("#go"), drop = $("#drop");
  let chosen = [];
  const setFiles = (list) => {
    chosen = Array.from(list).slice(0, 2);
    picked.textContent = chosen.map((f) => `${f.name} (${(f.size / 1e6).toFixed(1)} MB)`).join("  +  ");
  };
  files.addEventListener("change", () => setFiles(files.files));
  ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
  drop.addEventListener("drop", (e) => setFiles(e.dataTransfer.files));

  async function poll(id) {
    for (;;) {
      const r = await fetch(`/api/jobs/${id}`); const j = await r.json();
      if (j.status === "queued") status.textContent = `queued, position ${j.position}`;
      else if (j.status === "running") status.textContent = `running · ${j.progress ? j.progress.label : "showing the fly"}`;
      else if (j.status === "error") { status.textContent = j.error; status.classList.add("error"); return null; }
      else return j;
      await new Promise((res) => setTimeout(res, 1500));
    }
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!chosen.length) { status.textContent = "pick one or two files first"; return; }
    status.classList.remove("error"); go.disabled = true; $("#result").hidden = true;
    const fd = new FormData();
    chosen.forEach((f) => fd.append("files", f));
    fd.append("trials", $("#trials").value); fd.append("max_seconds", $("#seconds").value);
    try {
      status.textContent = "uploading";
      const r = await fetch("/api/jobs", { method: "POST", body: fd });
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.detail || r.statusText); }
      const job = await r.json();
      const done = await poll(job.id);
      if (done) {
        const data = await (await fetch(done.result)).json();
        status.textContent = `done in ${Math.round(done.finished_at - done.started_at)} s · permalink: ${location.origin}${done.page}`;
        renderResult($("#result"), data, `/results/${done.id}/`);
        history.replaceState(null, "", `#${done.id}`);
      }
    } catch (err) { status.textContent = err.message; status.classList.add("error"); }
    finally { go.disabled = false; }
  });

  async function boot() {
    try {
      const s = await (await fetch("/api/status")).json();
      if (s.gate) renderGate(s.gate, $("#gate"));
      if (!s.ready) { status.textContent = s.error || "the fly is waking up (loading 166,700 neurons), give it a minute"; setTimeout(boot, 3000); return; }
      status.textContent = s.queue ? `${s.queue} in queue` : "";
      const id = location.hash.slice(1);
      if (id) { const j = await (await fetch(`/api/jobs/${id}`)).json(); if (j.status === "done") renderResult($("#result"), await (await fetch(j.result)).json(), `/results/${id}/`); }
    } catch (e) { status.textContent = "cannot reach the server"; }
  }
  boot();
})();
