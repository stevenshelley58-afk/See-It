(() => {
  const states = ["closed", "entry", "photo_pick", "uploading", "placing", "waiting", "result", "refining", "error"];
  const stages = ["Reading your room", "Matching the light", "Placing the product", "Checking the result"];
  const configEl = document.querySelector("[data-see-it-config]");
  const config = configEl ? JSON.parse(configEl.textContent || "{}") : {};
  let state = "closed";
  let renderId = "";

  function setState(next, text) {
    state = states.includes(next) ? next : "error";
    const stage = document.querySelector("[data-see-it-stage]");
    if (stage) stage.textContent = text || state;
  }

  function ensureModal() {
    let modal = document.querySelector("[data-see-it-modal]");
    if (modal) return modal;
    modal = document.createElement("div");
    modal.className = "see-it-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.dataset.seeItModal = "true";
    modal.innerHTML = '<div class="see-it-dialog"><h2>See it in your room</h2><div class="see-it-stage" data-see-it-stage>Upload a room photo</div><input data-see-it-file type="file" accept="image/*" capture="environment"><div class="see-it-row"><button class="see-it-secondary" data-see-it-close>Close</button><button class="see-it-button" data-see-it-start>Place product</button></div><p>Generated preview. Shown true to size when dimensions are confirmed.</p></div>';
    document.body.appendChild(modal);
    modal.querySelector("[data-see-it-close]").addEventListener("click", () => modal.hidden = true);
    modal.querySelector("[data-see-it-start]").addEventListener("click", startRender);
    return modal;
  }

  async function startRender() {
    setState("uploading", "Reading your room");
    const roomResponse = await fetch((config.proxyRoot || "/apps/see-it") + "/rooms", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ shop: config.shop, productGid: config.productGid, fileName: "room.jpg", mimeType: "image/jpeg" })
    }).then((res) => res.json());
    setState("placing", "Tap where it should go");
    await fetch((config.proxyRoot || "/apps/see-it") + "/rooms/" + roomResponse.roomSessionId + "/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mimeType: "image/jpeg" }) });
    const render = await fetch((config.proxyRoot || "/apps/see-it") + "/renders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ roomSessionId: roomResponse.roomSessionId, tap: { x: .42, y: .68 } }) }).then((res) => res.json());
    renderId = render.renderId;
    setState("waiting", stages[1]);
    poll();
  }

  async function poll() {
    if (!renderId) return;
    const result = await fetch((config.proxyRoot || "/apps/see-it") + "/renders/" + renderId).then((res) => res.json());
    if (result.status === "done") {
      setState("result", result.dimensionsText || "Shown true to size");
      return;
    }
    if (result.status === "failed") {
      setState("error", result.message || "We couldn't get this one right. Try another photo or retry.");
      return;
    }
    setTimeout(poll, 1800);
  }

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (target && target.closest && target.closest("[data-see-it-open]")) {
      const modal = ensureModal();
      modal.hidden = false;
      setState("entry", "Upload a room photo");
    }
  });
})();
