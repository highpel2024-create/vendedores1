

let token = localStorage.getItem("rve_online_token") || "";
let currentUser = null;
let currentProfile = null;
let profilesCache = [];
let favoriteIds = [];
let conversationsCache = [];
let activeConversationId = "";
let messagesCache = [];
let notificationsCache = [];
let unreadNotifications = 0;
let pendingProfilePhoto = "";
let pendingCoverPhoto = "";
let pendingGalleryPhotos = [];

function authHeaders() {
  return token ? { "Authorization": "Bearer " + token, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
}
function esc(text) {
  return String(text ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");
}
function stars(score) {
  const rounded = Math.round(Number(score) || 0);
  return "★".repeat(rounded) + "☆".repeat(5 - rounded);
}
function formatMoney(amount, currency = "ARS") {
  try {
    return new Intl.NumberFormat("es-AR", { style: "currency", currency }).format(Number(amount) || 0);
  } catch {
    return `${currency} ${Number(amount) || 0}`;
  }
}
function normalizePhone(phone) {
  return String(phone || "").replace(/[^\d]/g, "");
}
function getInitials(name) {
  return String(name || "?").trim().split(/\s+/).slice(0,2).map(x => x[0] || "").join("").toUpperCase() || "?";
}
function renderAvatar(photoUrl, name, extraClass = "") {
  if (photoUrl) return `<img src="${esc(photoUrl)}" alt="${esc(name || "Perfil")}" class="profile-photo-preview ${extraClass}">`;
  return `<div class="avatar-circle ${extraClass}">${esc(getInitials(name))}</div>`;
}
function setProfilePhotoPreview(photoUrl, name) {
  const img = document.getElementById("profilePhotoPreview");
  const fallback = document.getElementById("profilePhotoFallback");
  if (!img || !fallback) return;
  if (photoUrl) {
    img.src = photoUrl;
    img.classList.remove("hidden");
    fallback.classList.add("hidden");
  } else {
    img.removeAttribute("src");
    img.classList.add("hidden");
    fallback.textContent = getInitials(name);
    fallback.classList.remove("hidden");
  }
}
function setCoverPhotoPreview(photoUrl) {
  const img = document.getElementById("profileCoverPreview");
  const fallback = document.getElementById("profileCoverFallback");
  if (!img || !fallback) return;
  if (photoUrl) {
    img.src = photoUrl;
    img.classList.remove("hidden");
    fallback.classList.add("hidden");
  } else {
    img.removeAttribute("src");
    img.classList.add("hidden");
    fallback.classList.remove("hidden");
  }
}

const imageEditorState = {
  target: null,
  originalDataUrl: "",
  img: null,
  imgW: 0,
  imgH: 0,
  outputW: 0,
  outputH: 0,
  stageW: 0,
  stageH: 0,
  baseScale: 1,
  zoom: 1,
  x: 0,
  y: 0,
  dragging: false,
  startX: 0,
  startY: 0,
  startImgX: 0,
  startImgY: 0
};

async function fileToDataUrl(file) {
  const allowed = ["image/jpeg", "image/png", "image/webp", "image/jpg", "image/gif"];
  if (!allowed.includes(file.type)) throw new Error("Elegí una imagen JPG, PNG, WEBP o GIF");
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("No se pudo leer la imagen"));
    reader.readAsDataURL(file);
  });
}

async function loadImageElement(dataUrl) {
  return await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("No se pudo procesar la imagen"));
    i.src = dataUrl;
  });
}

function getEditorElements() {
  return {
    modal: document.getElementById("imageEditorModal"),
    stage: document.getElementById("imageEditorStage"),
    img: document.getElementById("imageEditorImg"),
    frame: document.getElementById("imageEditorFrame"),
    zoom: document.getElementById("imageEditorZoom"),
    title: document.getElementById("imageEditorTitle"),
    previewCanvas: document.getElementById("imageEditorPreviewCanvas")
  };
}

function normalizeEditorTarget(target) {
  if (typeof target === "string") {
    if (target === "cover") return { kind: "cover", outputW: 1400, outputH: 500, title: "Editar foto de portada", circle: false };
    if (target === "gallery") return { kind: "gallery", index: -1, outputW: 1200, outputH: 900, title: "Editar foto de galería", circle: false };
    return { kind: "profile", outputW: 700, outputH: 700, title: "Editar foto de perfil", circle: true };
  }
  return {
    kind: target?.kind || "profile",
    index: Number.isInteger(target?.index) ? target.index : -1,
    outputW: target?.outputW || 700,
    outputH: target?.outputH || 700,
    title: target?.title || "Editar imagen",
    circle: Boolean(target?.circle)
  };
}

async function openImageEditor(dataUrl, target) {
  const els = getEditorElements();
  const img = await loadImageElement(dataUrl);
  const normalizedTarget = normalizeEditorTarget(target);
  imageEditorState.target = normalizedTarget;
  imageEditorState.originalDataUrl = dataUrl;
  imageEditorState.img = img;
  imageEditorState.imgW = img.width;
  imageEditorState.imgH = img.height;
  imageEditorState.outputW = normalizedTarget.outputW;
  imageEditorState.outputH = normalizedTarget.outputH;
  els.title.textContent = normalizedTarget.title;
  els.frame.classList.toggle("circle", normalizedTarget.circle);
  els.modal.classList.remove("hidden");
  requestAnimationFrame(() => {
    setupImageEditor();
  });
}

function setupImageEditor() {
  const els = getEditorElements();
  const stageRect = els.stage.getBoundingClientRect();
  imageEditorState.stageW = Math.max(260, Math.round(stageRect.width));
  imageEditorState.stageH = Math.max(260, Math.round(stageRect.height));
  const ratio = imageEditorState.outputW / imageEditorState.outputH;
  let cropW = imageEditorState.stageW;
  let cropH = cropW / ratio;
  if (cropH > imageEditorState.stageH) {
    cropH = imageEditorState.stageH;
    cropW = cropH * ratio;
  }
  els.frame.style.width = cropW + "px";
  els.frame.style.height = cropH + "px";
  els.frame.style.left = Math.round((imageEditorState.stageW - cropW) / 2) + "px";
  els.frame.style.top = Math.round((imageEditorState.stageH - cropH) / 2) + "px";
  els.img.src = imageEditorState.originalDataUrl;
  const coverScale = Math.max(cropW / imageEditorState.imgW, cropH / imageEditorState.imgH);
  imageEditorState.baseScale = coverScale;
  imageEditorState.zoom = 1;
  if (els.zoom) {
    els.zoom.min = "1";
    els.zoom.max = "3.2";
    els.zoom.step = "0.01";
    els.zoom.value = "1";
  }
  centerImageEditor();
  bindImageEditorEvents();
  renderImageEditor();
}

