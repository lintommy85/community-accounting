# 社區帳務管理

Offline community accounting tool for a Taiwan 管委會. It reads the 管理費入帳報表 exported from 智生活 and turns it into deposited amounts, 在途存款, a month report, arrears, and a simple cash ledger.

- **Target:** Windows. Ships as `社區帳務管理.exe` (Go launcher, standard library only) that embeds the single-file web app, serves it on `127.0.0.1:17890`, and stores all data in `data/` next to the exe (auto-created at startup, never included in the release zip). No install, no network calls.
- **Dev/test:** macOS with Node.

## Usage (for the finance committee)

See [docs/使用說明.txt](docs/使用說明.txt). It is copied into the release folder.

## Development

```bash
npm install
npm run dev        # http://localhost:5180
npm test           # vitest: parser, deposit dates, in-transit, backup round-trip
npm run typecheck
npm run build      # → release/社區帳務管理/ (Windows exe) and release/社區帳務管理-v<version>.zip
npm run test:launcher   # Go tests for the launcher (via Docker golang:1.27.3 if Go isn't installed)
npm run launcher:mac    # macOS build of the launcher for local testing:
                        # LEDGER_APP_DIR=/tmp/x LEDGER_NO_BROWSER=1 ./launcher/build/community-ledger-mac
```

`npm run build` uses `vite-plugin-singlefile`, which inlines everything into `CommunityLedger.html`. [scripts/package-release.mjs](scripts/package-release.mjs) then adds these to the release:

- a launcher `.bat`
- the user guide
- a sample report
- a zip with UTF-8 file names, so Windows Explorer shows the Chinese names correctly

## How it works

| Concern | Where |
|---|---|
| Report parsing: header-row detection, column aliases, ROC dates, Big5 CSV | [src/lib/parser.ts](src/lib/parser.ts), [src/lib/dates.ts](src/lib/dates.ts), `FIELD_ALIASES` in [src/lib/defaults.ts](src/lib/defaults.ts) |
| Expected deposit date, in-transit, month report, arrears | [src/lib/ledger.ts](src/lib/ledger.ts) |
| Persistence: launcher service `/api/data` → `data/ledger.json` (atomic write + daily backups); fallback to IndexedDB / File System Access when opened without the launcher | [launcher/main.go](launcher/main.go), [src/lib/storage.ts](src/lib/storage.ts), [src/store.tsx](src/store.tsx) |
| Monthly dues (每月應繳): imported from 智生活 bill Excel (compare by door+month+item, update only changed) or entered manually; never auto-generated | [src/lib/dues.ts](src/lib/dues.ts), [src/components/BillImport.tsx](src/components/BillImport.tsx), [src/components/MonthDues.tsx](src/components/MonthDues.tsx) |
| 收支報表 (month: 本月 + 本年累計; year: 1–12月 + 全年), fund filter, inter-fund transfers, signature rows | [src/lib/statement.ts](src/lib/statement.ts), [src/pages/StatementPage.tsx](src/pages/StatementPage.tsx) |
| Monthly write-off (逐月銷帳): manual → bill period → FIFO oldest-unpaid-first; per-door summary, unit ledger card | [src/lib/allocation.ts](src/lib/allocation.ts), [src/pages/ArrearsPage.tsx](src/pages/ArrearsPage.tsx), [src/components/UnitCard.tsx](src/components/UnitCard.tsx) |
| Excel export | [src/lib/xlsxio.ts](src/lib/xlsxio.ts) |

### Deposit dates

There are no payout rules or estimates. A payment's deposit date is whatever the 智生活 入帳報表 says in its 入帳日期/撥款日期 column:

- A row without a deposit date counts as not yet deposited, so it stays in 在途存款 (in transit).
- When a later report adds the date, re-importing updates the row.
- The deposit amount is `amount − fee` (fee taken from the report; 0 if the report has no fee column).
- 撥款對帳 groups payments by deposit date and the report's raw 繳費方式 text, and lets you confirm each group against the passbook or move it to its actual date.

Month-end in-transit is every payment where `paidDate <= monthEnd` and the deposit date is either empty or after month end. The report checks that:

```
opening in-transit + received - deposited = closing in-transit
```

### Data safety

- **Everything is one JSON document** (`AppData`). The data file and the downloaded backup use the same format, so either one can be restored.
- **Imports deduplicate** with a hash of the row's fields plus an occurrence index, so importing an overlapping report again is safe.
- **Closed months are locked.** Imports and edits that touch a closed month are blocked.
- **Every change is logged** to `audit`.

## Open items

- The 智生活 export columns are inferred from public info, not from a real file. Import a real 入帳報表 and adjust `FIELD_ALIASES` if auto-mapping misses a column. The import screen also lets you remap columns by hand, and it remembers the mapping.
- Channel clearing days are rough estimates. Tune them in 基本設定 after comparing against a few weeks of passbook entries.
- Make-up workdays (補班日) are not modeled. Only weekends and the configured holidays count as non-business days.
