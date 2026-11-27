CREATE TABLE IF NOT EXISTS trades (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 symbol TEXT NOT NULL,
 market TEXT NOT NULL DEFAULT 'SPOT',
 direction TEXT NOT NULL CHECK(direction IN ('LONG','SHORT')),
 status TEXT NOT NULL DEFAULT 'CLOSED' CHECK(status IN ('OPEN','CLOSED')),
 entry_price REAL NOT NULL,
 exit_price REAL,
 stop_loss REAL,
 take_profit REAL,
 quantity REAL NOT NULL,
 fees REAL NOT NULL DEFAULT 0,
 strategy TEXT DEFAULT '',
 setup TEXT DEFAULT '',
 emotion TEXT DEFAULT '',
 rating INTEGER DEFAULT 0,
 notes TEXT DEFAULT '',
 screenshot_path TEXT DEFAULT '',
 opened_at TEXT NOT NULL,
 closed_at TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_trades_opened ON trades(opened_at);
CREATE INDEX IF NOT EXISTS idx_trades_status ON trades(status);
CREATE TABLE IF NOT EXISTS app_settings (
 key TEXT PRIMARY KEY,
 value TEXT NOT NULL
);
