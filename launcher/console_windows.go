package main

import (
	"syscall"
	"unsafe"
)

// setupConsole 讓 Windows 主控台以 UTF-8 顯示中文訊息並設定視窗標題（以視窗程式執行、沒有主控台時不影響）。
func setupConsole() {
	kernel32 := syscall.NewLazyDLL("kernel32.dll")
	_, _, _ = kernel32.NewProc("SetConsoleOutputCP").Call(65001)
	_, _, _ = kernel32.NewProc("SetConsoleCP").Call(65001)
	if title, err := syscall.UTF16PtrFromString("社區帳務管理"); err == nil {
		_, _, _ = kernel32.NewProc("SetConsoleTitleW").Call(uintptr(unsafe.Pointer(title)))
	}
}

// alert 以 Windows 訊息視窗顯示錯誤（程式沒有主控台視窗，訊息只能這樣讓使用者看到）。
func alert(msg string) {
	text, err1 := syscall.UTF16PtrFromString(msg)
	caption, err2 := syscall.UTF16PtrFromString("社區帳務管理")
	if err1 != nil || err2 != nil {
		return
	}
	const mbOK, mbIconWarning = 0x0, 0x30
	_, _, _ = syscall.NewLazyDLL("user32.dll").NewProc("MessageBoxW").Call(0, uintptr(unsafe.Pointer(text)), uintptr(unsafe.Pointer(caption)), mbOK|mbIconWarning)
}
