package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

const sample = `{"app":"community-accounting-backup","data":{"settings":{},"payments":[]}}`

func newTestServer(t *testing.T) (*server, http.Handler) {
	t.Helper()
	dir := filepath.Join(t.TempDir(), "data")
	created, err := ensureDataDir(dir)
	if err != nil || !created {
		t.Fatalf("ensureDataDir created=%v err=%v", created, err)
	}
	s := &server{dataDir: dir, port: 17890}
	return s, s.routes()
}

func do(h http.Handler, method, path, body string, header map[string]string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Host = "127.0.0.1:17890"
	for k, v := range header {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestDataDirIsCreatedAndReused(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "data")
	if created, err := ensureDataDir(dir); err != nil || !created {
		t.Fatalf("first run: created=%v err=%v", created, err)
	}
	if created, err := ensureDataDir(dir); err != nil || created {
		t.Fatalf("second run should reuse: created=%v err=%v", created, err)
	}
	if _, err := os.Stat(filepath.Join(dir, "backups")); err != nil {
		t.Fatal("backups folder missing")
	}
}

func TestSaveLoadAndDailyBackup(t *testing.T) {
	s, h := newTestServer(t)
	client := map[string]string{"X-Ledger-Client": "1"}
	if rec := do(h, http.MethodGet, "/api/data", "", nil); rec.Code != http.StatusNotFound {
		t.Fatalf("empty GET = %d", rec.Code)
	}
	if rec := do(h, http.MethodPut, "/api/data", sample, client); rec.Code != http.StatusOK {
		t.Fatalf("first PUT = %d %s", rec.Code, rec.Body)
	}
	if n := len(s.backupFiles()); n != 0 {
		t.Fatalf("no backup expected before data existed, got %d", n)
	}
	second := strings.Replace(sample, `"payments":[]`, `"payments":[1]`, 1)
	if rec := do(h, http.MethodPut, "/api/data", second, client); rec.Code != http.StatusOK {
		t.Fatalf("second PUT = %d", rec.Code)
	}
	if n := len(s.backupFiles()); n != 1 {
		t.Fatalf("expected 1 daily backup, got %d", n)
	}
	rec := do(h, http.MethodGet, "/api/data", "", nil)
	if rec.Code != http.StatusOK || rec.Body.String() != second {
		t.Fatalf("GET = %d %s", rec.Code, rec.Body)
	}
	if _, err := os.Stat(s.dataPath() + ".tmp"); err == nil {
		t.Fatal("temp file left behind")
	}
}

func TestRejectsForeignWritesAndHosts(t *testing.T) {
	_, h := newTestServer(t)
	if rec := do(h, http.MethodPut, "/api/data", sample, nil); rec.Code != http.StatusForbidden {
		t.Fatalf("PUT without header = %d", rec.Code)
	}
	if rec := do(h, http.MethodPut, "/api/data", `{"foo":1}`, map[string]string{"X-Ledger-Client": "1"}); rec.Code != http.StatusBadRequest {
		t.Fatalf("invalid body = %d", rec.Code)
	}
	req := httptest.NewRequest(http.MethodGet, "/api/info", nil)
	req.Host = "evil.example:17890"
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("foreign host = %d", rec.Code)
	}
}

