// 生成 THIRD_PARTY_NOTICES.md。
//
// 主题 B 的 dist/ 把 12 个生产依赖打进了 JS/CSS 包里，再分发就必须随附它们的
// 许可证与版权声明（MIT/Apache-2.0/ISC 都这么要求）。手写这份清单注定会漂移：
// 依赖一升版，文件里的版本号与年份立刻变成假话。所以改成从 node_modules 里
// 实际读出来的 package.json 与 LICENSE 生成，并在 CI 里校验它是最新的。
//
// 用法：
//   node tools/gen-notices.mjs            # 写入 THIRD_PARTY_NOTICES.md
//   node tools/gen-notices.mjs --check    # 只校验是否最新，不写入（CI 用）

import { readFile, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { join } from "node:path"

const ROOT = join(import.meta.dirname, "..")
const OUT = join(ROOT, "THIRD_PARTY_NOTICES.md")

const LICENSE_FILES = ["LICENSE", "LICENSE.md", "LICENSE.txt", "LICENCE", "license", "LICENSE-MIT"]

/** 读一个依赖的许可证全文；找不到就返回 null，让调用方把它当成错误而不是空白。 */
async function licenseText(dir) {
  for (const name of LICENSE_FILES) {
    const p = join(dir, name)
    if (existsSync(p)) return (await readFile(p, "utf8")).trim()
  }
  return null
}

const pkg = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8"))
const names = Object.keys(pkg.dependencies ?? {}).sort()

const rows = []
const missing = []

for (const name of names) {
  const dir = join(ROOT, "node_modules", ...name.split("/"))
  const meta = JSON.parse(await readFile(join(dir, "package.json"), "utf8"))
  const text = await licenseText(dir)
  if (!text) missing.push(name)
  rows.push({
    name,
    version: meta.version,
    license: meta.license ?? "(未声明)",
    homepage: typeof meta.homepage === "string" ? meta.homepage : "",
    text,
  })
}

if (missing.length > 0) {
  // 缺许可证全文就不能生成一份"看起来完整"的声明——那比没有更糟。
  console.error(`这些依赖没有找到许可证文件，无法生成声明：${missing.join(", ")}`)
  process.exit(1)
}

const body = `# 第三方组件与许可证

本主题的 \`dist/\` 把下列生产依赖打包进了 \`index-*.js\` / \`NodeDetail-*.js\` /
\`index-*.css\`。**再分发这些打包产物时必须随附它们的许可证与版权声明**，
MIT、ISC 与 Apache-2.0 都有这条要求；此前 \`dist/\` 里没有任何声明文本。

本文件由 \`tools/gen-notices.mjs\` 从 \`node_modules\` 里实际安装的版本生成，
**不要手改**——依赖升级后请重新运行：

\`\`\`bash
node tools/gen-notices.mjs
\`\`\`

CI 会执行 \`node tools/gen-notices.mjs --check\`，确认它与已安装的依赖一致。

## 组件清单

| 组件 | 版本 | 许可证 |
| --- | --- | --- |
${rows.map((r) => `| ${r.name} | ${r.version} | ${r.license} |`).join("\n")}

## 许可证全文

${rows
  .map(
    (r) => `### ${r.name} ${r.version}

- 许可证：${r.license}${r.homepage ? `\n- 主页：${r.homepage}` : ""}

\`\`\`
${r.text}
\`\`\`
`,
  )
  .join("\n")}
## 未被打进发布包的部分

\`devDependencies\`（TypeScript、Vite、Vitest、oxlint、Testing Library 等）
只在开发与构建阶段使用，不进入 \`dist/\`，因此不构成再分发。

## 字体与图标

- 字体：走系统字体栈，不下载也不内嵌任何字体文件（\`dist/\` 里没有 woff/ttf）
- 图标：\`lucide-react\`（ISC，见上表）
- 无其他图片素材；\`favicon.svg\` 为本项目自绘
`

const rendered = body.replace(/\n{3,}/g, "\n\n")

if (process.argv.includes("--check")) {
  const current = existsSync(OUT) ? await readFile(OUT, "utf8") : ""
  if (current !== rendered) {
    console.error(
      "THIRD_PARTY_NOTICES.md 与已安装的依赖不一致。\n" +
        "请运行 `node tools/gen-notices.mjs` 并提交结果。",
    )
    process.exit(1)
  }
  console.log("THIRD_PARTY_NOTICES.md 是最新的 ✓")
  process.exit(0)
}

await writeFile(OUT, rendered)
console.log(`已生成 ${OUT}（${rows.length} 个组件，${rendered.length} 字节）`)