function bindImageEditorEvents() {
  const els = getEditorElements();
  if (els.stage.dataset.bound === "1") return;
  const startDrag = (clientX, clientY) => {
    imageEditorState.dragging = true;
    imageEditorState.startX = clientX;
    imageEditorState.startY = clientY;
    imageEditorState.startImgX = imageEditorState.x;
    imageEditorState.startImgY = imageEditorState.y;
    els.stage.classList.add("dragging");
  };
  const moveDrag = (clientX, clientY) => {
    if (!imageEditorState.dragging) return;
    imageEditorState.x = imageEditorState.startImgX + (clientX - imageEditorState.startX);
    imageEditorState.y = imageEditorState.startImgY + (clientY - imageEditorState.startY);
    clampImageEditorPosition();
    renderImageEditor();
  };
  const endDrag = () => {
    imageEditorState.dragging = false;
    els.stage.classList.remove("dragging");
  };
  els.stage.addEventListener("mousedown", e => { e.preventDefault(); startDrag(e.clientX, e.clientY); });
  window.addEventListener("mousemove", e => moveDrag(e.clientX, e.clientY));
  window.addEventListener("mouseup", endDrag);
  els.stage.addEventListener("touchstart", e => {
    if (!e.touches?.length) return;
    const t = e.touches[0];
    startDrag(t.clientX, t.clientY);
  }, { passive: true });
  window.addEventListener("touchmove", e => {
    if (!imageEditorState.dragging || !e.touches?.length) return;
    const t = e.touches[0];
    moveDrag(t.clientX, t.clientY);
  }, { passive: true });
  window.addEventListener("touchend", endDrag);
  window.addEventListener("resize", () => {
    const modalVisible = !getEditorElements().modal.classList.contains("hidden");
    if (modalVisible) setupImageEditor();
  });
  els.stage.dataset.bound = "1";
}

function currentImageScale() {
  return imageEditorState.baseScale * imageEditorState.zoom;
}

function centerImageEditor() {
  const els = getEditorElements();
  const frameRect = els.frame.getBoundingClientRect();
  const stageRect = els.stage.getBoundingClientRect();
  const frameX = frameRect.left - stageRect.left;
  const frameY = frameRect.top - stageRect.top;
  const frameW = frameRect.width;
  const frameH = frameRect.height;
  const scale = currentImageScale();
  imageEditorState.x = frameX + (frameW - imageEditorState.imgW * scale) / 2;
  imageEditorState.y = frameY + (frameH - imageEditorState.imgH * scale) / 2;
  clampImageEditorPosition();
  renderImageEditor();
}

function resetImageEditor() {
  const els = getEditorElements();
  imageEditorState.zoom = 1;
  if (els.zoom) els.zoom.value = "1";
  centerImageEditor();
}

function updateEditorZoom(value) {
  const prevScale = currentImageScale();
  imageEditorState.zoom = Number(value || 1);
  const nextScale = currentImageScale();
  const els = getEditorElements();
  const frameRect = els.frame.getBoundingClientRect();
  const stageRect = els.stage.getBoundingClientRect();
  const centerX = (frameRect.left - stageRect.left) + frameRect.width / 2;
  const centerY = (frameRect.top - stageRect.top) + frameRect.height / 2;
  imageEditorState.x = centerX - ((centerX - imageEditorState.x) * (nextScale / prevScale));
  imageEditorState.y = centerY - ((centerY - imageEditorState.y) * (nextScale / prevScale));
  clampImageEditorPosition();
  renderImageEditor();
}

function clampImageEditorPosition() {
  const els = getEditorElements();
  const stage = els.stage.getBoundingClientRect();
  const frame = els.frame.getBoundingClientRect();
  const frameX = frame.left - stage.left;
  const frameY = frame.top - stage.top;
  const frameW = frame.width;
  const frameH = frame.height;
  const scale = currentImageScale();
  const imgW = imageEditorState.imgW * scale;
  const imgH = imageEditorState.imgH * scale;
  const minX = frameX + frameW - imgW;
  const maxX = frameX;
  const minY = frameY + frameH - imgH;
  const maxY = frameY;
  imageEditorState.x = Math.min(maxX, Math.max(minX, imageEditorState.x));
  imageEditorState.y = Math.min(maxY, Math.max(minY, imageEditorState.y));
}

function renderImageEditor() {
  const els = getEditorElements();
  const scale = currentImageScale();
  els.img.style.width = imageEditorState.imgW + "px";
  els.img.style.height = imageEditorState.imgH + "px";
  els.img.style.transform = `translate(${imageEditorState.x}px, ${imageEditorState.y}px) scale(${scale})`;
  renderImageEditorPreview();
}

function renderImageEditorPreview() {
  const els = getEditorElements();
  const canvas = els.previewCanvas;
  if (!canvas) return;
  const outW = imageEditorState.outputW;
  const outH = imageEditorState.outputH;
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, outW, outH);
  const stage = els.stage.getBoundingClientRect();
  const frame = els.frame.getBoundingClientRect();
  const frameX = frame.left - stage.left;
  const frameY = frame.top - stage.top;
  const scale = currentImageScale();
  const sx = (frameX - imageEditorState.x) / scale;
  const sy = (frameY - imageEditorState.y) / scale;
  const sw = frame.width / scale;
  const sh = frame.height / scale;
  ctx.drawImage(imageEditorState.img, sx, sy, sw, sh, 0, 0, outW, outH);
}

