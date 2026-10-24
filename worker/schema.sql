-- Заявки с сайта. Применить: npx wrangler d1 execute otves --remote --file=schema.sql
CREATE TABLE IF NOT EXISTS leads (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  type        TEXT    NOT NULL,               -- quiz (калькулятор) / callback (перезвоните)
  name        TEXT    NOT NULL,
  phone       TEXT    NOT NULL,               -- +7 (916) 123-45-67
  contact     TEXT    NOT NULL DEFAULT 'call',-- call / telegram / whatsapp
  answers     TEXT,                           -- ответы квиза в JSON (проверены сервером)
  est_min     INTEGER,                        -- смета «от», ₽ — посчитана на сервере
  est_max     INTEGER,                        -- смета «до», ₽
  weeks_min   INTEGER,                        -- срок работ, недель
  weeks_max   INTEGER,
  comment     TEXT    NOT NULL DEFAULT '',
  page        TEXT    NOT NULL DEFAULT '',    -- адрес страницы (пригодится для меток Директа)
  status      TEXT    NOT NULL DEFAULT 'new', -- new / measured / contract / lost
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Для выборок «свежие заявки» и «заявки по статусу»
CREATE INDEX IF NOT EXISTS idx_leads_created ON leads (created_at);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads (status);
