const form = document.querySelector('#checkout-form');
const message = document.querySelector('#message');
form.addEventListener('submit', async event => {
  event.preventDefault(); message.textContent = 'Opening secure checkout…';
  try {
    const response = await fetch('/api/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: form.email.value }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Checkout could not be started.');
    location.assign(data.url);
  } catch (error) { message.textContent = error.message; }
});
