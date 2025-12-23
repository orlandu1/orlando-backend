import { readFile, readdir } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { sql } from "../src/db/db.js"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const migrationsDir = path.resolve(__dirname, "../src/db/migrations")

const splitSqlStatements = (input) => {
	const statements = []
	let current = ""

	let inSingleQuote = false
	let inDoubleQuote = false
	let inLineComment = false
	let inBlockComment = false
	let dollarTag = null

	const flush = () => {
		const trimmed = current.trim()
		if (trimmed) statements.push(trimmed)
		current = ""
	}

	for (let i = 0; i < input.length; i++) {
		const ch = input[i]
		const next = input[i + 1]

		if (inLineComment) {
			current += ch
			if (ch === "\n") inLineComment = false
			continue
		}

		if (inBlockComment) {
			current += ch
			if (ch === "*" && next === "/") {
				current += next
				i++
				inBlockComment = false
			}
			continue
		}

		if (!inSingleQuote && !inDoubleQuote && !dollarTag) {
			if (ch === "-" && next === "-") {
				current += ch + next
				i++
				inLineComment = true
				continue
			}
			if (ch === "/" && next === "*") {
				current += ch + next
				i++
				inBlockComment = true
				continue
			}
		}

		// Dollar-quoted strings: $tag$ ... $tag$
		if (!inSingleQuote && !inDoubleQuote) {
			if (!dollarTag && ch === "$") {
				const rest = input.slice(i)
				const m = rest.match(/^\$[A-Za-z0-9_]*\$/)
				if (m) {
					dollarTag = m[0]
					current += dollarTag
					i += dollarTag.length - 1
					continue
				}
			} else if (dollarTag && ch === "$") {
				if (input.startsWith(dollarTag, i)) {
					current += dollarTag
					i += dollarTag.length - 1
					dollarTag = null
					continue
				}
			}
		}

		if (!dollarTag) {
			if (!inDoubleQuote && ch === "'" && !inSingleQuote) {
				inSingleQuote = true
				current += ch
				continue
			}
			if (inSingleQuote) {
				current += ch
				if (ch === "'" && next === "'") {
					current += next
					i++
					continue
				}
				if (ch === "'") inSingleQuote = false
				continue
			}

			if (!inSingleQuote && ch === '"') {
				inDoubleQuote = !inDoubleQuote
				current += ch
				continue
			}
		}

		if (!inSingleQuote && !inDoubleQuote && !dollarTag && ch === ";") {
			flush()
			continue
		}

		current += ch
	}

	flush()
	return statements
}

const run = async () => {
	const files = (await readdir(migrationsDir))
		.filter((f) => f.endsWith(".sql"))
		.sort()

	if (files.length === 0) {
		console.log("[db:migrate] Nenhuma migration encontrada")
		return
	}

	for (const file of files) {
		const fullPath = path.join(migrationsDir, file)
		const query = await readFile(fullPath, "utf8")
		console.log(`[db:migrate] Executando ${file}...`)
		const statements = splitSqlStatements(query)
		for (const stmt of statements) {
			await sql(stmt)
		}
	}

	console.log("[db:migrate] OK")
}

run().catch((err) => {
	console.error("[db:migrate] Falhou:", err)
	process.exitCode = 1
})