function exportEditedImage() {
  const els = getEditorElements();
  const canvas = els.previewCanvas;
  let out = canvas.toDataURL("image/jpeg", 0.88);
  if (out.length > 1800000) out = canvas.toDataURL("image/jpeg", 0.76);
  if (out.length > 2800000) throw new Error("La imagen sigue siendo muy pesada. Probá con una foto más liviana.");
  return out;
}

function applyImageEditor() {
  try {
    const out = exportEditedImage();
    const target = imageEditorState.target || { kind: "profile" };
    if (target.kind === "cover") {
      pendingCoverPhoto = out;
      setCoverPhotoPreview(out);
      const input = document.getElementById("profileCoverInput");
      if (input) input.value = "";
    } else if (target.kind === "gallery") {
      if (Number.isInteger(target.index) && target.index >= 0 && target.index < pendingGalleryPhotos.length) pendingGalleryPhotos[target.index] = out;
      else {
        if (pendingGalleryPhotos.length >= 6) throw new Error("La galería permite hasta 6 fotos");
        pendingGalleryPhotos.push(out);
      }
      const input = document.getElementById("galleryPhotoInput");
      if (input) input.value = "";
      renderGalleryEditor();
    } else {
      pendingProfilePhoto = out;
      setProfilePhotoPreview(out, document.getElementById("profileName")?.value || currentProfile?.name || currentUser?.name || "?");
      const input = document.getElementById("profilePhotoInput");
      if (input) input.value = "";
    }
    closeImageEditor();
  } catch (e) {
    alert(e.message);
  }
}

function closeImageEditor() {
  const els = getEditorElements();
  els.modal.classList.add("hidden");
}

async function handleProfilePhotoChange(event) {
  const file = event?.target?.files?.[0];
  if (!file) return;
  try {
    const dataUrl = await fileToDataUrl(file);
    await openImageEditor(dataUrl, "profile");
  } catch (e) {
    alert(e.message);
    event.target.value = "";
  }
}

async function handleCoverPhotoChange(event) {
  const file = event?.target?.files?.[0];
  if (!file) return;
  try {
    const dataUrl = await fileToDataUrl(file);
    await openImageEditor(dataUrl, "cover");
  } catch (e) {
    alert(e.message);
    event.target.value = "";
  }
}

async function handleGalleryPhotoChange(event) {
  const file = event?.target?.files?.[0];
  if (!file) return;
  if (pendingGalleryPhotos.length >= 6) {
    alert("La galería permite hasta 6 fotos.");
    event.target.value = "";
    return;
  }
  try {
    const dataUrl = await fileToDataUrl(file);
    await openImageEditor(dataUrl, { kind: "gallery", index: -1, outputW: 1200, outputH: 900, title: "Editar foto de galería", circle: false });
  } catch (e) {
    alert(e.message);
    event.target.value = "";
  }
}

function renderGalleryEditor() {
  const box = document.getElementById("galleryList");
  if (!box) return;
  if (!pendingGalleryPhotos.length) {
    box.className = "gallery-empty";
    box.innerHTML = "Todavía no cargaste fotos en la galería.";
    return;
  }
  box.className = "gallery-grid";
  box.innerHTML = pendingGalleryPhotos.map((img, idx) => `
    <div class="gallery-item">
      <img src="${esc(img)}" alt="Trabajo ${idx + 1}">
      <div class="gallery-item-actions">
        <button class="btn" type="button" onclick="editGalleryPhoto(${idx})">Recortar / centrar</button>
        <button class="btn" type="button" onclick="moveGalleryPhoto(${idx}, -1)">←</button>
        <button class="btn" type="button" onclick="moveGalleryPhoto(${idx}, 1)">→</button>
        <button class="btn btn-danger" type="button" onclick="removeGalleryPhoto(${idx})">Quitar</button>
      </div>
    </div>
  `).join("");
}

function removeGalleryPhoto(index) {
  pendingGalleryPhotos.splice(index, 1);
  renderGalleryEditor();
}

function clearGalleryPhotos() {
  pendingGalleryPhotos = [];
  const input = document.getElementById("galleryPhotoInput");
  if (input) input.value = "";
  renderGalleryEditor();
}

function moveGalleryPhoto(index, direction) {
  const next = index + direction;
  if (next < 0 || next >= pendingGalleryPhotos.length) return;
  const tmp = pendingGalleryPhotos[index];
  pendingGalleryPhotos[index] = pendingGalleryPhotos[next];
  pendingGalleryPhotos[next] = tmp;
  renderGalleryEditor();
}

async function editGalleryPhoto(index) {
  const current = pendingGalleryPhotos[index];
  if (!current) return;
  try {
    await openImageEditor(current, { kind: "gallery", index, outputW: 1200, outputH: 900, title: "Reencuadrar foto de galería", circle: false });
  } catch (e) {
    alert(e.message);
  }
}

function clearProfilePhoto() {
  pendingProfilePhoto = "";
  const input = document.getElementById("profilePhotoInput");
  if (input) input.value = "";
  setProfilePhotoPreview("", document.getElementById("profileName")?.value || currentProfile?.name || currentUser?.name || "?");
}
function clearCoverPhoto() {
  pendingCoverPhoto = "";
  const input = document.getElementById("profileCoverInput");
  if (input) input.value = "";
  setCoverPhotoPreview("");
}
function showGuest(){ document.getElementById("guestView").classList.remove("hidden"); document.getElementById("appView").classList.add("hidden"); }
function showApp(){ document.getElementById("guestView").classList.add("hidden"); document.getElementById("appView").classList.remove("hidden"); }

async function api(url, options = {}) {
  const res = await fetch(url, options);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Error");
  return data;
}

async function registerUser() {
  try {
    await api("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: document.getElementById("registerName").value.trim(),
        email: document.getElementById("registerEmail").value.trim(),
        password: document.getElementById("registerPassword").value,
        role: document.getElementById("registerRole").value
      })
    });
    alert("Cuenta creada. Ahora iniciá sesión.");
  } catch (e) { alert(e.message); }
}

