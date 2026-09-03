const form = document.querySelector("#postForm");
const dialog = document.querySelector("#confirmDialog");
const publishButton = document.querySelector("#publishButton");
const loginButton = document.querySelector("#loginButton");
const logoutButton = document.querySelector("#logoutButton");
const accountState = document.querySelector("#accountState");
const installButton = document.querySelector("#installButton");
const installDialog = document.querySelector("#installDialog");
const reviewButton = document.querySelector("#reviewButton");
const handoffBanner = document.querySelector("#handoffBanner");
const favoriteButton = document.querySelector("#favoriteButton");
const favoritesList = document.querySelector("#favoritesList");
const notice = document.querySelector("#notice");
const saveState = document.querySelector("#saveState");
const fields = Object.fromEntries(["subreddit", "title", "text", "url", "nsfw", "spoiler"].map((id) => [id, document.querySelector(`#${id}`)]));
const draftKey = "reddit-poster-draft-v1";
const favoritesKey = "reddit-poster-favorites-v1";
let connected = false;
let apiAvailable = true;
let saveTimer;
let installPrompt;
let favorites = loadFavorites();

restoreDraft();
updateView();
renderFavorites();
loadAccount();
showLoginResult();
registerServiceWorker();

form.addEventListener("input", () => {
  updateView();
  scheduleSave();
});
form.addEventListener("change", () => {
  updateView();
  scheduleSave();
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  hideNotice();
  if (!form.reportValidity()) return;
  if (!connected) {
    const data = readForm();
    localStorage.setItem(draftKey, JSON.stringify(data));
    if (data.kind === "self" && data.text) navigator.clipboard?.writeText(data.text).catch(() => {});
    window.location.assign(buildRedditSubmitUrl(data));
    return;
  }
  const data = readForm();
  document.querySelector("#confirmSummary").textContent = `„${data.title}“ wird in r/${normalizeSubreddit(data.subreddit)} veröffentlicht.`;
  dialog.showModal();
});

document.querySelector("#confirmForm").addEventListener("submit", async (event) => {
  if (event.submitter?.value !== "default") return;
  event.preventDefault();
  publishButton.disabled = true;
  publishButton.textContent = "Wird veröffentlicht …";
  try {
    const response = await fetch("/api/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(readForm()),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Der Beitrag konnte nicht veröffentlicht werden.");
    dialog.close();
    localStorage.removeItem(draftKey);
    form.reset();
    updateView();
    showNotice(`Veröffentlicht. `, false, result.url);
  } catch (error) {
    dialog.close();
    showNotice(error.message, true);
  } finally {
    publishButton.disabled = false;
    publishButton.textContent = "Jetzt veröffentlichen";
  }
});

document.querySelector("#clearButton").addEventListener("click", () => {
  if (!window.confirm("Den gespeicherten Entwurf wirklich leeren?")) return;
  form.reset();
  localStorage.removeItem(draftKey);
  updateView();
  saveState.textContent = "Entwurf geleert";
});

logoutButton.addEventListener("click", async () => {
  await fetch("/api/logout", { method: "POST", headers: { "Content-Type": "application/json" } });
  connected = false;
  renderAccount();
  showNotice("Reddit-Konto wurde getrennt.");
});

favoriteButton.addEventListener("click", () => {
  const subreddit = normalizeSubreddit(fields.subreddit.value);
  if (!/^[A-Za-z0-9_]{2,21}$/.test(subreddit)) {
    showNotice("Gib zuerst ein gültiges Subreddit ein.", true);
    fields.subreddit.focus();
    return;
  }
  if (!favorites.some((item) => item.toLowerCase() === subreddit.toLowerCase())) favorites.unshift(subreddit);
  favorites = favorites.slice(0, 12);
  saveFavorites();
  renderFavorites();
  favoriteButton.textContent = "★ Gespeichert";
  setTimeout(() => { favoriteButton.textContent = "☆ Aktuelles Subreddit merken"; }, 1200);
});

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  installPrompt = event;
});

installButton.addEventListener("click", async () => {
  if (installPrompt) {
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    return;
  }
  installDialog.showModal();
});

async function loadAccount() {
  try {
    const response = await fetch("/api/me");
    if (response.status === 503) apiAvailable = false;
    if (!response.ok) throw new Error();
    const account = await response.json();
    connected = true;
    accountState.textContent = `u/${account.name}`;
  } catch {
    connected = false;
    accountState.textContent = "Nicht verbunden";
  }
  renderAccount();
}

function renderAccount() {
  loginButton.hidden = connected || !apiAvailable;
  logoutButton.hidden = !connected;
  if (!connected) accountState.textContent = "Nicht verbunden";
  reviewButton.textContent = connected ? "Beitrag prüfen" : "In Reddit öffnen";
  handoffBanner.classList.toggle("connected", connected);
  handoffBanner.querySelector("strong").textContent = connected ? "Direktes Veröffentlichen bereit" : "Schnellmodus aktiv";
  handoffBanner.querySelector("p").textContent = connected
    ? "Nach deiner Kontrolle kann der Beitrag direkt veröffentlicht werden."
    : "Dein fertiger Beitrag öffnet sich direkt in Reddit. Dort drückst du nur noch auf „Posten“.";
}

