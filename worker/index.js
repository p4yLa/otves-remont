/* =========================================================
   Cloudflare Worker «Отвес»: заявки с сайта -> база D1 -> Telegram.

   POST /  { type: 'quiz', answers, name, phone, contact, consent }
           -> сервер сам пересчитывает смету, сохраняет заявку, шлёт в Telegram
   POST /  { type: 'callback', name, phone, comment, consent }
           -> короткая заявка «перезвоните»
   GET  /health -> { ok: true } — проверить, что функция жива

   Секреты (в коде их нет):  npx wrangler secret put BOT_TOKEN
                             npx wrangler secret put CHAT_ID
   База:                     env.DB (см. wrangler.toml, schema.sql)
   ========================================================= */

// Формула сметы — тот же файл, что подключён на сайте. Wrangler вшивает его при сборке,
// поэтому цены правятся в одном месте: js/estimate.js
import Estimate from '../js/estimate.js';

// Откуда разрешено обращаться к функции (CORS)
const ALLOWED_ORIGINS = [
  'https://p4yla.github.io',
  'http://localhost:8765',
  'http://127.0.0.1:5500' // Live Server в VS Code
];

/* ---------- HTTP-утилиты ---------- */
const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const clip = (s, n) => String(s ?? '').trim().slice(0, n);
const rub = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽';

function cors(origin) {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin'
  };
}
function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors(origin) }
  });
}

// Не больше 5 заявок с одного IP за 10 минут (память у каждого экземпляра своя — защита «примерная»)
const hits = new Map();
function tooMany(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
  list.push(now);
  hits.set(ip, list);
  return list.length > 5;
}

async function telegram(env, text) {
  const r = await fetch('https://api.telegram.org/bot' + env.BOT_TOKEN + '/sendMessage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: env.CHAT_ID, text, parse_mode: 'HTML', disable_web_page_preview: true })
  });
  return r.ok;
}
const phoneLink = (phone) => '<a href="tel:' + phone.replace(/[^\d+]/g, '') + '">' + esc(phone) + '</a>';
const CONTACT_ICONS = { call: '📞', telegram: '✈️', whatsapp: '💬' };

// Приводим телефон к виду +7 (XXX) XXX-XX-XX — так его удобно читать в Telegram
function normPhone(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.length === 11 && (d[0] === '7' || d[0] === '8')) d = d.slice(1);
  if (d.length !== 10) return null;
  return '+7 (' + d.slice(0, 3) + ') ' + d.slice(3, 6) + '-' + d.slice(6, 8) + '-' + d.slice(8);
}

/* ---------- POST: квиз ---------- */
async function handleQuiz(d, base, env, origin) {
  // Ответы проверяем и считаем заново: суммы из браузера не принимаем вовсе
  const checked = Estimate.normalize(d.answers);
  if (!checked.ok) return json({ ok: false, error: 'Некорректные ответы калькулятора', fields: checked.errors }, 422, origin);
  const est = Estimate.calc(checked.value);
  const a = est.answers;
  const O = Estimate.OPTIONS;
  const contact = O.contact[d.contact] ? d.contact : 'call';

  const res = await env.DB.prepare(
    `INSERT INTO leads (type, name, phone, contact, answers, est_min, est_max, weeks_min, weeks_max, page)
     VALUES ('quiz', ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`
  ).bind(base.name, base.phone, contact, JSON.stringify(a), est.total.min, est.total.max, est.weeks.min, est.weeks.max, base.page).run();
  const id = res.meta.last_row_id;

  const lines = [
    '📐 <b>Заявка на замер #' + id + '</b>',
    '',
    '<b>' + esc(base.name) + '</b>, ' + phoneLink(base.phone),
    'Связаться: ' + CONTACT_ICONS[contact] + ' ' + O.contact[contact],
    '',
    '🏠 ' + O.property[a.property] + ', ' + a.area + ' м²',
    '🔨 Ремонт: ' + O.level[a.level].toLowerCase(),
    '🚿 ' + O.baths[a.baths],
    a.property === 'old' ? '🧱 Демонтаж: ' + O.demolition[a.demolition].toLowerCase() : null,
    '📋 Проект: ' + O.project[a.project].toLowerCase(),
    '🗓 Начать: ' + O.start[a.start].toLowerCase(),
    '',
    '💰 <b>' + rub(est.total.min) + ' – ' + rub(est.total.max) + '</b>',
    '⏱ ' + est.weeks.min + '–' + est.weeks.max + ' недель',
    ...est.lines.map((l) => '  · ' + esc(l.label) + ': ' + (l.min === l.max ? rub(l.min) : rub(l.min) + ' – ' + rub(l.max)))
  ].filter((x) => x !== null);
  // Заявка уже в базе. Если Telegram не ответил — не пугаем клиента ошибкой.
  await telegram(env, lines.join('\n')).catch(() => false);

  return json({ ok: true, id, estimate: { total: est.total, weeks: est.weeks, lines: est.lines } }, 200, origin);
}

/* ---------- POST: обратный звонок ---------- */
async function handleCallback(d, base, env, origin) {
  const comment = clip(d.comment, 500);
  const res = await env.DB.prepare(
    `INSERT INTO leads (type, name, phone, contact, comment, page) VALUES ('callback', ?1, ?2, 'call', ?3, ?4)`
  ).bind(base.name, base.phone, comment, base.page).run();
  const id = res.meta.last_row_id;
  const lines = ['📞 <b>Перезвонить #' + id + '</b>', '', '<b>' + esc(base.name) + '</b>, ' + phoneLink(base.phone)];
  if (comment) lines.push('', '💬 ' + esc(comment));
  await telegram(env, lines.join('\n')).catch(() => false);
  return json({ ok: true, id }, 200, origin);
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });

    try {
      if (request.method === 'GET' && url.pathname === '/health') return json({ ok: true }, 200, origin);
      if (request.method !== 'POST') return json({ ok: false, error: 'Not found' }, 404, origin);
      if (!ALLOWED_ORIGINS.includes(origin)) return json({ ok: false, error: 'Forbidden' }, 403, origin);

      let d;
      try { d = await request.json(); } catch { return json({ ok: false, error: 'Bad JSON' }, 400, origin); }
      if (!d || typeof d !== 'object') return json({ ok: false, error: 'Bad JSON' }, 400, origin);

      // Поле-ловушка: человек его не видит, а спам-бот заполнит. Отвечаем «ок», чтобы бот не учился.
      if (d.website) return json({ ok: true }, 200, origin);

      // Та же проверка, что на сайте: сервер не доверяет браузеру
      const name = clip(d.name, 60);
      const phone = normPhone(d.phone);
      if (name.length < 2 || !phone || d.consent !== true) {
        return json({ ok: false, error: 'Проверьте имя, телефон и согласие' }, 422, origin);
      }
      if (tooMany(request.headers.get('CF-Connecting-IP') || 'unknown')) {
        return json({ ok: false, error: 'Слишком много заявок, позвоните нам' }, 429, origin);
      }
      const base = { name, phone, page: clip(d.page, 200) };

      if (d.type === 'quiz') return await handleQuiz(d, base, env, origin);
      if (d.type === 'callback') return await handleCallback(d, base, env, origin);
      return json({ ok: false, error: 'Unknown type' }, 400, origin);
    } catch (err) {
      console.error(err);
      return json({ ok: false, error: 'Server error' }, 500, origin);
    }
  }
};
