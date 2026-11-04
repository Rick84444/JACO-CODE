// Header sign-in: shows who is signed in (from /auth/me) and signs out. Without a session the link goes to Google.
(() => {
  const link = document.getElementById('signin');
  if (!link) return;
  fetch('/auth/me', { credentials: 'same-origin' }).then(r => r.ok ? r.json() : null).then(me => {
    if (!me || !me.signedIn) return;
    link.textContent = 'Sign out ' + me.email;
    link.setAttribute('href', '#');
    link.addEventListener('click', event => {
      event.preventDefault();
      fetch('/auth/logout', { method: 'POST', credentials: 'same-origin' }).finally(() => location.reload());
    });
  }).catch(() => {});
})();
