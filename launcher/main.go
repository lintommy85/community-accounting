// 社區帳務管理啟動程式：在本機啟動服務、確保 data 資料夾存在，並開啟瀏覽器。
package main

import (
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"
)

//go:embed web/index.html
var webFS embed.FS

var version = "dev"

// buildID 由內嵌網頁內容計算，用來分辨執行中的服務是不是同一個版本。
var buildID = func() string {
	page, _ := webFS.ReadFile("web/index.html")
	sum := sha256.Sum256(page)
	return hex.EncodeToString(sum[:6])
}()

// exitProcess 可在測試中替換，避免真的結束測試程式。
var exitProcess = os.Exit

const (
	appID        = "community-accounting"
	backupMarker = "community-accounting-backup"
	basePort     = 17890
	portTries    = 10
	dataFile     = "ledger.json"
	keepBackups  = 60
	maxBody      = 512 << 20
)

type server struct {
	dataDir string
	port    int
	mu      sync.Mutex
}

type info struct {
	App      string `json:"app"`
	Version  string `json:"version"`
	Build    string `json:"build"`
	DataDir  string `json:"dataDir"`
	DataFile string `json:"dataFile"`
	HasData  bool   `json:"hasData"`
	Backups  int    `json:"backups"`
}

func main() {
	setupConsole()
	appDir, err := appDirectory()
	if err != nil {
		fatal("找不到程式所在資料夾：", err)
	}
	dataDir := filepath.Join(appDir, "data")
	created, err := ensureDataDir(dataDir)
	if err != nil {
		fatal("無法建立資料夾 "+dataDir+"：", err)
	}

	s := &server{dataDir: dataDir}
	ln, port, running := listen(dataDir)
	url := fmt.Sprintf("http://127.0.0.1:%d/", port)
	if running {
		fmt.Println("社區帳務管理已經在執行中，直接開啟瀏覽器：", url)
		openBrowser(url)
		time.Sleep(2 * time.Second)
		return
	}
	if ln == nil {
		fatal(fmt.Sprintf("連接埠 %d～%d 都被占用，無法啟動。", basePort, basePort+portTries-1), nil)
	}
	s.port = port

	fmt.Println("========================================")
	fmt.Println(" 社區帳務管理 " + version)
	fmt.Println("========================================")
	if created {
		fmt.Println("已建立資料夾：", dataDir)
	}
	fmt.Println("資料儲存位置：", filepath.Join(dataDir, dataFile))
	fmt.Println("每日備份位置：", filepath.Join(dataDir, "backups"))
	fmt.Println("系統網址：    ", url)
	fmt.Println()
	fmt.Println("系統在背景執行；要結束時請在網頁左下角按「結束系統」。")
	fmt.Println("換電腦時，把整個資料夾（含 data）壓縮帶走即可。")

	if os.Getenv("LEDGER_NO_BROWSER") == "" {
		go func() {
			time.Sleep(300 * time.Millisecond)
			openBrowser(url)
		}()
	}
	if err := http.Serve(ln, s.routes()); err != nil {
		fatal("服務停止：", err)
	}
}

func appDirectory() (string, error) {
	if dir := os.Getenv("LEDGER_APP_DIR"); dir != "" {
		return filepath.Abs(dir)
	}
	exe, err := os.Executable()
	if err != nil {
		return "", err
	}
	if resolved, err := filepath.EvalSymlinks(exe); err == nil {
		exe = resolved
	}
	return filepath.Dir(exe), nil
}

// ensureDataDir 啟動時檢查 data 與 data/backups 資料夾，不存在就建立。
func ensureDataDir(dataDir string) (bool, error) {
	_, statErr := os.Stat(dataDir)
	created := errors.Is(statErr, os.ErrNotExist)
	if err := os.MkdirAll(filepath.Join(dataDir, "backups"), 0o755); err != nil {
		return false, err
	}
	probe := filepath.Join(dataDir, ".write-test")
	if err := os.WriteFile(probe, []byte("ok"), 0o644); err != nil {
		return false, fmt.Errorf("資料夾無法寫入（請確認不是放在唯讀位置或壓縮檔內）：%w", err)
	}
	_ = os.Remove(probe)
	return created, nil
}

