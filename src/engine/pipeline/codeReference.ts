// Referencia del bloque `code` (herramienta `block_reference`): qué lenguajes entiende, cómo se rellena y cuándo usarlo en vez
// de un ``` dentro de un texto. En inglés: lo lee el modelo. Puro.
const FENCE = '```'

export const CODE_REFERENCE = String.raw`# code — program listing
A program listing with syntax highlighting, line numbers (from 3 lines on), a copy button and, optionally, the program's exact output in its own pane. When the lesson is about code (a language course, an algorithms unit, a script the student has to read), this is the block to use: it is the one that carries the language header, the copy button and the output.
Schema:
{"type":"code","language":"python","code":"…","output":"…","caption":"md"}
- language: optional. A highlight.js name or one of the aliases below. Omit it only for pseudocode or when you truly do not know it: the app then guesses and shows the name it found.
- code: the exact source, with real line breaks inside the JSON string (\n). Never wrap it in ${FENCE} fences and never number the lines yourself: the app numbers them.
- output: optional. What the program prints (or the compiler error), exactly, one line per line. It is rendered in its own pane, without highlighting, so give it as plain text.
- caption: optional markdown under the card: the version ("Python 3.12"), what to look at, or the flag that matters.
Languages: python, javascript, typescript, java, c, cpp, csharp, go, rust, kotlin, swift, ruby, php, scala, dart, r, matlab, julia, fortran, haskell, clojure, elixir, erlang, lua, perl, objectivec, groovy, vbnet, bash, powershell, sql, json, yaml, xml (html, svg), css, scss, less, markdown, latex, ini (toml, cfg), diff, dockerfile, makefile, cmake, gradle, nginx, graphql, protobuf, verilog, vhdl, x86asm, plaintext.
Aliases: py → python · js/node → javascript · ts/tsx → typescript · sh/shell/console → bash · c++ → cpp · c# → csharp · html/svg → xml · tex → latex · md → markdown · yml → yaml · rb → ruby · rs → rust · kt → kotlin · golang → go · objc → objectivec · asm → x86asm · ps1/pwsh → powershell · toml/cfg/conf → ini · patch → diff · gql → graphql · proto → protobuf · text/pseudocode → plaintext.
Rules
- The code must run as written (or compile, when the task is "does it compile"); no "…" elisions unless the caption says they are elided.
- Keep lines under ~90 characters: a longer line scrolls sideways instead of wrapping, and the student loses the line.
- Inside the JSON string, double every backslash and escape the double quotes (\n, \t, \\, \").
- One idea per block: split a long program into the steps you would explain, each with its own caption.
- A ${FENCE} fence inside an md field is fine for a short example inside prose, but this block is what gives the code its card, its language header, the copy button, the line numbers and the output: use it whenever the code is the content.
Examples
1. Predict the output (Python):
{"type":"code","language":"python","code":"def add(a, b=[]):\n    b.append(a)\n    return b\n\nprint(add(1))\nprint(add(2))","output":"[1]\n[1, 2]","caption":"The default list is created once, not on every call."}
2. Does it compile? (TypeScript, strict):
{"type":"code","language":"typescript","code":"interface User { name: string }\n\nconst u: User = { name: \"Ana\", age: 30 };","caption":"Why does tsc reject line 3?"}
3. Read the query (SQL):
{"type":"code","language":"sql","code":"SELECT name, AVG(grade) AS avg\nFROM students\nGROUP BY name\nHAVING AVG(grade) < 5\nORDER BY avg;","caption":"Which students are below a 5 average?"}
4. A terminal session, with the command and what it printed in the same listing:
{"type":"code","language":"bash","code":"$ npx tsc --noEmit\nsrc/user.ts:3:7 - error TS2322: Type 'string' is not assignable to type 'number'.","caption":"The compiler stops at the first incompatible assignment."}
`
