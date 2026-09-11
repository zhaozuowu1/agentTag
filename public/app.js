const listEl = document.getElementById('tag-list');
const emptyEl = document.getElementById('empty');
const statsEl = document.getElementById('stats');
const formEl = document.getElementById('tag-form');
const errorEl = document.getElementById('form-error');
const searchEl = document.getElementById('search');

let searchTimer;

async function api(path, options) {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body.error) message = body.error;
    } catch {
      /* ignore parse errors */
    }
    throw new Error(message);
  }
  return res.status === 204 ? null : res.json();
}

function render(tags) {
  listEl.innerHTML = '';
  emptyEl.classList.toggle('hidden', tags.length > 0);

  for (const tag of tags) {
    const li = document.createElement('li');
    li.className = 'tag-item';

    const swatch = document.createElement('span');
    swatch.className = 'tag-swatch';
    swatch.style.background = tag.color;

    const body = document.createElement('div');
    body.className = 'tag-body';
    const name = document.createElement('div');
    name.className = 'tag-name';
    name.textContent = tag.name;
    body.appendChild(name);
    if (tag.description) {
      const desc = document.createElement('div');
      desc.className = 'tag-desc';
      desc.textContent = tag.description;
      body.appendChild(desc);
    }

    const del = document.createElement('button');
    del.className = 'tag-delete';
    del.textContent = 'Delete';
    del.setAttribute('aria-label', `Delete ${tag.name}`);
    del.addEventListener('click', () => removeTag(tag.id));

    li.append(swatch, body, del);
    listEl.appendChild(li);
  }
}

async function refresh() {
  const search = searchEl.value.trim();
  const query = search ? `?search=${encodeURIComponent(search)}` : '';
  const tags = await api(`/tags${query}`);
  render(tags);
  if (!search) {
    statsEl.textContent = `${tags.length} tag${tags.length === 1 ? '' : 's'}`;
  }
}

async function removeTag(id) {
  await api(`/tags/${id}`, { method: 'DELETE' });
  await refresh();
}

formEl.addEventListener('submit', async (event) => {
  event.preventDefault();
  errorEl.textContent = '';
  const payload = {
    name: document.getElementById('name').value,
    description: document.getElementById('description').value,
    color: document.getElementById('color').value,
  };
  try {
    await api('/tags', { method: 'POST', body: JSON.stringify(payload) });
    formEl.reset();
    document.getElementById('color').value = '#6366f1';
    document.getElementById('name').focus();
    await refresh();
  } catch (err) {
    errorEl.textContent = err.message;
  }
});

searchEl.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(refresh, 150);
});

refresh().catch((err) => {
  errorEl.textContent = `Could not load tags: ${err.message}`;
});