// listen 嘗試固定的連接埠。若同一份資料已有服務在跑：版本相同就沿用（running=true），
// 版本不同（例如剛解壓縮新版）就請舊服務結束，由新版本接手。
func listen(dataDir string) (net.Listener, int, bool) {
	for p := basePort; p < basePort+portTries; p++ {
		addr := fmt.Sprintf("127.0.0.1:%d", p)
		ln, err := net.Listen("tcp", addr)
		if err == nil {
			return ln, p, false
		}
		other, ok := probe(p)
		if !ok || other.App != appID || !samePath(other.DataDir, dataDir) {
			continue
		}
		if other.Build == buildID {
			return nil, p, true
		}
		fmt.Printf("偵測到舊版本（%s）正在執行，正在切換到新版本 %s…\n", other.Version, version)
		if requestShutdown(p) {
			for i := 0; i < 50; i++ {
				if ln, err := net.Listen("tcp", addr); err == nil {
					return ln, p, false
				}
				time.Sleep(100 * time.Millisecond)
			}
		}
		alert("無法關閉舊版本。請先在舊版網頁按「結束系統」（或用工作管理員結束「社區帳務管理」），再重新執行。")
		return nil, p, true
	}
	return nil, 0, false
}

func requestShutdown(port int) bool {
	req, err := http.NewRequest(http.MethodPost, fmt.Sprintf("http://127.0.0.1:%d/api/shutdown", port), nil)
	if err != nil {
		return false
	}
	req.Header.Set("X-Ledger-Client", "1")
	resp, err := (&http.Client{Timeout: 3 * time.Second}).Do(req)
	if err != nil {
		return false
	}
	resp.Body.Close()
	return resp.StatusCode == http.StatusOK
}

func probe(port int) (info, bool) {
	client := http.Client{Timeout: time.Second}
	resp, err := client.Get(fmt.Sprintf("http://127.0.0.1:%d/api/info", port))
	if err != nil {
		return info{}, false
	}
	defer resp.Body.Close()
	var i info
	return i, json.NewDecoder(resp.Body).Decode(&i) == nil
}

func samePath(a, b string) bool {
	return strings.EqualFold(filepath.Clean(a), filepath.Clean(b))
}

func (s *server) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/", s.handleIndex)
	mux.HandleFunc("/api/info", s.handleInfo)
	mux.HandleFunc("/api/data", s.handleData)
	mux.HandleFunc("/api/backups", s.handleBackups)
	mux.HandleFunc("/api/open-data-dir", s.handleOpenDir)
	mux.HandleFunc("/api/shutdown", s.handleShutdown)
	mux.HandleFunc("/guide", s.handleGuide)
	return s.guard(mux)
}

// guard 只接受本機網址，修改資料的請求必須帶自訂標頭，避免其他網站跨站寫入。
func (s *server) guard(next http.Handler) http.Handler {
	allowed := map[string]bool{
		fmt.Sprintf("127.0.0.1:%d", s.port): true,
		fmt.Sprintf("localhost:%d", s.port): true,
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !allowed[r.Host] {
			http.Error(w, "forbidden host", http.StatusForbidden)
			return
		}
		if r.Method != http.MethodGet && r.Method != http.MethodHead && r.Header.Get("X-Ledger-Client") != "1" {
			http.Error(w, "missing client header", http.StatusForbidden)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		next.ServeHTTP(w, r)
	})
}

func (s *server) handleIndex(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" && r.URL.Path != "/index.html" {
		http.NotFound(w, r)
		return
	}
	page, err := webFS.ReadFile("web/index.html")
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = w.Write(page)
}

func (s *server) dataPath() string { return filepath.Join(s.dataDir, dataFile) }

func (s *server) handleInfo(w http.ResponseWriter, _ *http.Request) {
	_, err := os.Stat(s.dataPath())
	writeJSON(w, http.StatusOK, info{
		App:      appID,
		Version:  version,
		Build:    buildID,
		DataDir:  s.dataDir,
		DataFile: s.dataPath(),
		HasData:  err == nil,
		Backups:  len(s.backupFiles()),
	})
}