async function login() {
  try {
    const data = await api("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: document.getElementById("loginEmail").value.trim(),
        password: document.getElementById("loginPassword").value
      })
    });
    token = data.token;
    localStorage.setItem("rve_online_token", token);
    await loadMe();
  } catch (e) { alert(e.message); }
}

function logout() {
  token = "";
  currentUser = null;
  currentProfile = null;
  favoriteIds = [];
  conversationsCache = [];
  activeConversationId = "";
  messagesCache = [];
  localStorage.removeItem("rve_online_token");
  showGuest();
}

async function loadMe() {
  try {
    const data = await api("/api/me", { headers: authHeaders() });
    currentUser = data.user;
    currentProfile = data.profile;
    document.getElementById("welcomeText").textContent = "Bienvenido, " + currentUser.name;
    document.getElementById("roleText").textContent = "Rol: " + currentUser.role;
    document.getElementById("adminTabBtn").classList.toggle("hidden", currentUser.role !== "admin");
    document.getElementById("favoritesTabBtn").classList.toggle("hidden", !token);
    document.getElementById("messagesTabBtn").classList.toggle("hidden", !token);
    document.getElementById("notificationsTabBtn").classList.toggle("hidden", !token);
    fillMyProfile();
    showApp();
    updateNotificationsBadge(data.notifications?.unreadCount || 0);
    await loadProfiles();
    await loadConversations();
    await loadNotifications();
    if (currentUser.role === "admin") await loadAdmin();
  } catch { logout(); }
}

function fillMyProfile() {
  document.getElementById("profileName").value = currentProfile?.name || "";
  document.getElementById("profileCity").value = currentProfile?.city || "";
  document.getElementById("profileProvince").value = currentProfile?.province || "";
  document.getElementById("profileZone").value = currentProfile?.zone || "";
  document.getElementById("profileWorkAreas").value = currentProfile?.workAreas || "";
  document.getElementById("profileIndustry").value = currentProfile?.industry || "";
  document.getElementById("profileExperienceYears").value = currentProfile?.experienceYears || "";
  document.getElementById("profilePhone").value = currentProfile?.phone || "";
  document.getElementById("profileWebsite").value = currentProfile?.website || "";
  document.getElementById("profilePlan").value = currentProfile?.plan || "free";
  document.getElementById("profileTags").value = (currentProfile?.tags || []).join(", ");
  document.getElementById("profileServices").value = (currentProfile?.services || []).join(", ");
  document.getElementById("profileWorkSchedule").value = currentProfile?.workSchedule || "";
  document.getElementById("profileDescription").value = currentProfile?.description || "";
  pendingProfilePhoto = currentProfile?.photoUrl || "";
  pendingCoverPhoto = currentProfile?.coverUrl || "";
  pendingGalleryPhotos = Array.isArray(currentProfile?.galleryUrls) ? [...currentProfile.galleryUrls] : [];
  const input = document.getElementById("profilePhotoInput");
  if (input) input.value = "";
  const coverInput = document.getElementById("profileCoverInput");
  if (coverInput) coverInput.value = "";
  setProfilePhotoPreview(pendingProfilePhoto, currentProfile?.name || currentUser?.name || "?");
  setCoverPhotoPreview(pendingCoverPhoto);
  renderGalleryEditor();
}

async function saveMyProfile() {
  try {
    const data = await api("/api/profiles", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        name: document.getElementById("profileName").value.trim(),
        city: document.getElementById("profileCity").value.trim(),
        province: document.getElementById("profileProvince").value.trim(),
        zone: document.getElementById("profileZone").value.trim(),
        workAreas: document.getElementById("profileWorkAreas").value.trim(),
        industry: document.getElementById("profileIndustry").value.trim(),
        experienceYears: document.getElementById("profileExperienceYears").value.trim(),
        phone: document.getElementById("profilePhone").value.trim(),
        website: document.getElementById("profileWebsite").value.trim(),
        plan: document.getElementById("profilePlan").value,
        tags: document.getElementById("profileTags").value.split(",").map(x => x.trim()).filter(Boolean),
        services: document.getElementById("profileServices").value.split(",").map(x => x.trim()).filter(Boolean),
        workSchedule: document.getElementById("profileWorkSchedule").value.trim(),
        description: document.getElementById("profileDescription").value.trim(),
        photoUrl: pendingProfilePhoto,
        coverUrl: pendingCoverPhoto,
        galleryUrls: pendingGalleryPhotos
      })
    });
    currentProfile = data.profile;
    fillMyProfile();
    alert("Perfil guardado.");
    await loadProfiles();
    await loadNotifications();
  } catch (e) { alert(e.message); }
}

async function buyPremium() {
  try {
    const data = await api("/api/payments/create-preference", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ plan: "premium" })
    });
    const target = data.initPoint || data.sandboxInitPoint;
    if (!target) throw new Error("No se recibió URL de pago");
    window.location.href = target;
  } catch (e) {
    alert(e.message);
  }
}

async function mockUpgrade() {
  try {
    const data = await api("/api/payments/mock-upgrade", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({})
    });
    currentProfile = data.profile;
    fillMyProfile();
    alert("Premium activado en modo demo.");
    await loadProfiles();
  } catch (e) { alert(e.message); }
}

async function loadProfiles() {
  try {
    const q = encodeURIComponent(document.getElementById("searchQ")?.value || "");
    const role = encodeURIComponent(document.getElementById("searchRole")?.value || "todos");
    const verified = encodeURIComponent(document.getElementById("searchVerified")?.value || "todos");
    const plan = encodeURIComponent(document.getElementById("searchPlan")?.value || "todos");
    const province = encodeURIComponent(document.getElementById("searchProvince")?.value || "todos");
    const zone = encodeURIComponent(document.getElementById("searchZone")?.value || "todos");
    const sort = encodeURIComponent(document.getElementById("searchSort")?.value || "destacados");
    const viewerUserId = encodeURIComponent(currentUser?.id || "");
    const data = await api(`/api/profiles?q=${q}&role=${role}&verified=${verified}&plan=${plan}&province=${province}&zone=${zone}&sort=${sort}&viewerUserId=${viewerUserId}`);
    profilesCache = data.profiles;
    renderProfiles();
    renderHome();
    renderFavorites();
  } catch (e) { console.error(e); }
}