func TestPrunesBackupsOlderThan30Days(t *testing.T) {
	s, _ := newTestServer(t)
	now := time.Date(2026, 11, 19, 10, 0, 0, 0, time.Local)
	dir := filepath.Join(s.dataDir, "backups")
	for i := 0; i < 40; i++ {
		day := now.AddDate(0, 0, -i)
		if err := os.WriteFile(filepath.Join(dir, "ledger-"+day.Format("20060102")+".json"), []byte("{}"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	// 其他檔名的備份看修改時間：31 天前的刪除，3 天前的保留
	for name, age := range map[string]int{"manual-old.json": 31, "manual-new.json": 3} {
		p := filepath.Join(dir, name)
		if err := os.WriteFile(p, []byte("{}"), 0o644); err != nil {
			t.Fatal(err)
		}
		mt := now.AddDate(0, 0, -age)
		if err := os.Chtimes(p, mt, mt); err != nil {
			t.Fatal(err)
		}
	}
	s.pruneBackups(now)
	names := map[string]bool{}
	for _, e := range s.backupFiles() {
		names[e.Name()] = true
	}
	if len(names) != keepBackupDays+1 {
		t.Fatalf("kept %d backups: %v", len(names), names)
	}
	oldest := "ledger-" + now.AddDate(0, 0, -(keepBackupDays-1)).Format("20060102") + ".json"
	tooOld := "ledger-" + now.AddDate(0, 0, -keepBackupDays).Format("20060102") + ".json"
	if !names[oldest] || names[tooOld] || !names["manual-new.json"] || names["manual-old.json"] {
		t.Fatalf("wrong backups kept: %v", names)
	}
}

func TestVersionLabel(t *testing.T) {
	defer func(v string) { version = v }(version)
	version = "dev"
	if got := versionLabel(); got != "dev" {
		t.Fatalf("dev label = %q", got)
	}
	version = "v1.0.0"
	if got := versionLabel(); got != "v1.0.0 正式版" {
		t.Fatalf("release label = %q", got)
	}
}

func TestShutdownRequiresHeaderAndExits(t *testing.T) {
	_, h := newTestServer(t)
	exited := make(chan int, 1)
	exitProcess = func(code int) { exited <- code }
	defer func() { exitProcess = os.Exit }()
	if rec := do(h, http.MethodPost, "/api/shutdown", "", nil); rec.Code != http.StatusForbidden {
		t.Fatalf("shutdown without header = %d", rec.Code)
	}
	if rec := do(h, http.MethodPost, "/api/shutdown", "", map[string]string{"X-Ledger-Client": "1"}); rec.Code != http.StatusOK {
		t.Fatalf("shutdown = %d", rec.Code)
	}
	if code := <-exited; code != 0 {
		t.Fatalf("exit code %d", code)
	}
	if rec := do(h, http.MethodGet, "/api/info", "", nil); !strings.Contains(rec.Body.String(), buildID) {
		t.Fatalf("info should expose build id: %s", rec.Body)
	}
}

func TestAppBrowserPrefersEdgeThenChrome(t *testing.T) {
	env := map[string]string{
		"ProgramFiles(x86)": filepath.FromSlash("/pf86"),
		"ProgramFiles":      filepath.FromSlash("/pf"),
		"LOCALAPPDATA":      filepath.FromSlash("/local"),
	}
	getenv := func(k string) string { return env[k] }
	has := func(files ...string) func(string) bool {
		set := map[string]bool{}
		for _, f := range files {
			set[f] = true
		}
		return func(p string) bool { return set[p] }
	}
	edge := filepath.Join(env["ProgramFiles(x86)"], filepath.FromSlash("Microsoft/Edge/Application/msedge.exe"))
	edgeNew := filepath.Join(env["ProgramFiles"], filepath.FromSlash("Microsoft/Edge/Application/msedge.exe"))
	chromeUser := filepath.Join(env["LOCALAPPDATA"], filepath.FromSlash("Google/Chrome/Application/chrome.exe"))
	cases := []struct {
		name  string
		files []string
		want  string
	}{
		{"Edge 優先於 Chrome", []string{chromeUser, edge}, edge},
		{"Edge 裝在 Program Files", []string{edgeNew}, edgeNew},
		{"沒有 Edge 時用只裝給使用者的 Chrome", []string{chromeUser}, chromeUser},
		{"都沒有時交給預設瀏覽器", nil, ""},
	}
	for _, c := range cases {
		if got := appBrowser(getenv, has(c.files...)); got != c.want {
			t.Errorf("%s：得到 %q，應該是 %q", c.name, got, c.want)
		}
	}
}
