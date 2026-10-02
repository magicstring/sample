(() => {
  if (typeof window.profile !== 'function' || typeof window.modal !== 'function') return;

  const pendingKey = 'grey-external-profile-updates';
  const originalProfile = window.profile;
  let pollTimer;

  function pendingUpdates() {
    try { return JSON.parse(localStorage.getItem(pendingKey) || '[]'); }
    catch { return []; }
  }

  function savePending(items) {
    localStorage.setItem(pendingKey, JSON.stringify(items));
  }

  window.profile = function profileWithDeviceOptions(id) {
    const p = pet(id);
    modal("Dog's Information", `${profileFields(p)}${p.updatedAt ? `<p class="section">Last updated ${esc(new Date(p.updatedAt).toLocaleString())}<br>${esc(p.updatedBy?.name ? 'Updated by ' + p.updatedBy.name : 'User not recorded')}</p>` : ''}<div class="footer-actions"><button onclick="profileUpdates(${id})">View profile updates</button><button onclick="externalUpdate(${id})">Update using other device</button><button class="primary" onclick="register(${id})">Update using this device</button></div>`);
  };

  window.externalUpdate = async function externalUpdate(id) {
    const p = pet(id);
    modal('Update using other device', `<div style="text-align:center;padding:20px"><p>Creating a secure update link...</p></div>`);
    try {
      const response = await fetch('/api/external-updates', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({petId: id, profile: cleanProfile(p)})
      });
      const request = await response.json();
      if (!response.ok) throw Error(request.error || 'Unable to create the update link.');
      const items = pendingUpdates().filter(item => item.petId !== id);
      items.push({token: request.token, petId: id, expiresAt: request.expiresAt});
      savePending(items);
      showQr(request, p);
      startPolling();
    } catch (error) {
      modal('Update using other device', `<p class="error">${esc(error.message)}</p><div class="footer-actions"><button onclick="profile(${id})">Back</button></div>`);
    }
  };

  function showQr(request, p) {
    modal('Update using other device', `<div style="text-align:center"><h3>${esc(p.name)}</h3><img src="${esc(request.qr)}" alt="QR code for external profile update" style="display:block;width:280px;max-width:100%;margin:20px auto"><p>Scan this QR code with the other device.</p><p class="muted" style="margin-top:10px">This one-time link expires in <strong id="external-countdown">30:00</strong>.</p><a class="btn" style="margin-top:20px;overflow-wrap:anywhere" href="${esc(request.url)}" target="_blank" rel="noopener">Open update link</a><p id="external-status" class="note">Waiting for the profile update.</p></div><div class="footer-actions"><button onclick="profile(${p.id})">Close</button></div>`);
    const countdown = document.getElementById('external-countdown');
    const updateCountdown = () => {
      if (!countdown) return;
      const remaining = Math.max(0, new Date(request.expiresAt) - new Date());
      const minutes = Math.floor(remaining / 60000);
      const seconds = Math.floor((remaining % 60000) / 1000);
      countdown.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
      if (!remaining) countdown.textContent = 'Expired';
    };
    updateCountdown();
    const timer = setInterval(() => {
      if (!document.body.contains(countdown)) return clearInterval(timer);
      updateCountdown();
    }, 1000);
  }

  function applyCompleted(item, result) {
    const current = pet(item.petId);
    if (!current) return;
    const at = result.completedAt || new Date().toISOString();
    const updatedBy = {name: result.updatedBy};
    const next = {...current, ...result.profile, id: current.id, type: 'Dog', updatedAt: at, updatedBy, registrationSnapshot: current.registrationSnapshot || cleanProfile(current)};
    db.pets = db.pets.map(existing => existing.id === current.id ? next : existing);
    db.history.push({id: Date.now(), petId: current.id, event: 'Profile updated', at, updatedBy, profile: cleanProfile(next)});
    save();
    savePending(pendingUpdates().filter(entry => entry.token !== item.token));
    if (PAGE === 'pets') renderPets();
    toast(`Profile updated by ${result.updatedBy}.`);
    if (document.getElementById('external-status')) profile(current.id);
  }

  async function checkPending() {
    for (const item of pendingUpdates()) {
      try {
        const response = await fetch(`/api/external-updates/${encodeURIComponent(item.token)}/status`);
        const result = await response.json();
        if (result.status === 'completed') applyCompleted(item, result);
        else if (result.status === 'expired' || response.status === 404) savePending(pendingUpdates().filter(entry => entry.token !== item.token));
      } catch {}
    }
  }

  function startPolling() {
    clearInterval(pollTimer);
    checkPending();
    pollTimer = setInterval(checkPending, 4000);
  }

  startPolling();
})();