function clearSearchFilters() {
  const ids = {
    searchQ: "",
    searchRole: "todos",
    searchProvince: "todos",
    searchZone: "todos",
    searchVerified: "todos",
    searchPlan: "todos",
    searchSort: "destacados"
  };
  Object.entries(ids).forEach(([id, value]) => {
    const el = document.getElementById(id);
    if (el) el.value = value;
  });
  loadProfiles();
}

function metricCard(value, label) {
  return `<div class="card metric"><div class="value">${value}</div><div class="label">${label}</div></div>`;
}

function formatLocation(p) {
  const parts = [p?.city || "", p?.province || ""].map(x => String(x || "").trim()).filter(Boolean);
  return esc(parts.length ? parts.join(", ") : "Sin ubicación");
}

function renderHome() {
  const sellers = profilesCache.filter(p => p.type === "vendedor").length;
  const companies = profilesCache.filter(p => p.type === "empresa").length;
  const premium = profilesCache.filter(p => p.plan === "premium").length;
  const verified = profilesCache.filter(p => p.verified === "si").length;
  document.getElementById("metrics").innerHTML = [
    metricCard(profilesCache.length, "Perfiles"),
    metricCard(sellers, "Vendedores"),
    metricCard(companies, "Empresas"),
    metricCard(premium, "Premium"),
    metricCard(verified, "Verificados"),
    metricCard(favoriteIds.length, "Guardados")
  ].join("");

  document.getElementById("latestProfiles").innerHTML = profilesCache.slice(0, 6).map(p => `
    <div class="item">
      ${p.coverUrl ? `<img src="${esc(p.coverUrl)}" alt="Portada de ${esc(p.name)}" class="profile-cover-card">` : `<div class="profile-cover-card profile-cover-placeholder">PORTADA</div>`}
      ${(Array.isArray(p.galleryUrls) && p.galleryUrls.length) ? `<div class="work-gallery">${p.galleryUrls.slice(0,3).map(img => `<img src="${esc(img)}" alt="Trabajo de ${esc(p.name)}">`).join("")}</div>` : ``}
      <div class="item-top" style="margin-top:12px">
        <div style="display:flex;gap:12px;align-items:center">
          ${renderAvatar(p.photoUrl, p.name, 'avatar-sm')}
          <div>
            <strong>${esc(p.name)}</strong>
            <div class="small muted">${formatLocation(p)} · ${esc(p.industry || "Sin rubro")}</div>
          </div>
        </div>
        <div class="row">
          <span class="badge ${p.type === "vendedor" ? "type-vendedor" : "type-empresa"}">${esc(p.type)}</span>
          <span class="badge premium">${esc(p.plan)}</span>
          ${p.verified === "si" ? `<span class="badge verified">verificado</span>` : ``}
        </div>
      </div>
    </div>
  `).join("") || `<div class="small muted">No hay perfiles todavía.</div>`;
}

function renderProfiles() {
  const box = document.getElementById("profilesList");
  if (!profilesCache.length) {
    box.innerHTML = `<div class="card">No hay perfiles.</div>`;
    return;
  }

  box.innerHTML = profilesCache.map(p => `
    <div class="item">
      <div class="profile-card-cover-wrap">
        ${p.coverUrl ? `<img src="${esc(p.coverUrl)}" alt="Portada de ${esc(p.name)}" class="profile-cover-card">` : `<div class="profile-cover-card profile-cover-placeholder">SIN PORTADA</div>`}
        <div class="avatar-floating">${renderAvatar(p.photoUrl, p.name, 'avatar-sm')}</div>
      </div>
      <div class="item-top profile-card-header-with-cover">
        <div style="display:flex;gap:12px;align-items:center">
          <div style="width:62px"></div>
          <div>
            <h3 style="margin:0 0 6px 0">${esc(p.name)}</h3>
            <div class="row">
            <span class="badge ${p.type === "vendedor" ? "type-vendedor" : "type-empresa"}">${esc(p.type)}</span>
            <span class="badge premium">${esc(p.plan)}</span>
            ${p.verified === "si" ? `<span class="badge verified">verificado</span>` : ``}
            <span class="pill">${formatLocation(p)}</span>
            <span class="pill">${esc(p.industry || "Sin rubro")}</span>
            </div>
          </div>
        </div>
        <div>${stars(p.stats.avg)} <span class="small muted">${p.stats.avg ? p.stats.avg.toFixed(1) : "Sin notas"} · ${p.stats.count}</span></div>
      </div>
      <div style="height:8px"></div>
      <div>${esc(p.description || "Sin descripción")}</div>
      ${(Array.isArray(p.galleryUrls) && p.galleryUrls.length) ? `<div class="work-gallery">${p.galleryUrls.slice(0,6).map(img => `<img src="${esc(img)}" alt="Trabajo de ${esc(p.name)}">`).join("")}</div>` : ``}
      <div style="height:8px"></div>
      <div class="small muted">Ubicación: ${formatLocation(p)}${p.zone ? ` · Zona ${esc(p.zone)}` : ""}</div>
      <div class="small muted">Contacto: ${esc(p.email || "")} ${p.phone ? `· ${esc(p.phone)}` : ""}</div>
      <div class="row" style="margin-top:10px">
        ${p.phone ? `<a class="btn" href="https://wa.me/${normalizePhone(p.phone)}" target="_blank" rel="noopener noreferrer">WhatsApp</a>` : ""}
        ${p.email ? `<a class="btn" href="mailto:${encodeURIComponent(p.email)}">Email</a>` : ""}
        ${token && currentProfile && currentProfile.id !== p.id ? `<button class="btn btn-violet" onclick="startConversation('${p.id}')">Chatear</button>` : ""}
        ${token && currentProfile && currentProfile.id !== p.id ? `<button class="btn btn-secondary" onclick="reviewProfile('${p.id}')">Calificar</button>` : ""}
        ${token && currentProfile && currentProfile.id !== p.id ? `<button class="btn ${p.isFavorite ? 'active-filter' : ''}" onclick="toggleFavorite('${p.id}')"><span class="heart">${p.isFavorite ? '♥' : '♡'}</span> Guardar</button>` : ""}
        ${token ? `<button class="btn" onclick="reportProfile('${p.id}')">Denunciar</button>` : ""}
      </div>
      <div id="reviews-${p.id}" style="margin-top:10px"></div>
    </div>
  `).join("");

  profilesCache.forEach(loadReviewsForProfile);
}

