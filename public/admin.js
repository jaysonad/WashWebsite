const message = document.querySelector('#message');
const table = document.querySelector('#subscriptions');
try {
  const response = await fetch('/api/admin/subscriptions', { cache: 'no-store' });
  if (response.status === 401) location.href = '/admin-login.html';
  if (!response.ok) throw new Error('Could not load subscriptions.');
  const rows = await response.json();
  const body = table.querySelector('tbody');
  for (const row of rows) {
    const tr = document.createElement('tr');
    for (const value of [row.email || '—', row.status, row.price_id || '—', row.current_period_end ? new Date(row.current_period_end).toLocaleDateString() : '—']) {
      const td = document.createElement('td'); td.textContent = value; td.style.padding = '12px 8px'; td.style.borderBottom = '1px solid #dfe7df'; tr.append(td);
    }
    body.append(tr);
  }
  message.textContent = rows.length ? `${rows.length} subscription(s)` : 'No subscriptions yet.';
  table.hidden = !rows.length;
} catch (error) { message.textContent = error.message; }
document.querySelector('#logout').addEventListener('click', async () => { await fetch('/api/admin/logout', { method: 'POST' }); location.href = '/'; });
