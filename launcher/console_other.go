//go:build !windows

package main

import (
	"bufio"
	"fmt"
	"os"
)

func setupConsole() {}

// alert 在主控台顯示訊息並等使用者按 Enter（Mac 測試用）。
func alert(msg string) {
	fmt.Println(msg)
	fmt.Println("按 Enter 鍵繼續…")
	_, _ = bufio.NewReader(os.Stdin).ReadString('\n')
}