func (s *server) handleData(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		s.mu.Lock()
		body, err := os.ReadFile(s.dataPath())
		s.mu.Unlock()
		if errors.Is(err, os.ErrNotExist) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "no data yet"})
			return
		}
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_, _ = w.Write(body)
	case http.MethodPut:
		body, err := io.ReadAll(io.LimitReader(r.Body, maxBody))
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
		var probe struct {
			App  string          `json:"app"`
			Data json.RawMessage `json:"data"`
		}
		if err := json.Unmarshal(body, &probe); err != nil || probe.App != backupMarker || len(probe.Data) == 0 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "資料格式不正確"})
			return
		}
		s.mu.Lock()
		err = s.save(body)
		s.mu.Unlock()
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"savedAt": time.Now().Format(time.RFC3339)})
	default:
		w.Header().Set("Allow", "GET, PUT")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

// save 先寫入暫存檔再取代正式檔，避免寫到一半斷電造成檔案損毀；每天第一次存檔前保留一份備份。
func (s *server) save(body []byte) error {
	if err := os.MkdirAll(filepath.Join(s.dataDir, "backups"), 0o755); err != nil {
		return err
	}
	current := s.dataPath()
	if _, err := os.Stat(current); err == nil {
		daily := filepath.Join(s.dataDir, "backups", "ledger-"+time.Now().Format("20060102")+".json")
		if _, err := os.Stat(daily); errors.Is(err, os.ErrNotExist) {
			if err := copyFile(current, daily); err != nil {
				return fmt.Errorf("備份失敗：%w", err)
			}
			s.pruneBackups()
		}
	}
	tmp := current + ".tmp"
	f, err := os.Create(tmp)
	if err != nil {
		return err
	}
	if _, err := f.Write(body); err != nil {
		f.Close()
		return err
	}
	if err := f.Sync(); err != nil {
		f.Close()
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	return os.Rename(tmp, current)
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		return err
	}
	return out.Close()
}

func (s *server) backupFiles() []os.DirEntry {
	entries, _ := os.ReadDir(filepath.Join(s.dataDir, "backups"))
	out := entries[:0]
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".json") {
			out = append(out, e)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name() > out[j].Name() })
	return out
}

func (s *server) pruneBackups() {
	files := s.backupFiles()
	for i := keepBackups; i < len(files); i++ {
		_ = os.Remove(filepath.Join(s.dataDir, "backups", files[i].Name()))
	}
}

func (s *server) handleBackups(w http.ResponseWriter, _ *http.Request) {
	type item struct {
		Name     string `json:"name"`
		Size     int64  `json:"size"`
		Modified string `json:"modified"`
	}
	list := []item{}
	for _, e := range s.backupFiles() {
		if fi, err := e.Info(); err == nil {
			list = append(list, item{Name: e.Name(), Size: fi.Size(), Modified: fi.ModTime().Format(time.RFC3339)})
		}
	}
	writeJSON(w, http.StatusOK, list)
}

func (s *server) handleOpenDir(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if err := openPath(s.dataDir); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"opened": s.dataDir})
}

// handleGuide 開啟和程式放在一起的圖文版使用說明（使用說明.html）。
func (s *server) handleGuide(w http.ResponseWriter, r *http.Request) {
	path := filepath.Join(filepath.Dir(s.dataDir), "使用說明.html")
	if _, err := os.Stat(path); err != nil {
		http.Error(w, "找不到使用說明.html，請確認它和社區帳務管理.exe 放在同一個資料夾。", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	http.ServeFile(w, r, path)
}

// handleShutdown 結束系統（網頁按「結束系統」或新版本接手）：等進行中的存檔完成後才結束。
func (s *server) handleShutdown(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	s.mu.Lock()
	writeJSON(w, http.StatusOK, map[string]string{"status": "bye"})
	if f, ok := w.(http.Flusher); ok {
		f.Flush()
	}
	fmt.Println("系統已結束。")
	go func() {
		time.Sleep(200 * time.Millisecond)
		exitProcess(0)
	}()
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func openBrowser(url string) {
	if err := openPath(url); err != nil {
		alert("無法自動開啟瀏覽器，請手動開啟：" + url)
	}
}

func openPath(target string) error {
	switch runtime.GOOS {
	case "windows":
		// 網址與資料夾都交給檔案總管開啟（網址會用預設瀏覽器）
		return exec.Command("explorer", target).Start()
	case "darwin":
		return exec.Command("open", target).Start()
	default:
		return exec.Command("xdg-open", target).Start()
	}
}

func fatal(msg string, err error) {
	if err != nil {
		msg = fmt.Sprintf("%s%v", msg, err)
	}
	alert(msg)
	os.Exit(1)
}
