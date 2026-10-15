const form = document.querySelector('#login-form');
form.addEventListener('submit', async event => {
  event.preventDefault();
  const message = document.querySelector('#message');
  message.textContent = 'Signing in…';
  try {
    const response = await fetch('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: form.email.value, password: form.password.value }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Sign in failed.');
    location.href = '/admin';
  } catch (error) { message.textContent = error.message; }
});