async function loadReviewsForProfile(profileId) {
  try {
    const data = await api("/api/reviews/" + profileId);
    const box = document.getElementById("reviews-" + profileId);
    if (!box) return;
    box.innerHTML = data.reviews.slice(0, 3).map(r => `
      <div class="review">
        <strong>${esc(r.authorName)}</strong> · ${stars(r.score)}
        <div>${esc(r.comment)}</div>
      </div>
    `).join("") || `<div class="small muted">Todavía no tiene reseñas.</div>`;
  } catch {}
}

async function reviewProfile(profileId) {
  const score = prompt("Puntaje del 1 al 5", "5");
  const comment = prompt("Comentario", "Muy buen perfil");
  if (!score || !comment) return;
  try {
    await api("/api/reviews", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ targetProfileId: profileId, score: Number(score), comment })
    });
    alert("Reseña guardada.");
    await loadProfiles();
    if (currentUser?.role === "admin") await loadAdmin();
  } catch (e) { alert(e.message); }
}

async function reportProfile(profileId) {
  const reason = prompt("Motivo de la denuncia", "Datos sospechosos");
  if (!reason) return;
  try {
    await api("/api/reports", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ profileId, reason })
    });
    alert("Denuncia registrada.");
    if (currentUser?.role === "admin") await loadAdmin();
  } catch (e) { alert(e.message); }
}

async function loadFavorites(renderOnly = false) {
  if (!token) {
    favoriteIds = [];
    renderFavorites();
    return;
  }
  try {
    const data = await api("/api/favorites", { headers: authHeaders() });
    favoriteIds = data.favorites || [];
    renderFavorites();
  } catch (e) {
    console.error(e);
  }
}

function renderFavorites() {
  const box = document.getElementById("favoritesList");
  if (!box) return;
  const items = profilesCache.filter(p => favoriteIds.includes(p.id));
  if (!items.length) {
    box.className = "empty";
    box.innerHTML = "Todavía no guardaste perfiles.";
    return;
  }
  box.className = "";
  box.innerHTML = items.map(p => `
    <div class="review">
      ${p.coverUrl ? `<img src="${esc(p.coverUrl)}" alt="Portada de ${esc(p.name)}" class="profile-cover-card" style="height:120px;margin-bottom:10px">` : ``}
      <div style="display:flex;gap:12px;align-items:center">
        ${renderAvatar(p.photoUrl, p.name, 'avatar-sm')}
        <div>
          <strong>${esc(p.name)}</strong>
          <div class="small muted">${formatLocation(p)} · ${esc(p.industry || "Sin rubro")} · ${esc(p.plan)}${p.experienceYears ? ` · ${esc(p.experienceYears)}` : ""}</div>
          ${p.workAreas ? `<div class="small muted">Zona de trabajo: ${esc(p.workAreas)}</div>` : ``}
        </div>
      </div>
      <div style="margin-top:8px">${esc(p.description || "Sin descripción")}</div>
      ${(Array.isArray(p.galleryUrls) && p.galleryUrls.length) ? `<div class="work-gallery">${p.galleryUrls.slice(0,3).map(img => `<img src="${esc(img)}" alt="Trabajo de ${esc(p.name)}">`).join("")}</div>` : ``}
      <div class="row" style="margin-top:10px">
        ${p.phone ? `<a class="btn" href="https://wa.me/${normalizePhone(p.phone)}" target="_blank" rel="noopener noreferrer">WhatsApp</a>` : ""}
        ${p.email ? `<a class="btn" href="mailto:${encodeURIComponent(p.email)}">Email</a>` : ""}
        <button class="btn btn-violet" onclick="startConversation('${p.id}')">Chatear</button>
        <button class="btn btn-danger" onclick="toggleFavorite('${p.id}')">Quitar</button>
      </div>
    </div>
  `).join("");
}

async function toggleFavorite(profileId) {
  if (!token) return alert("Primero iniciá sesión.");
  try {
    const isFav = favoriteIds.includes(profileId);
    await api(isFav ? ("/api/favorites/" + profileId) : "/api/favorites", {
      method: isFav ? "DELETE" : "POST",
      headers: authHeaders(),
      body: isFav ? undefined : JSON.stringify({ profileId })
    });
    await loadFavorites(true);
    await loadProfiles();
    await loadNotifications();
  } catch (e) {
    alert(e.message);
  }
}


function updateNotificationsBadge(count) {
  unreadNotifications = Number(count) || 0;
  const badge = document.getElementById("notificationsBadge");
  if (!badge) return;
  badge.textContent = unreadNotifications > 99 ? '99+' : String(unreadNotifications);
  badge.classList.toggle('hidden', unreadNotifications <= 0);
}

async function loadNotifications() {
  if (!token) return;
  try {
    const data = await api('/api/notifications', { headers: authHeaders() });
    notificationsCache = data.notifications || [];
    updateNotificationsBadge(data.unreadCount || 0);
    const box = document.getElementById('notificationsList');
    if (!notificationsCache.length) {
      box.className = 'empty';
      box.innerHTML = 'Todavía no tenés notificaciones.';
      return;
    }
    box.className = 'notifications-list';
    box.innerHTML = notificationsCache.map(n => `
      <div class="notification-item ${!n.readAt ? 'unread' : ''}">
        <div class="notification-top">
          <div>
            <strong>${esc(n.title)}</strong>
            <div class="small muted">${new Date(n.createdAt).toLocaleString('es-AR')}</div>
          </div>
          ${!n.readAt ? '<span class="unread-dot">Nuevo</span>' : ''}
        </div>
        <div style="height:8px"></div>
        <div>${esc(n.body || '')}</div>
        <div class="notification-actions">
          ${!n.readAt ? `<button class="btn" onclick="markNotificationRead('${n.id}')">Marcar leída</button>` : ''}
          ${n.link ? `<button class="btn btn-primary" onclick="openNotificationLink('${esc(n.id)}','${esc(n.link)}')">Abrir</button>` : ''}
        </div>
      </div>
    `).join('');
  } catch (e) { console.error(e); }
}

