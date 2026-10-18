// Development helper: adds an extension id to enable-proposed-api in the given editor's argv.json
// using the same jsonc edit the extension performs. Usage: node tools/dev-argv-add.cjs [.vscode-oss] [id]
const { parse, modify, applyEdits } = require('jsonc-parser');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataFolder = process.argv[2] ?? '.vscode-oss';
const id = process.argv[3] ?? 'n2ns.wsl-remote';
const file = path.join(os.homedir(), dataFolder, 'argv.json');
const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '{\n}\n';
const parsed = parse(text, [], { allowTrailingComma: true }) ?? {};
const current = Array.isArray(parsed['enable-proposed-api']) ? parsed['enable-proposed-api'] : [];
if (current.includes(id)) {
  console.log(`${id} already listed in ${file}`);
  process.exit(0);
}
if (fs.existsSync(file)) {
  fs.writeFileSync(`${file}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`, text);
}
const eol = text.includes('\r\n') ? '\r\n' : '\n';
const edits = modify(text, ['enable-proposed-api'], [...current, id], { formattingOptions: { insertSpaces: false, tabSize: 4, eol } });
fs.writeFileSync(file, applyEdits(text, edits));
console.log(`added ${id} to ${file}`);
