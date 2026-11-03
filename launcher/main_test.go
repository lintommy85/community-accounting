package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
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

func TestPrunesOldBackups(t *testing.T) {
	s, _ := newTestServer(t)
	for i := 0; i < keepBackups+5; i++ {
		name := filepath.Join(s.dataDir, "backups", "ledger-2025"+string(rune('A'+i/26))+string(rune('a'+i%26))+".json")
		if err := os.WriteFile(name, []byte("{}"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	s.pruneBackups()
	if n := len(s.backupFiles()); n != keepBackups {
		t.Fatalf("kept %d backups", n)
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
