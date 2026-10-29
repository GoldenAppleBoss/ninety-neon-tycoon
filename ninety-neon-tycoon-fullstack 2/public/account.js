/* Game account experience: server-verified identity, never local passwords. */
(() => {
  const byId = id => document.getElementById(id);
  let account = null;
  let mode = 'signup';

  async function api(path, options = {}) {
    const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...options });
    let data = {};
    try { data = await response.json(); } catch {}
    if (!response.ok) {
      const detail = data.detail;
      throw new Error(typeof detail === 'string' ? detail : 'Something went wrong. Please try again.');
    }
    return data;
  }

  function setMode(next) {
    mode = next;
    const signup = next === 'signup';
    byId('signupTab').classList.toggle('selected', signup);
    byId('loginTab').classList.toggle('selected', !signup);
    byId('signupTab').setAttribute('aria-selected', String(signup));
    byId('loginTab').setAttribute('aria-selected', String(!signup));
    byId('displayNameField').hidden = !signup;
    byId('signupName').required = signup;
    byId('authPassword').autocomplete = signup ? 'new-password' : 'current-password';
    byId('passwordRules').hidden = !signup;
    byId('formTitle').textContent = signup ? 'Join the city' : 'Welcome back';
    byId('formSubtitle').textContent = signup ? 'Create your player account before starting your story.' : 'Sign in to return to your city.';
    byId('authSubmit').textContent = signup ? 'CREATE MY ACCOUNT ↗' : 'SIGN IN ↗';
    byId('authError').hidden = true;
  }

  function avatarMarkup(parent, profile) {
    parent.replaceChildren();
    if (profile.avatar_url) {
      const img = document.createElement('img');
      img.src = profile.avatar_url;
      img.alt = 'Profile photo';
      img.referrerPolicy = 'no-referrer';
      parent.append(img);
    } else {
      parent.textContent = '★';
    }
  }

  function applyProfile(updated, firstLogin = false) {
    account = updated;
    byId('headerName').textContent = account.display_name;
    byId('settingsName').textContent = account.display_name;
    byId('settingsEmail').textContent = account.email;
    byId('profileName').value = account.display_name;
    avatarMarkup(byId('headerAvatar'), account);
    avatarMarkup(byId('settingsAvatar'), account);
    if (typeof window.setGameAccount === 'function') window.setGameAccount(account, firstLogin);
  }

  function showGame(profile, firstLogin = false) {
    applyProfile(profile, firstLogin);
    byId('authGate').hidden = true;
    byId('appRoot').hidden = false;
    byId('accountOverlay').hidden = true;
    byId('authPassword').value = '';
  }

  function showLogin() {
    byId('authGate').hidden = false;
    byId('appRoot').hidden = true;
    byId('accountOverlay').hidden = true;
    byId('authPassword').value = '';
    byId('avatarFile').value = '';
    account = null;
    if (typeof window.clearGameAccount === 'function') window.clearGameAccount();
    setMode('login');
  }

  byId('signupTab').addEventListener('click', () => setMode('signup'));
  byId('loginTab').addEventListener('click', () => setMode('login'));
  byId('authForm').addEventListener('submit', async event => {
    event.preventDefault();
    const password = byId('authPassword').value;
    const error = byId('authError');
    error.hidden = true;
    if (mode === 'signup' && (password.length < 8 || !/[A-Z]/.test(password) || !/[^A-Za-z0-9\s]/.test(password))) {
      error.textContent = 'Use 8 or more characters with 1 uppercase letter and 1 special character.';
      error.hidden = false;
      return;
    }
    const button = byId('authSubmit');
    button.disabled = true;
    try {
      const payload = { email: byId('authEmail').value.trim(), password };
      if (mode === 'signup') payload.display_name = byId('signupName').value.trim();
      const result = await api(mode === 'signup' ? '/api/auth/signup' : '/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      showGame(result.account, true);
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
    } finally {
      button.disabled = false;
    }
  });

  byId('accountButton').addEventListener('click', () => {
    byId('settingsMessage').textContent = '';
    byId('accountOverlay').hidden = false;
    byId('profileName').focus();
  });
  byId('closeSettings').addEventListener('click', () => { byId('accountOverlay').hidden = true; });
  byId('accountOverlay').addEventListener('click', event => {
    if (event.target === byId('accountOverlay')) byId('accountOverlay').hidden = true;
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !byId('accountOverlay').hidden) {
      byId('accountOverlay').hidden = true;
      event.stopPropagation();
    }
  }, true);

  byId('profileForm').addEventListener('submit', async event => {
    event.preventDefault();
    try {
      const result = await api('/api/account', { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ display_name: byId('profileName').value.trim() }) });
      applyProfile(result.account);
      byId('settingsMessage').textContent = 'Your name has been updated.';
    } catch (err) { byId('settingsMessage').textContent = err.message; }
  });
  byId('avatarForm').addEventListener('submit', async event => {
    event.preventDefault();
    const file = byId('avatarFile').files[0];
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) {
      byId('settingsMessage').textContent = 'Choose a photo under 3 MB.';
      return;
    }
    const data = new FormData();
    data.append('image', file);
    const button = event.submitter;
    if (button) button.disabled = true;
    byId('settingsMessage').textContent = 'Uploading photo…';
    try {
      const result = await api('/api/account/avatar', { method: 'POST', body: data });
      applyProfile(result.account);
      byId('settingsMessage').textContent = 'Your character photo is updated!';
      byId('avatarFile').value = '';
    } catch (err) { byId('settingsMessage').textContent = err.message; }
    finally { if (button) button.disabled = false; }
  });
  byId('logoutButton').addEventListener('click', async () => {
    try { await api('/api/auth/logout', { method: 'POST' }); showLogin(); }
    catch (err) { byId('settingsMessage').textContent = err.message; }
  });

  setMode('signup');
  api('/api/auth/me').then(result => showGame(result.account, true)).catch(() => {
    byId('authGate').hidden = false;
    byId('appRoot').hidden = true;
  });
})();
