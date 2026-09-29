'use strict';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const ui = { state: null, category: 'all', drafts: new Map(), nodes: new Map(), batches: new Map(), pending: new Set(), volume: 0.65, revision: 0, pollError: false };
const categoryInfo = { dice: ['Кубики', '◇'], weapon: ['Оружие', '⚔'], natural: ['Естественные атаки', '⋔'], magic: ['Магия', '✧'] };
const statuses = { queued: 'В очереди', generating: 'Генерация…', ready: 'Готов', failed: 'Ошибка', interrupted: 'Прервано' };
const phases = { roll: 'Бросок', launch: 'Взмах / выпуск', hit: 'Попадание', charge: 'Подготовка', activate: 'Активация', flyby: 'Пролёт', dissipate: 'Рассеивание', miss: 'Промах' };
const fmt = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });
const fmtAudioDuration = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const category = entry => /^dice/.test(entry.key) ? 'dice' : /^(weapon|shield|armor)/.test(entry.key) ? 'weapon' : /^(natural|creature|unarmed)/.test(entry.key) ? 'natural' : 'magic';
const batches = entry => entry.batches || [];
const variants = entry => batches(entry).flatMap(batch => batch.variants || []);
const browserMode = () => ui.state?.workflow !== 'api';
const browserPending = entry => (ui.state?.browserJobs || []).some(job => job.key === entry.key && job.status === 'pending');
const active = entry => browserMode() ? browserPending(entry) : variants(entry).some(v => ['queued', 'generating'].includes(v.status));
// Failed and interrupted variants have an explicit retry action. The bulk
// "missing" command only starts cues that have never had a generation batch.
const missing = entry => batches(entry).length ? 0 : 4;
const generationDuration = entry => Number(entry.generationDurationSeconds) || Math.max(0.5, Math.min(30, Number(entry.durationSeconds) || 1));

function showNotice(message, error = false) { $('#notice-text').textContent = message; $('#notice').hidden = false; $('#notice').classList.toggle('error', error); }
function showSettings() { if (!$('#settings-dialog').open) $('#settings-dialog').showModal(); }
function filteredEntries() {
  if (!ui.state) return [];
  const search = $('#search').value.trim().toLocaleLowerCase('ru');
  const status = $('#status-filter').value;
  return ui.state.entries.filter(entry => {
    if (ui.category !== 'all' && category(entry) !== ui.category) return false;
    if ($('#pilot-filter').checked && !entry.pilot) return false;
    if (search && ![entry.nameRu, entry.key, entry.phase, entry.prompt].join(' ').toLocaleLowerCase('ru').includes(search)) return false;
    if (status === 'unselected' && entry.selectedVariantId) return false;
    if (status === 'selected' && !entry.selectedVariantId) return false;
    if (status === 'empty' && variants(entry).some(v => v.status === 'ready')) return false;
    if (status === 'active' && !active(entry)) return false;
    if (status === 'failed' && !variants(entry).some(v => ['failed', 'interrupted'].includes(v.status))) return false;
    return true;
  });
}