function buildRedditSubmitUrl(data) {
  const params = new URLSearchParams({
    title: data.title,
    type: data.kind === "link" ? "LINK" : "TEXT",
  });
  params.set(data.kind === "link" ? "url" : "text", data.kind === "link" ? data.url : data.text);
  return `https://www.reddit.com/r/${encodeURIComponent(data.subreddit)}/submit?${params}`;
}

function readForm() {
  const data = new FormData(form);
  return {
    subreddit: normalizeSubreddit(data.get("subreddit")),
    kind: data.get("kind") || "self",
    title: String(data.get("title") || "").trim(),
    text: String(data.get("text") || "").trim(),
    url: String(data.get("url") || "").trim(),
    nsfw: data.get("nsfw") === "on",
    spoiler: data.get("spoiler") === "on",
  };
}

function updateView() {
  const data = readForm();
  const isLink = data.kind === "link";
  document.querySelector("#textField").hidden = isLink;
  document.querySelector("#urlField").hidden = !isLink;
  fields.text.required = !isLink;
  fields.url.required = isLink;
  document.querySelector("#titleCount").textContent = `${fields.title.value.length} / 300`;
  document.querySelector("#textCount").textContent = `${fields.text.value.length.toLocaleString("de-DE")} Zeichen`;
  document.querySelector("#previewSubreddit").textContent = data.subreddit || "Subreddit";
  document.querySelector("#previewTitle").textContent = data.title || "Dein Titel erscheint hier";
  document.querySelector("#previewBody").textContent = isLink
    ? (data.url || "Die Link-Adresse erscheint hier.")
    : (data.text || "Während du schreibst, siehst du hier ungefähr, wie der Beitrag auf Reddit wirken wird.");
  const tags = document.querySelector("#previewTags");
  tags.replaceChildren();
  if (data.nsfw) tags.append(tag("NSFW", "nsfw"));
  if (data.spoiler) tags.append(tag("Spoiler", "spoiler"));
}

function tag(text, className) {
  const element = document.createElement("span");
  element.className = `tag ${className}`;
  element.textContent = text;
  return element;
}

function scheduleSave() {
  saveState.textContent = "Speichert …";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    localStorage.setItem(draftKey, JSON.stringify(readForm()));
    saveState.textContent = "Entwurf gespeichert";
  }, 350);
}

function restoreDraft() {
  try {
    const draft = JSON.parse(localStorage.getItem(draftKey));
    if (!draft) return;
    Object.entries(draft).forEach(([key, value]) => {
      if (key === "kind") {
        const radio = form.querySelector(`[name="kind"][value="${value}"]`);
        if (radio) radio.checked = true;
      } else if (fields[key]) {
        if (fields[key].type === "checkbox") fields[key].checked = Boolean(value);
        else fields[key].value = value;
      }
    });
  } catch {
    localStorage.removeItem(draftKey);
  }
}

function loadFavorites() {
  try {
    const saved = JSON.parse(localStorage.getItem(favoritesKey));
    return Array.isArray(saved) ? saved : ["FragReddit", "de", "Ratschlag"];
  } catch {
    return ["FragReddit", "de", "Ratschlag"];
  }
}

function saveFavorites() {
  localStorage.setItem(favoritesKey, JSON.stringify(favorites));
}

function renderFavorites() {
  favoritesList.replaceChildren();
  favorites.forEach((subreddit) => {
    const chip = document.createElement("span");
    chip.className = "favorite";
    const select = document.createElement("button");
    select.type = "button";
    select.className = "favorite-main";
    select.textContent = `r/${subreddit}`;
    select.addEventListener("click", () => {
      fields.subreddit.value = subreddit;
      updateView();
      scheduleSave();
    });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "favorite-remove";
    remove.setAttribute("aria-label", `r/${subreddit} aus der Schnellwahl entfernen`);
    remove.textContent = "×";
    remove.addEventListener("click", () => {
      favorites = favorites.filter((item) => item !== subreddit);
      saveFavorites();
      renderFavorites();
    });
    chip.append(select, remove);
    favoritesList.append(chip);
  });
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
}

function showLoginResult() {
  const params = new URLSearchParams(location.search);
  if (params.has("connected")) showNotice("Reddit-Konto erfolgreich verbunden.");
  if (params.has("login_error")) showNotice("Die Reddit-Anmeldung wurde nicht abgeschlossen. Bitte versuche es erneut.", true);
  if (params.size) history.replaceState({}, "", location.pathname);
}

function showNotice(message, isError = false, link = "") {
  notice.replaceChildren(document.createTextNode(message));
  notice.classList.toggle("error", isError);
  notice.hidden = false;
  if (link) {
    const anchor = document.createElement("a");
    anchor.href = link;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    anchor.textContent = "Beitrag auf Reddit öffnen";
    anchor.style.color = "inherit";
    anchor.style.fontWeight = "800";
    notice.append(anchor);
  }
  notice.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function hideNotice() {
  notice.hidden = true;
}

function normalizeSubreddit(value) {
  return String(value || "").trim().replace(/^\/?r\//i, "");
}
