async function json(url, opts) {
  const res = await fetch(url, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));
  return data;
}

function el(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => (n[k] = v));
  children.forEach((c) => n.appendChild(typeof c === "string" ? document.createTextNode(c) : c));
  return n;
}

function formatProgress(cursor) {
  if (!cursor || !cursor.stage) return "";
  const stage = cursor.stage;
  const count = cursor.count || 0;
  const stageNames = {
    "fetching_outbound_links": "Fetching outbound links...",
    "fetching_inbound_links": "Fetching inbound links (backlinks)...",
    "fetching_links": "Fetching links...",
    "links_fetched": `Found ${count} links`,
    "resolving_titles": `Resolving ${count} titles...`,
    "titles_resolved": `Resolved ${count} titles`,
    "inserting_pages": `Inserting pages (${count})...`,
    "inserting_links": `Inserting ${count} links...`,
    "computing_degrees": "Computing degrees...",
    "enqueueing_neighbors": `Enqueueing ${count} neighbors for sequential crawl...`,
    "done": `Complete: ${count} links`
  };
  return stageNames[stage] || stage;
}

async function refreshJobs() {
  const out = document.querySelector("#jobs");
  out.innerHTML = "Loading…";
  const data = await json("/api/admin/jobs");
  out.innerHTML = "";
  data.jobs.forEach((j) => {
    // Parse last_cursor if it's a string
    let cursor = j.last_cursor;
    if (typeof cursor === 'string') {
      try {
        cursor = JSON.parse(cursor);
      } catch (e) {
        cursor = null;
      }
    }
    const progress = cursor ? formatProgress(cursor) : "";
    const canCancel = j.status === 'running' || j.status === 'queued';
    
    const jobDiv = el("div", { className: "job" }, [
      el("div", { className: "top" }, [
        el("div", { className: "title" }, [`${j.title} (id ${j.page_id})`]),
        el("div", { style: "display: flex; gap: 8px; align-items: center;" }, [
          canCancel ? el("button", {
            className: "cancel-btn",
            style: "padding: 2px 8px; font-size: 11px; background: #dc2626; border: none; border-radius: 4px; color: white; cursor: pointer;",
            onclick: () => cancelJob(j.page_id)
          }, ["Cancel"]) : null,
          el("div", { className: "badge" }, [j.status]),
        ]),
      ]),
      el("div", { className: "small" }, [
        progress ? `🔄 ${progress}` : "",
        progress ? " · " : "",
        `prio=${j.priority} · out=${j.out_degree} in=${j.in_degree}` + (j.last_error ? ` · ERROR: ${j.last_error}` : ""),
      ]),
    ]);
    out.appendChild(jobDiv);
  });
}

// Extract title from Wikipedia URL or use as-is
function extractTitle(input) {
  input = input.trim();
  // Check if it's a Wikipedia URL
  const urlMatch = input.match(/wikipedia\.org\/wiki\/([^?#]+)/);
  if (urlMatch) {
    // Decode URL-encoded title (e.g., "Dana_Point,_California" -> "Dana Point, California")
    return decodeURIComponent(urlMatch[1].replace(/_/g, ' '));
  }
  return input;
}

document.querySelector("#enqueue").addEventListener("click", async () => {
  const input = document.querySelector("#title").value.trim();
  if (!input) {
    document.querySelector("#enqueueResult").textContent = "Error: Please enter a title or URL";
    return;
  }
  
  const title = extractTitle(input);
  const priority = parseInt(document.querySelector("#priority").value || "0", 10);
  const linkDirection = document.querySelector('input[name="linkDirection"]:checked')?.value || "outbound";
  const autoCrawl = document.querySelector("#autoCrawl")?.checked || false;
  const box = document.querySelector("#enqueueResult");
  box.textContent = "Enqueuing…";
  try {
    const res = await fetch("/api/admin/enqueue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, priority, link_direction: linkDirection, auto_crawl_neighbors: autoCrawl }),
    });
    
    if (!res.ok) {
      const errorText = await res.text();
      let errorMsg;
      try {
        const errorJson = JSON.parse(errorText);
        errorMsg = errorJson.detail || errorJson.message || errorText;
      } catch {
        errorMsg = errorText.substring(0, 200);
      }
      throw new Error(errorMsg);
    }
    
    const data = await res.json();
    const directionText = linkDirection === "inbound" ? " (inbound links)" : " (outbound links)";
    box.textContent = `Queued: ${data.page.title} (page_id ${data.page.page_id})${directionText}`;
    refreshJobs();
  } catch (e) {
    box.textContent = `Error: ${e.message}`;
  }
});

document.querySelector("#refresh").addEventListener("click", refreshJobs);

async function cancelJob(pageId) {
  if (!confirm(`Cancel job ${pageId}?`)) return;
  try {
    await json(`/api/admin/jobs/${pageId}/cancel`, { method: "POST" });
    alert("Job cancelled!");
    refreshJobs();
  } catch (e) {
    alert(`Error: ${e.message}`);
  }
}

document.querySelector("#fetchEgo").addEventListener("click", async () => {
  const pageId = document.querySelector("#pageId").value.trim();
  const out = document.querySelector("#egoOut");
  out.textContent = "Loading…";
  try {
    const data = await json(`/api/graph/ego?page_id=${encodeURIComponent(pageId)}&limit_neighbors=200`);
    out.textContent = JSON.stringify(data, null, 2);
  } catch (e) {
    out.textContent = `Error: ${e.message}`;
  }
});

refreshJobs();