async function mutate(path, body, key, method = 'POST') {
  if (ui.pending.has(key)) return null;
  ui.pending.add(key); ui.revision++;
  $('#save-state').textContent = 'Сохраняем…'; render();
  try {
    const response = await fetch(path, { method, headers: { 'Content-Type': 'application/json', 'X-Workbench-Token': ui.state?.csrfToken || '' }, body: JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `Ошибка запроса: ${response.status}`);
    if (result.entries) ui.state = result;
    ui.pollError = false;
    $('#save-state').textContent = 'Сохранено локально';
    return result;
  } catch (error) {
    showNotice(error.message || 'Не удалось выполнить запрос.', true);
    $('#save-state').textContent = 'Не удалось сохранить';
    return null;
  } finally {
    ui.pending.delete(key); ui.revision++; render();
  }
}

async function poll() {
  if (!ui.pending.size) {
    const revision = ui.revision;
    try {
      const response = await fetch('/api/state', { cache: 'no-store' });
      if (!response.ok) throw new Error(`Сервер ответил ${response.status}`);
      const state = await response.json();
      if (revision === ui.revision) {
        ui.state = state; render();
        if (ui.pollError) showNotice('Соединение с локальным сервером восстановлено.');
        ui.pollError = false;
      }
    } catch (error) {
      if (!ui.pollError) showNotice(`Локальный сервер недоступен. Галерея попробует подключиться снова. ${error.message}`, true);
      ui.pollError = true;
      $('#connection-state').textContent = 'Сервер недоступен';
      $('#connection-state').classList.remove('connected');
    }
  }
  window.setTimeout(poll, 1500);
}

function createEntry(entry) {
  const article = document.createElement('article');
  article.className = 'entry'; article.dataset.key = entry.key;
  const [label, icon] = categoryInfo[category(entry)];
  article.innerHTML = `<div class="entry-head"><div class="entry-heading"><span class="cue-icon" aria-hidden="true">${icon}</span><div><h3 class="entry-title">${esc(entry.nameRu)}</h3><div class="entry-subtitle"><span>${label}</span><span class="divider">/</span><span>${esc(phases[entry.phase] || entry.phase)}</span><span class="divider">/</span><span class="entry-duration"></span>${entry.pilot ? '<span class="pilot-badge">ПЕРВЫЕ 12</span>' : ''}</div></div></div><div class="entry-tools"><span class="selection-note"></span><select class="history-select" aria-label="История наборов: ${esc(entry.nameRu)}"></select></div></div><div class="audio-grid"></div><p class="entry-error" hidden></p><div class="entry-footer"><details class="prompt-details"><summary>Промпт и длительность</summary><div class="prompt-edit"><label>Описание звука<textarea class="prompt-input" spellcheck="false" aria-label="Промпт: ${esc(entry.nameRu)}"></textarea></label><div class="duration-row"><label>Длительность<input class="duration-input" type="number" min="0.1" max="30" step="0.05" aria-label="Длительность в секундах: ${esc(entry.nameRu)}">с</label><span class="duration-hint"></span></div><p class="draft-hint" hidden>Изменения применятся при следующей генерации.</p></div></details><button class="button subtle small generate-cue"></button></div>`;
  $('.prompt-input', article).value = entry.prompt;
  $('.duration-input', article).value = entry.durationSeconds;
  const saveDraft = () => {
    ui.drafts.set(entry.key, { prompt: $('.prompt-input', article).value, durationSeconds: Number($('.duration-input', article).value) });
    $('.draft-hint', article).hidden = false;
  };
  $('.prompt-input', article).addEventListener('input', saveDraft);
  $('.duration-input', article).addEventListener('input', saveDraft);
  $('.history-select', article).addEventListener('change', event => { ui.batches.set(entry.key, event.target.value); updateEntry(article, ui.state.entries.find(e => e.key === entry.key)); });
  $('.generate-cue', article).addEventListener('click', () => generateEntry(entry.key));
  return article;
}

function createVariant(entry, index) {
  const card = document.createElement('div'); card.className = 'audio-card';
  const heights = [6, 12, 8, 20, 13, 27, 37, 19, 31, 43, 25, 36, 17, 29, 40, 23, 32, 16, 24, 11, 19, 9, 13, 6];
  card.innerHTML = `<div class="variant-top"><span>ВАРИАНТ ${String(index).padStart(2, '0')}</span><span class="variant-tag"></span></div><div class="wave-motif" aria-hidden="true">${heights.map(h => `<span class="wave-h${h}"></span>`).join('')}</div><audio controls preload="metadata" hidden aria-label="${esc(entry.nameRu)}, вариант ${index}"></audio><div class="audio-placeholder"></div><p class="variant-error" hidden></p><button class="retry-button" hidden>Повторить этот вариант</button><div class="variant-bottom"><button class="variant-select" disabled>Выбрать вариант</button><a class="download-link" hidden download aria-label="Скачать ${esc(entry.nameRu)}, вариант ${index}">↓</a></div>`;
  const audio = $('audio', card); audio.volume = ui.volume;
  const updateMetadata = () => {
    if (audio.getAttribute('src') && Number.isFinite(audio.duration) && audio.duration > 0) {
      card.dataset.audioDuration = String(audio.duration);
      updateVariantLabel(card);
    }
  };
  audio.addEventListener('loadedmetadata', updateMetadata);
  audio.addEventListener('durationchange', updateMetadata);
  audio.addEventListener('play', () => {
    $$('audio').forEach(other => { if (other !== audio) other.pause(); });
    card.classList.add('is-playing');
  });
  ['pause', 'ended'].forEach(type => audio.addEventListener(type, () => card.classList.remove('is-playing')));
  audio.addEventListener('error', () => { if (audio.getAttribute('src')) { $('.variant-error', card).textContent = 'Не удалось загрузить аудиофайл. Попробуйте скачать его или обновить страницу.'; $('.variant-error', card).hidden = false; } });
  $('.variant-select', card).addEventListener('click', async () => {
    const current = ui.state.entries.find(e => e.key === entry.key);
    const id = card.dataset.variantId;
    await mutate('/api/select', { key: entry.key, variantId: current.selectedVariantId === id ? null : id }, `select:${entry.key}`);
  });
  $('.retry-button', card).addEventListener('click', async () => {
    if (browserMode()) return generateEntry(entry.key);
    if (!ui.state.connected) return showSettings();
    await mutate('/api/retry', { variantId: card.dataset.variantId, requestId: crypto.randomUUID() }, `retry:${card.dataset.variantId}`);
  });
  return card;
}

function updateVariantLabel(card) {
  const label = card.classList.contains('is-selected') ? '✓ Выбран' : (statuses[card.dataset.status] || 'Нет записи');
  const duration = Number(card.dataset.audioDuration);
  $('.variant-tag', card).textContent = `${label}${card.classList.contains('is-ready') && Number.isFinite(duration) && duration > 0 ? ` · ${fmtAudioDuration.format(duration)} с` : ''}`;
}

function updateVariant(card, entry, variant) {
  const selected = Boolean(variant && entry.selectedVariantId === variant.id);
  const ready = Boolean(variant?.status === 'ready' && variant.url);
  const failed = ['failed', 'interrupted'].includes(variant?.status);
  card.dataset.variantId = variant?.id || '';
  card.dataset.status = variant?.status || '';
  card.classList.toggle('is-selected', selected); card.classList.toggle('is-ready', ready);
  const audio = $('audio', card);
  if (ready && audio.getAttribute('src') !== variant.url) { audio.pause(); delete card.dataset.audioDuration; audio.setAttribute('src', variant.url); }
  if (!ready && audio.hasAttribute('src')) { audio.pause(); delete card.dataset.audioDuration; audio.removeAttribute('src'); audio.load(); }
  updateVariantLabel(card);
  audio.hidden = !ready;
  $('.audio-placeholder', card).hidden = ready;
  $('.audio-placeholder', card).textContent = variant ? (statuses[variant.status] || 'Ожидание') : 'Ещё не создан';
  $('.variant-error', card).hidden = !variant?.error;
  $('.variant-error', card).textContent = variant?.error || '';
  $('.retry-button', card).hidden = !failed || browserMode();
  $('.retry-button', card).disabled = ui.pending.has(`retry:${variant?.id}`);
  $('.variant-select', card).disabled = !ready || ui.pending.has(`select:${entry.key}`);
  $('.variant-select', card).textContent = selected ? '✓ Выбран · отменить' : 'Выбрать вариант';
  $('.variant-select', card).setAttribute('aria-pressed', String(selected));
  const download = $('.download-link', card); download.hidden = !ready;
  if (ready) { download.href = variant.url; download.download = variant.filename || `${entry.key}-${variant.index}.mp3`; }
}

function updateEntry(article, entry) {
  const history = batches(entry);
  let batch = history.find(b => b.id === ui.batches.get(entry.key)) || history.at(-1);
  const dropdown = $('.history-select', article);
  dropdown.hidden = history.length < 2;
  const historySignature = history.map(b => b.id).join('|');
  if (dropdown.dataset.signature !== historySignature) {
    dropdown.innerHTML = history.map((b, i) => `<option value="${esc(b.id)}">Набор ${i + 1}${i === history.length - 1 ? ' · последний' : ''}</option>`).join('');
    dropdown.dataset.signature = historySignature;
  }
  if (batch) dropdown.value = batch.id;
  const selectedBatch = history.find(b => (b.variants || []).some(v => v.id === entry.selectedVariantId));
  const selectedVariant = variants(entry).find(v => v.id === entry.selectedVariantId);
  $('.selection-note', article).textContent = selectedVariant ? `✓ Вариант ${selectedVariant.index} выбран${selectedBatch?.id !== batch?.id ? ` · из набора ${history.indexOf(selectedBatch) + 1}` : ''}` : '';
  const duration = generationDuration(entry);
  $('.entry-duration', article).textContent = duration !== Number(entry.durationSeconds) ? `${fmtAudioDuration.format(duration)} с (эффект ${fmtAudioDuration.format(entry.durationSeconds)} с)` : `${fmtAudioDuration.format(entry.durationSeconds)} с`;
  $('.duration-hint', article).textContent = duration !== Number(entry.durationSeconds) ? `Генерация: ${fmt.format(duration)} с; целевой эффект: ${fmt.format(entry.durationSeconds)} с` : '';
  if (!ui.drafts.has(entry.key) && !article.contains(document.activeElement)) {
    $('.prompt-input', article).value = entry.prompt;
    $('.duration-input', article).value = entry.durationSeconds;
  }
  const grid = $('.audio-grid', article);
  for (let i = 1; i <= 4; i++) {
    let card = grid.children[i - 1];
    if (!card) { card = createVariant(entry, i); grid.append(card); }
    updateVariant(card, entry, batch?.variants?.find(v => Number(v.index) === i));
  }
  const generate = $('.generate-cue', article);
  const isActive = active(entry);
  generate.disabled = isActive || ui.pending.has(`generate:${entry.key}`);
  generate.textContent = browserMode() && browserPending(entry) ? 'Ожидает генерации в браузере' : isActive ? 'В очереди / генерация…' : history.length ? '↻ Перегенерировать 4 варианта' : browserMode() ? '+ Заказать 4 варианта' : '+ Создать 4 варианта';
  const batchError = batch?.error;
  $('.entry-error', article).hidden = !batchError;
  $('.entry-error', article).textContent = batchError || '';
}

function render() {
  if (!ui.state) return;
  const state = ui.state; const all = state.entries || [];
  const selected = all.filter(e => e.selectedVariantId).length;
  const browser = browserMode();
  $('#connection-state').textContent = browser ? 'Через открытый ElevenLabs' : state.connected ? 'ElevenLabs API подключён' : 'Нужен API-ключ';
  $('#connection-state').classList.toggle('connected', browser || state.connected);
  $('#open-settings').innerHTML = `${browser ? 'Как это работает' : 'Подключение'} <span aria-hidden="true">↗</span>`;
  $('#selected-count').textContent = selected; $('#total-count').textContent = all.length;
  $('#all-count').textContent = all.length;
  $('#progress-fill').value = all.length ? selected / all.length * 100 : 0;
  const queued = Number(state.queue?.queued || 0); const running = Number(state.queue?.running || 0);
  $('#queue-summary').textContent = running || queued ? `${running ? `Генерируется: ${running} · ` : ''}В очереди: ${queued}${state.paused ? ' · приостановлена' : ''}` : (state.paused ? 'Очередь на паузе. Можно выбирать и слушать.' : 'Очередь свободна. Все запросы обработаны.');
  if (browser) { const pending = (state.browserJobs || []).filter(job => job.status === 'pending').length; $('#queue-summary').textContent = pending ? `Ожидают генерации в браузере: ${pending} · Выполняет Codex` : 'Выбирайте готовые звуки или закажите новые варианты.'; }
  $('#queue-toggle').hidden = browser;
  $('#queue-toggle').textContent = state.paused ? 'Продолжить очередь' : 'Приостановить';
  $('#queue-toggle').disabled = ui.pending.has('queue') || (state.paused && !queued);
  $('#browser-settings').hidden = !browser;
  $('#connect-form').hidden = browser || state.connected;
  $('#connected-settings').hidden = browser || !state.connected;
  $$('#connect-form button').forEach(button => { button.disabled = ui.pending.has('connect'); });
  $('#disconnect').disabled = ui.pending.has('disconnect');
  const requests = all.reduce((sum, e) => sum + missing(e), 0);
  const seconds = all.reduce((sum, e) => sum + missing(e) * generationDuration(e), 0);
  $('#estimate-requests').textContent = browser ? `${all.filter(e => missing(e)).length} наборов · по 4 варианта` : `${fmt.format(requests)} запросов · до 4 вариантов на звук`;
  $('#estimate-duration').textContent = `Суммарно около ${fmt.format(seconds)} с аудио для недостающих вариантов.`;
  const visible = filteredEntries(); const visibleKeys = new Set(visible.map(e => e.key));
  $('#results-count').textContent = `Показано ${visible.length} из ${all.length} · выбран ${selected} из ${all.length}`;
  const visibleMissing = visible.filter(entry => !active(entry)).reduce((sum, entry) => sum + missing(entry), 0);
  $('#generate-visible').textContent = `${browser ? 'Заказать' : 'Создать'} недостающие · ${visibleMissing} вариантов`;
  $('#generate-visible').disabled = !visibleMissing || ui.pending.has('generate-visible');
  $('#empty-state').hidden = visible.length !== 0;
  for (const entry of all) {
    let article = ui.nodes.get(entry.key);
    if (!article) { article = createEntry(entry); ui.nodes.set(entry.key, article); $('#entries').append(article); }
    article.hidden = !visibleKeys.has(entry.key);
    updateEntry(article, entry);
  }
}

async function generateEntry(key) {
  if (!browserMode() && !ui.state.connected) return showSettings();
  const entry = ui.state.entries.find(e => e.key === key);
  const draft = ui.drafts.get(key);
  if (draft && (!draft.prompt.trim() || !Number.isFinite(draft.durationSeconds) || draft.durationSeconds < 0.1 || draft.durationSeconds > 30)) return showNotice('Введите описание звука и длительность от 0,1 до 30 секунд.', true);
  const result = await mutate(browserMode() ? '/api/browser-request' : '/api/generate', { keys: [key], mode: batches(entry).length ? 'regenerate' : 'missing', requestId: crypto.randomUUID(), ...draft }, `generate:${key}`);
  if (result) { ui.drafts.delete(key); ui.batches.delete(key); $('.draft-hint', ui.nodes.get(key)).hidden = true; render(); }
}

$$('[data-category]').forEach(button => button.addEventListener('click', () => {
  ui.category = button.dataset.category;
  $$('[data-category]').forEach(tab => { tab.classList.toggle('active', tab === button); tab.setAttribute('aria-pressed', String(tab === button)); });
  render();
}));
['search', 'status-filter', 'pilot-filter'].forEach(id => $(`#${id}`).addEventListener(id === 'search' ? 'input' : 'change', render));
$('#reset-filters').addEventListener('click', () => { $('#search').value = ''; $('#status-filter').value = 'all'; $('#pilot-filter').checked = false; $('[data-category="all"]').click(); });
$('#master-volume').addEventListener('input', event => { ui.volume = Number(event.target.value) / 100; $('#volume-value').textContent = `${event.target.value}%`; $$('audio').forEach(audio => { audio.volume = ui.volume; }); });
$('#open-settings').addEventListener('click', showSettings);
$('#close-settings').addEventListener('click', () => $('#settings-dialog').close());
$('#settings-dialog').addEventListener('click', event => { if (event.target === $('#settings-dialog')) { const box = $('#settings-dialog').getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) $('#settings-dialog').close(); } });
$('#dismiss-notice').addEventListener('click', () => { $('#notice').hidden = true; });
$('#connect-form').addEventListener('submit', async event => {
  event.preventDefault();
  const apiKey = $('#api-key').value.trim();
  if (!apiKey) return;
  const startScope = event.submitter?.value || 'all';
  $('#api-key').value = '';
  const result = await mutate('/api/connect', { apiKey, startScope, requestId: crypto.randomUUID() }, 'connect');
  if (result) { $('#settings-dialog').close(); showNotice(startScope === 'none' ? 'ElevenLabs подключён. Выберите звуки для генерации.' : 'ElevenLabs подключён. Недостающие варианты добавлены в очередь.'); }
});
$('#disconnect').addEventListener('click', async () => { if (await mutate('/api/key', {}, 'disconnect', 'DELETE')) showNotice('Ключ удалён из памяти сервера. Очередь приостановлена.'); });
$('#queue-toggle').addEventListener('click', async () => { if (ui.state.paused && !ui.state.connected) return showSettings(); await mutate('/api/queue', { action: ui.state.paused ? 'resume' : 'pause' }, 'queue'); });
$('#generate-visible').addEventListener('click', async () => {
  if (!browserMode() && !ui.state.connected) return showSettings();
  const keys = filteredEntries().filter(entry => missing(entry) && !active(entry)).map(entry => entry.key);
  if (keys.length) await mutate(browserMode() ? '/api/browser-request' : '/api/generate', { keys, mode: 'missing', requestId: crypto.randomUUID() }, 'generate-visible');
});
poll();
