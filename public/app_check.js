
let token = localStorage.getItem("rve_online_token") || "";
let currentUser = null;
let currentProfile = null;
let profilesCache = [];
let favoriteIds = [];
let conversationsCache = [];
let activeConversationId = "";
let messagesCache = [];

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
    fillMyProfile();
    showApp();
    await loadProfiles();
    await loadConversations();
    if (currentUser.role === "admin") await loadAdmin();
  } catch { logout(); }
}

function fillMyProfile() {
  document.getElementById("profileName").value = currentProfile?.name || "";
  document.getElementById("profileCity").value = currentProfile?.city || "";
  document.getElementById("profileIndustry").value = currentProfile?.industry || "";
  document.getElementById("profilePhone").value = currentProfile?.phone || "";
  document.getElementById("profilePlan").value = currentProfile?.plan || "free";
  document.getElementById("profileTags").value = (currentProfile?.tags || []).join(", ");
  document.getElementById("profileDescription").value = currentProfile?.description || "";
}

async function saveMyProfile() {
  try {
    const data = await api("/api/profiles", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        name: document.getElementById("profileName").value.trim(),
        city: document.getElementById("profileCity").value.trim(),
        industry: document.getElementById("profileIndustry").value.trim(),
        phone: document.getElementById("profilePhone").value.trim(),
        plan: document.getElementById("profilePlan").value,
        tags: document.getElementById("profileTags").value.split(",").map(x => x.trim()).filter(Boolean),
        description: document.getElementById("profileDescription").value.trim()
      })
    });
    currentProfile = data.profile;
    fillMyProfile();
    alert("Perfil guardado.");
    await loadProfiles();
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
    const sort = encodeURIComponent(document.getElementById("searchSort")?.value || "destacados");
    const viewerUserId = encodeURIComponent(currentUser?.id || "");
    const data = await api(`/api/profiles?q=${q}&role=${role}&verified=${verified}&plan=${plan}&sort=${sort}&viewerUserId=${viewerUserId}`);
    profilesCache = data.profiles;
    renderProfiles();
    renderHome();
    renderFavorites();
  } catch (e) { console.error(e); }
}

function metricCard(value, label) {
  return `<div class="card metric"><div class="value">${value}</div><div class="label">${label}</div></div>`;
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
      <div class="item-top">
        <div>
          <strong>${esc(p.name)}</strong>
          <div class="small muted">${esc(p.city || "Sin ciudad")} · ${esc(p.industry || "Sin rubro")}</div>
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
      <div class="item-top">
        <div>
          <h3 style="margin:0 0 6px 0">${esc(p.name)}</h3>
          <div class="row">
            <span class="badge ${p.type === "vendedor" ? "type-vendedor" : "type-empresa"}">${esc(p.type)}</span>
            <span class="badge premium">${esc(p.plan)}</span>
            ${p.verified === "si" ? `<span class="badge verified">verificado</span>` : ``}
            <span class="pill">${esc(p.city || "Sin ciudad")}</span>
            <span class="pill">${esc(p.industry || "Sin rubro")}</span>
          </div>
        </div>
        <div>${stars(p.stats.avg)} <span class="small muted">${p.stats.avg ? p.stats.avg.toFixed(1) : "Sin notas"} · ${p.stats.count}</span></div>
      </div>
      <div style="height:8px"></div>
      <div>${esc(p.description || "Sin descripción")}</div>
      <div style="height:8px"></div>
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
      <strong>${esc(p.name)}</strong>
      <div class="small muted">${esc(p.city || "Sin ciudad")} · ${esc(p.industry || "Sin rubro")} · ${esc(p.plan)}</div>
      <div style="margin-top:8px">${esc(p.description || "Sin descripción")}</div>
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
  } catch (e) {
    alert(e.message);
  }
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
