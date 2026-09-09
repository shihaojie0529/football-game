/**
 * D25 守卫：sim 层必须是纯数据 + 纯函数。
 *
 * 这个检查存在的理由写在 DESIGN.md D25：只要有一处 sim 代码碰了 canvas/DOM，
 * "将来能换渲染器" 就从事实变成愿望。用一个 20 行脚本把它钉死，比靠自觉便宜。
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// 只匹配【真实使用】：window.x / document.x / globalThis.window。
// 直接用 /\bwindow\b/ 会把 tuning 里叫 window 的字段名也报出来 —— 守卫误报比不守卫更烦。
const FORBIDDEN = [
  /(?<![.\w$])document\s*[.[]/,
  /(?<![.\w$])window\s*[.[]/,
  /\bcanvas/i,
  /requestAnimationFrame/,
  /performance\.now/,
  /\bfrom\s+["'][^"']*\/render\//,
  /\bfrom\s+["'][^"']*\/input\//,
  /\bfrom\s+["'][^"']*\/debug\//,
  /\bfrom\s+["']lil-gui["']/,
];

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

const violations = [];
for (const file of [...walk("src/sim"), "src/tuning.ts"]) {
  const src = readFileSync(file, "utf8");
  src.split("\n").forEach((line, i) => {
    if (line.trimStart().startsWith("*") || line.trimStart().startsWith("//")) return;
    for (const re of FORBIDDEN) {
      if (re.test(line)) violations.push(`${file}:${i + 1}  ${line.trim()}`);
    }
  });
}

if (violations.length > 0) {
  console.error("D25 分层被破坏 — sim 层不允许接触渲染/DOM：\n");
  for (const v of violations) console.error("  " + v);
  process.exit(1);
}
console.log("D25 分层检查通过：sim 层是纯的。");
