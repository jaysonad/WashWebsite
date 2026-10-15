const link = document.querySelector('#checkout-link');
fetch('/api/status').then(response => response.json()).then(({ checkoutEnabled }) => {
  if (!checkoutEnabled) { link.href = '#membership'; link.textContent = 'Membership details coming soon'; }
}).catch(() => { link.href = '#membership'; link.textContent = 'Membership details coming soon'; });
