(() => {
  const STATE_KEY = 'notif_seen_ids_v1';
  const SOUND_GAP_MS = 1800;
  let lastSoundAt = 0;
  let started = false;
  let timer = null;

  function getToken() {
    try { return localStorage.getItem('token') || ''; } catch { return ''; }
  }

  function getSeenIds() {
    try {
      return new Set(JSON.parse(sessionStorage.getItem(STATE_KEY) || '[]'));
    } catch {
      return new Set();
    }
  }

  function saveSeenIds(set) {
    try { sessionStorage.setItem(STATE_KEY, JSON.stringify(Array.from(set).slice(-300))); } catch {}
  }

  function ensureHost() {
    let host = document.getElementById('notif-popup-host');
    if (host) return host;
    host = document.createElement('div');
    host.id = 'notif-popup-host';
    host.style.position = 'fixed';
    host.style.top = '18px';
    host.style.right = '18px';
    host.style.zIndex = '99999';
    host.style.display = 'flex';
    host.style.flexDirection = 'column';
    host.style.gap = '10px';
    host.style.maxWidth = '360px';
    document.body.appendChild(host);
    return host;
  }

  function playSound() {
    const now = Date.now();
    if (now - lastSoundAt < SOUND_GAP_MS) return;
    lastSoundAt = now;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.22);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.24);
      setTimeout(() => { try { ctx.close(); } catch {} }, 400);
    } catch {}
  }

  async function markRead(id) {
    const token = getToken();
    if (!token || !id) return;
    try {
      await fetch('/api/notifications/' + encodeURIComponent(id) + '/read', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token }
      });
    } catch {}
  }

  function removeCard(card) {
    if (!card) return;
    card.style.opacity = '0';
    card.style.transform = 'translateY(-8px) scale(0.98)';
    setTimeout(() => card.remove(), 180);
  }

  function showPopup(notification) {
    const host = ensureHost();
    const card = document.createElement('div');
    card.style.background = '#ffffff';
    card.style.color = '#111827';
    card.style.borderRadius = '16px';
    card.style.boxShadow = '0 12px 35px rgba(0,0,0,0.18)';
    card.style.border = '1px solid rgba(0,0,0,0.08)';
    card.style.padding = '14px 14px 12px 14px';
    card.style.fontFamily = 'Arial, sans-serif';
    card.style.opacity = '0';
    card.style.transform = 'translateY(-8px)';
    card.style.transition = 'all .18s ease';
    card.innerHTML = `
      <div style="display:flex;align-items:flex-start;gap:10px;">
        <div style="width:38px;height:38px;min-width:38px;border-radius:999px;background:#25d366;color:#fff;display:flex;align-items:center;justify-content:center;font-size:18px;">💬</div>
        <div style="flex:1;min-width:0;">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
            <div style="font-weight:700;font-size:14px;line-height:1.2;">${escapeHtml(notification.title || 'Notificación')}</div>
            <button type="button" aria-label="Cerrar" style="border:none;background:transparent;font-size:18px;cursor:pointer;color:#6b7280;line-height:1;">×</button>
          </div>
          <div style="font-size:13px;line-height:1.35;color:#374151;margin-top:5px;word-wrap:break-word;">${escapeHtml(notification.message || '')}</div>
          <div style="display:flex;gap:8px;margin-top:10px;">
            <button type="button" data-open="1" style="border:none;background:#25d366;color:#fff;padding:8px 12px;border-radius:999px;cursor:pointer;font-size:12px;font-weight:700;">Abrir</button>
            <button type="button" data-close="1" style="border:none;background:#f3f4f6;color:#111827;padding:8px 12px;border-radius:999px;cursor:pointer;font-size:12px;font-weight:700;">Cerrar</button>
          </div>
        </div>
      </div>`;
    host.prepend(card);
    requestAnimationFrame(() => {
      card.style.opacity = '1';
      card.style.transform = 'translateY(0)';
    });

    const closeBtn = card.querySelector('button[aria-label="Cerrar"]');
    const close2 = card.querySelector('button[data-close="1"]');
    const openBtn = card.querySelector('button[data-open="1"]');
    closeBtn && closeBtn.addEventListener('click', () => removeCard(card));
    close2 && close2.addEventListener('click', () => removeCard(card));
    openBtn && openBtn.addEventListener('click', async () => {
      await markRead(notification.id);
      if (notification.link) {
        window.location.href = notification.link;
      }
      removeCard(card);
    });

    setTimeout(() => removeCard(card), 7000);
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  async function pollNotifications() {
    const token = getToken();
    if (!token) return;
    try {
      const res = await fetch('/api/notifications', {
        headers: { Authorization: 'Bearer ' + token }
      });
      const data = await res.json();
      if (!res.ok || !data || !data.ok) return;
      const list = Array.isArray(data.notifications) ? data.notifications : [];
      const seen = getSeenIds();
      let showed = 0;
      for (const item of list) {
        if (item.isRead) continue;
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        showPopup(item);
        showed += 1;
      }
      if (showed > 0) playSound();
      saveSeenIds(seen);
    } catch (err) {
      console.log('Notificaciones popup:', err);
    }
  }

  function start() {
    if (started) return;
    started = true;
    pollNotifications();
    timer = setInterval(pollNotifications, 5000);
  }

  function waitForBody() {
    if (document.body) {
      start();
    } else {
      setTimeout(waitForBody, 300);
    }
  }

  waitForBody();
})();
