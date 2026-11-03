import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { guideHtml } from './guide-html.mjs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const appName = '社區帳務管理';
const outDir = join('release', appName);
const launcherDir = resolve('launcher');
const exeName = `${appName}.exe`;
const GO_IMAGE = 'golang:1.27.3';

rmSync('release', { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

// 前端單一 HTML 內嵌進啟動程式
copyFileSync('dist/index.html', join(launcherDir, 'web', 'index.html'));

function goBuild(goos, goarch, output) {
  // 不移除除錯符號（-s -w）：去掉符號的執行檔較容易被防毒軟體誤判
  // Windows 版編成視窗程式（-H windowsgui）：在背景執行，不會常駐主控台視窗
  const gui = goos === 'windows' ? ' -H windowsgui' : '';
  const args = ['build', '-trimpath', '-ldflags', `-X main.version=v${pkg.version}${gui}`, '-o', output, '.'];
  const env = { ...process.env, GOOS: goos, GOARCH: goarch, CGO_ENABLED: '0' };
  let hasGo = true;
  try {
    execFileSync('go', ['version'], { stdio: 'ignore' });
  } catch {
    hasGo = false;
  }
  if (hasGo) {
    execFileSync('go', args, { cwd: launcherDir, env, stdio: 'inherit' });
    return;
  }
  // 本機沒有 Go 時改用 Docker 的 Go 映像檔編譯
  execFileSync(
    'docker',
    ['run', '--rm', '--platform', 'linux/amd64', '-v', `${launcherDir}:/src`, '-w', '/src', '-e', `GOOS=${goos}`, '-e', `GOARCH=${goarch}`, '-e', 'CGO_ENABLED=0', '-e', 'GOCACHE=/tmp/gocache', GO_IMAGE, 'go', ...args],
    { stdio: 'inherit' },
  );
}

mkdirSync(join(launcherDir, 'build'), { recursive: true });
goBuild('windows', 'amd64', `build/${exeName}`);
copyFileSync(join(launcherDir, 'build', exeName), join(outDir, exeName));

const crlf = (s) => s.replace(/\r?\n/g, '\r\n');
writeFileSync(join(outDir, '使用說明.txt'), '﻿' + crlf(readFileSync('docs/使用說明.txt', 'utf8')));

// 圖文版使用說明由同一份文字檔產生（智生活的報表請從智生活系統下載，不附範例檔）
writeFileSync(join(outDir, '使用說明.html'), guideHtml(readFileSync('docs/使用說明.txt', 'utf8'), `v${pkg.version}`));

// 資料夾 data 只在使用者電腦上由程式建立，絕不放進壓縮檔，避免更新時覆蓋資料
if (existsSync(join(outDir, 'data'))) throw new Error('release 內不應該有 data 資料夾');

const zipName = `${appName}-v${pkg.version}.zip`;
// Python zipfile 會為中文檔名設定 UTF-8 旗標，Windows 檔案總管解壓縮才不會亂碼
const py = `import os, sys, zipfile
with zipfile.ZipFile(sys.argv[1], 'w', zipfile.ZIP_DEFLATED) as z:
    for root, dirs, files in os.walk(sys.argv[2]):
        dirs[:] = [d for d in dirs if d.lower() != 'data']
        for f in files:
            z.write(os.path.join(root, f))`;
execFileSync('python3', ['-I', '-c', py, zipName, appName], { cwd: 'release' });
console.log(`release/${zipName}`);