async function markNotificationRead(id, reload = true) {
  try {
    await api('/api/notifications/' + id + '/read', { method: 'POST', headers: authHeaders(), body: JSON.stringify({}) });
    if (reload) await loadNotifications();
  } catch (e) { alert(e.message); }
}

async function markAllNotificationsRead() {
  try {
    await api('/api/notifications/read-all', { method: 'POST', headers: authHeaders(), body: JSON.stringify({}) });
    await loadNotifications();
  } catch (e) { alert(e.message); }
}

async function openNotificationLink(id, link) {
  if (id) await markNotificationRead(id, false);
  if (!link) return loadNotifications();
  if (String(link).startsWith('mensajes:')) {
    const conversationId = String(link).split(':').slice(1).join(':');
    activateTab('mensajes');
    await loadConversations(conversationId);
    return;
  }
  if (link === 'favoritos') { activateTab('favoritos'); await loadFavorites(true); return; }
  if (link === 'miPerfil') { activateTab('miPerfil'); await loadMe(); return; }
  if (link === 'explorar') { activateTab('explorar'); await loadProfiles(); return; }
  await loadNotifications();
}

async function loadConversations(preferredId = '') {
  if (!token) {
    conversationsCache = [];
    renderConversations();
    return;
  }
  try {
    const data = await api('/api/conversations', { headers: authHeaders() });
    conversationsCache = data.conversations || [];
    if (preferredId) activeConversationId = preferredId;
    if (!activeConversationId && conversationsCache.length) activeConversationId = conversationsCache[0].id;
    if (activeConversationId && !conversationsCache.some(c => c.id === activeConversationId)) activeConversationId = conversationsCache[0]?.id || '';
    renderConversations();
    if (activeConversationId) await openConversation(activeConversationId, false);
    else clearConversationPanel();
  } catch (e) { console.error(e); }
}

function renderConversations() {
  const box = document.getElementById('conversationsList');
  if (!box) return;
  if (!conversationsCache.length) {
    box.className = 'empty';
    box.innerHTML = 'Todavía no tenés conversaciones.';
    return;
  }
  box.className = '';
  box.innerHTML = conversationsCache.map(c => `
    <div class="chat-list-item ${c.id === activeConversationId ? 'active' : ''}" onclick="openConversation('${c.id}')">
      <div class="item-top">
        <div>
          <strong>${esc(c.otherProfileName || c.otherUserName)}</strong>
          <div class="small muted">${esc(c.otherProfileType || 'usuario')} ${c.otherProfileCity ? '· ' + esc(c.otherProfileCity) : ''}</div>
        </div>
        ${c.unreadCount ? `<span class="unread-dot">${c.unreadCount}</span>` : ''}
      </div>
      <div class="small muted" style="margin-top:8px">${esc((c.lastMessage || 'Sin mensajes todavía').slice(0, 80))}</div>
    </div>
  `).join('');
}

function clearConversationPanel() {
  document.getElementById('chatHeader').className = 'empty';
  document.getElementById('chatHeader').innerHTML = 'Elegí una conversación o iniciá una desde un perfil.';
  document.getElementById('chatMessages').classList.add('hidden');
  document.getElementById('chatMessages').innerHTML = '';
  document.getElementById('chatComposer').classList.add('hidden');
  document.getElementById('messageInput').value = '';
}

async function startConversation(profileId) {
  if (!token) return alert('Primero iniciá sesión.');
  try {
    const data = await api('/api/conversations/start', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ profileId })
    });
    activateTab('mensajes');
    await loadConversations(data.conversationId);
  } catch (e) { alert(e.message); }
}

async function openConversation(conversationId, reloadList = true) {
  activeConversationId = conversationId;
  renderConversations();
  try {
    const current = conversationsCache.find(c => c.id === conversationId);
    if (current) {
      document.getElementById('chatHeader').className = '';
      document.getElementById('chatHeader').innerHTML = `
        <div class="section-title">
          <div>
            <h3 style="margin:0">${esc(current.otherProfileName || current.otherUserName)}</h3>
            <div class="small muted">${esc(current.otherProfileType || 'usuario')} ${current.otherProfileIndustry ? '· ' + esc(current.otherProfileIndustry) : ''} ${current.otherProfileCity ? '· ' + esc(current.otherProfileCity) : ''}</div>
          </div>
          <div class="row">
            ${current.otherUserEmail ? `<a class="btn" href="mailto:${encodeURIComponent(current.otherUserEmail)}">Email</a>` : ''}
          </div>
        </div>`;
    }
    const data = await api('/api/conversations/' + conversationId + '/messages', { headers: authHeaders() });
    messagesCache = data.messages || [];
    renderMessages();
    document.getElementById('chatMessages').classList.remove('hidden');
    document.getElementById('chatComposer').classList.remove('hidden');
    if (reloadList) await loadConversations(conversationId);
  } catch (e) { console.error(e); }
}

function renderMessages() {
  const box = document.getElementById('chatMessages');
  if (!box) return;
  if (!messagesCache.length) {
    box.innerHTML = `<div class="small muted">Todavía no hay mensajes. Escribí el primero.</div>`;
    return;
  }
  box.innerHTML = messagesCache.map(m => `
    <div class="bubble ${m.senderUserId === currentUser?.id ? 'me' : 'other'}">
      <div class="small muted">${esc(m.senderName)} · ${new Date(m.createdAt).toLocaleString('es-AR')}</div>
      <div style="margin-top:6px;white-space:pre-wrap">${esc(m.body)}</div>
    </div>
  `).join('');
  box.scrollTop = box.scrollHeight;
}

async function sendMessage() {
  const body = document.getElementById('messageInput').value.trim();
  if (!activeConversationId) return alert('Primero elegí una conversación.');
  if (!body) return;
  try {
    await api('/api/conversations/' + activeConversationId + '/messages', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ body })
    });
    document.getElementById('messageInput').value = '';
    await openConversation(activeConversationId, false);
    await loadConversations(activeConversationId);
  } catch (e) { alert(e.message); }
}

function activateTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));
  document.getElementById('tab-' + tab).classList.remove('hidden');
  if (tab === 'admin' && currentUser?.role === 'admin') loadAdmin();
  if (tab === 'mensajes' && token) loadConversations(activeConversationId);
  if (tab === 'notificaciones' && token) loadNotifications();
}

async function loadAdmin() {
  try {
    const stats = await api("/api/admin/stats", { headers: authHeaders() });
    document.getElementById("adminStats").innerHTML = [
      metricCard(stats.stats.users, "Usuarios"),
      metricCard(stats.stats.profiles, "Perfiles"),
      metricCard(stats.stats.premium, "Premium"),
      metricCard(stats.stats.verified, "Verificados"),
      metricCard(stats.stats.reviews, "Reseñas"),
      metricCard(stats.stats.reports, "Denuncias"),
      metricCard(stats.stats.payments, "Pagos")
    ].join("");

    const users = await api("/api/admin/users", { headers: authHeaders() });
    document.getElementById("adminUsers").innerHTML = users.users.map(u => `
      <div class="review">
        <strong>${esc(u.name)}</strong>
        <div>${esc(u.email)} · ${esc(u.role)}</div>
        <div class="small muted">${esc(u.profileName || "Sin perfil")} ${u.plan ? "· " + esc(u.plan) : ""} ${u.verified ? "· " + esc(u.verified) : ""}</div>
        ${u.role !== "admin" ? `<button class="btn btn-danger" onclick="deleteUser('${u.id}')">Borrar usuario</button>` : ``}
      </div>
    `).join("") || `<div class="small muted">No hay usuarios.</div>`;

    const profiles = await api("/api/admin/profiles", { headers: authHeaders() });
    document.getElementById("adminProfiles").innerHTML = profiles.profiles.map(p => `
      <div class="review">
        <strong>${esc(p.name)}</strong>
        <div>${esc(p.type)} · ${esc(p.plan)} · ${esc(p.verified)}</div>
        <div class="row" style="margin-top:8px">
          <button class="btn" onclick="setVerified('${p.id}','si')">Verificar</button>
          <button class="btn" onclick="setVerified('${p.id}','no')">Quitar verificación</button>
          <button class="btn btn-violet" onclick="setPlan('${p.id}','premium')">Premium</button>
          <button class="btn" onclick="setPlan('${p.id}','free')">Free</button>
        </div>
      </div>
    `).join("") || `<div class="small muted">No hay perfiles.</div>`;

    const reviews = await api("/api/admin/reviews", { headers: authHeaders() });
    document.getElementById("adminReviews").innerHTML = reviews.reviews.map(r => `
      <div class="review">
        <strong>${esc(r.profileName)}</strong>
        <div>Autor: ${esc(r.authorName)} · ${stars(r.score)}</div>
        <div>${esc(r.comment)}</div>
        <button class="btn btn-danger" onclick="deleteReview('${r.id}')">Borrar reseña</button>
      </div>
    `).join("") || `<div class="small muted">No hay reseñas.</div>`;

    const reports = await api("/api/admin/reports", { headers: authHeaders() });
    document.getElementById("adminReports").innerHTML = reports.reports.map(r => `
      <div class="review">
        <strong>${esc(r.profileName)}</strong>
        <div>Reportó: ${esc(r.reporterName)}</div>
        <div>Motivo: ${esc(r.reason)}</div>
        <div class="small muted">Estado: ${esc(r.status)}</div>
        ${r.status !== "resuelta" ? `<button class="btn" onclick="resolveReport('${r.id}')">Marcar resuelta</button>` : ""}
      </div>
    `).join("") || `<div class="small muted">No hay denuncias.</div>`;

    const payments = await api("/api/admin/payments", { headers: authHeaders() });
    document.getElementById("adminPayments").innerHTML = payments.payments.map(p => `
      <div class="review">
        <strong>${esc(p.profileName)}</strong>
        <div>${esc(p.userName)} · ${esc(p.userEmail)}</div>
        <div>${esc(p.plan)} · ${formatMoney(p.amount, p.currency)} · ${esc(p.status)}</div>
        <div class="small muted">Proveedor: ${esc(p.provider)} · ${new Date(p.createdAt).toLocaleString("es-AR")}</div>
      </div>
    `).join("") || `<div class="small muted">No hay pagos todavía.</div>`;
  } catch (e) { console.error(e); }
}

async function setVerified(profileId, verified) {
  try {
    await api("/api/admin/profiles/" + profileId, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({ verified })
    });
    await loadProfiles();
    await loadAdmin();
  } catch (e) { alert(e.message); }
}

async function setPlan(profileId, plan) {
  try {
    await api("/api/admin/profiles/" + profileId, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({ plan })
    });
    await loadProfiles();
    await loadAdmin();
  } catch (e) { alert(e.message); }
}

async function deleteReview(id) {
  if (!confirm("¿Borrar esta reseña?")) return;
  try {
    await api("/api/admin/reviews/" + id, {
      method: "DELETE",
      headers: authHeaders()
    });
    await loadProfiles();
    await loadAdmin();
  } catch (e) { alert(e.message); }
}

async function resolveReport(id) {
  try {
    await api("/api/admin/reports/" + id + "/resolve", {
      method: "PATCH",
      headers: authHeaders()
    });
    await loadAdmin();
  } catch (e) { alert(e.message); }
}

async function deleteUser(id) {
  if (!confirm("¿Borrar este usuario y todo su contenido?")) return;
  try {
    await api("/api/admin/users/" + id, {
      method: "DELETE",
      headers: authHeaders()
    });
    await loadProfiles();
    await loadAdmin();
  } catch (e) { alert(e.message); }
}

function bindTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => activateTab(btn.dataset.tab));
  });
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && document.activeElement === document.getElementById("messageInput")) {
    e.preventDefault();
    sendMessage();
  }
});

bindTabs();
if (token) loadMe();
