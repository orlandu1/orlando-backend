import { sql } from "../db/db.js"
import { del, put } from "@vercel/blob"
import crypto from "node:crypto"

import {
	sendOrcamentoAprovadoEmail,
	sendServicoProntoEmail,
} from "../services/email/brevoEmail.js"

const getUserId = (req) => String(req?.auth?.sub || "").trim()

const getRole = (req) => {
	const r = Number(req?.auth?.role)
	if (Number.isNaN(r)) return 0
	// compat: role antigo 0 => admin
	if (r === 0) return 3
	return r
}

const isOperatorRole = (role) => role >= 2
const isAdminRole = (role) => role >= 3

const ensureDefaultProjeto = async (userId) => {
	const existing = await sql`
		SELECT id
		FROM projetos
		WHERE owner_user_id = ${userId} AND is_default = TRUE
		LIMIT 1
	`
	if (existing?.[0]?.id) return String(existing[0].id)

	const userRows = await sql`
		SELECT COALESCE(NULLIF(name, ''), username) AS name
		FROM users
		WHERE id = ${userId}
		LIMIT 1
	`
	const nome = String(userRows?.[0]?.name || "Projeto").trim() || "Projeto"
	const created = await sql`
		INSERT INTO projetos (owner_user_id, nome, is_default)
		VALUES (${userId}, ${nome}, TRUE)
		RETURNING id
	`
	return String(created?.[0]?.id)
}

const resolveProjectId = async (req, userId) => {
	const raw = req?.query?.projectId ?? req?.body?.projectId
	const projectId = String(raw || "").trim()
	if (projectId) return projectId
	return ensureDefaultProjeto(userId)
}

const canAccessProjeto = async ({ projectId, userId, role }) => {
	if (!projectId) return { ok: false, status: 400, message: "Projeto inválido." }
	if (!userId) return { ok: false, status: 401, message: "Token inválido ou expirado." }
	if (isOperatorRole(role)) return { ok: true }

	const rows = await sql`
		SELECT
			p.owner_user_id AS "ownerUserId",
			EXISTS(
				SELECT 1
				FROM projeto_usuarios pu
				WHERE pu.projeto_id = p.id AND pu.user_id = ${userId}
			) AS "isMember"
		FROM projetos p
		WHERE p.id = ${projectId}
		LIMIT 1
	`
	if (!rows || rows.length === 0) return { ok: false, status: 404, message: "Projeto não encontrado." }
	const ownerUserId = String(rows[0].ownerUserId)
	const isMember = rows[0].isMember === true
	if (ownerUserId === userId || isMember) return { ok: true }
	return { ok: false, status: 403, message: "Sem permissão." }
}

const toNumber = (value) => {
	const n = Number(value)
	return Number.isFinite(n) ? n : 0
}

const isDataUrl = (value) => typeof value === "string" && value.startsWith("data:")

const maskEmail = (email) => {
	const s = String(email || "").trim()
	const at = s.indexOf("@")
	if (at <= 1) return s ? "***" : ""
	const local = s.slice(0, at)
	const domain = s.slice(at + 1)
	return `${local[0]}***@${domain}`
}

const safeFilename = (name) =>
	String(name || "")
		.trim()
		.replace(/\s+/g, "-")
		.replace(/[^a-zA-Z0-9._-]/g, "")
		.slice(0, 120)

const nextServicoCodigo = async () => {
	const rows = await sql`
		SELECT COALESCE(MAX((substring(codigo from 3))::int), 0) AS max_seq
		FROM orcamento_servicos
		WHERE codigo ~ '^S-[0-9]+$'
	`
	const maxSeq = Number(rows?.[0]?.max_seq || 0)
	return `S-${String(maxSeq + 1).padStart(3, "0")}`
}

const nextPagamentoCodigo = async () => {
	const rows = await sql`
		SELECT COALESCE(MAX((substring(codigo from 3))::int), 0) AS max_seq
		FROM orcamento_pagamentos
		WHERE codigo ~ '^P-[0-9]+$'
	`
	const maxSeq = Number(rows?.[0]?.max_seq || 0)
	return `P-${String(maxSeq + 1).padStart(3, "0")}`
}

export class OrcamentosController {
	async uploadPagamentoComprovante(req, res) {
		const userId = getUserId(req)
		const role = getRole(req)
		if (!isAdminRole(role)) {
			return res.status(403).json({
				ok: false,
				error: "FORBIDDEN",
				message: "Sem permissão.",
			})
		}
		if (!userId) {
			return res.status(401).json({
				ok: false,
				error: "UNAUTHORIZED",
				message: "Token inválido ou expirado.",
			})
		}
		if (!process.env.BLOB_READ_WRITE_TOKEN) {
			return res.status(500).json({
				ok: false,
				error: "SERVER_MISCONFIG",
				message: "Blob Storage não configurado (BLOB_READ_WRITE_TOKEN ausente).",
			})
		}

		const file = req.file
		if (!file || !file.buffer || !file.originalname) {
			return res.status(400).json({
				ok: false,
				error: "VALIDATION_ERROR",
				message: "Envie um arquivo no campo 'file'.",
			})
		}

		try {
			const original = safeFilename(file.originalname)
			const id = crypto.randomUUID()
			const pathname = `comprovantes/pagamentos/${id}-${original || "arquivo"}`
			const contentType = String(file.mimetype || "application/octet-stream")
			const result = await put(pathname, file.buffer, {
				access: "public",
				contentType,
				token: process.env.BLOB_READ_WRITE_TOKEN,
			})

			return res.status(201).json({
				ok: true,
				comprovante: {
					name: file.originalname,
					type: contentType,
					size: Number(file.size) || 0,
					url: result.url,
					pathname: result.pathname,
					// compat com o frontend atual (link usa dataUrl)
					dataUrl: result.url,
				},
			})
		} catch (err) {
			console.error("[orcamentos:uploadPagamentoComprovante]", err)
			return res.status(400).json({
				ok: false,
				error: "BLOB_ERROR",
				message: "Não foi possível enviar o comprovante para o Blob Storage.",
			})
		}
	}

	async listServicos(req, res) {
		const userId = getUserId(req)
		const role = getRole(req)
		if (!userId) {
			return res.status(401).json({
				ok: false,
				error: "UNAUTHORIZED",
				message: "Token inválido ou expirado.",
			})
		}

		const projectId = await resolveProjectId(req, userId)
		const access = await canAccessProjeto({ projectId, userId, role })
		if (!access.ok) {
			return res.status(access.status).json({
				ok: false,
				error: access.status === 404 ? "NOT_FOUND" : "FORBIDDEN",
				message: access.message,
			})
		}

		try {
			const rows = await sql`
				SELECT
					codigo AS id,
					servico,
					custo,
					aprovacao,
					aprovado_em AS "aprovadoEm",
					feito,
					feito_em AS "feitoEm"
				FROM orcamento_servicos
				WHERE project_id = ${projectId}
				ORDER BY created_at DESC
			`
			return res.json({ ok: true, servicos: rows })
		} catch {
			return res.status(500).json({
				ok: false,
				error: "DB_ERROR",
				message: "Erro ao consultar o banco.",
			})
		}
	}

	async createServico(req, res) {
		const userId = getUserId(req)
		const role = getRole(req)
		if (!isAdminRole(role)) {
			return res.status(403).json({
				ok: false,
				error: "FORBIDDEN",
				message: "Sem permissão.",
			})
		}
		if (!userId) {
			return res.status(401).json({
				ok: false,
				error: "UNAUTHORIZED",
				message: "Token inválido ou expirado.",
			})
		}

		const projectId = await resolveProjectId(req, userId)
		const projectRows = await sql`
			SELECT owner_user_id AS "ownerUserId"
			FROM projetos
			WHERE id = ${projectId}
			LIMIT 1
		`
		if (!projectRows || projectRows.length === 0) {
			return res.status(404).json({ ok: false, error: "NOT_FOUND", message: "Projeto não encontrado." })
		}
		const ownerUserId = String(projectRows[0].ownerUserId)

		const { servico, custo } = req.body || {}
		const servicoStr = (servico || "").toString().trim()
		const custoNum = toNumber(custo)
		if (servicoStr.length < 2 || custoNum <= 0) {
			return res.status(400).json({
				ok: false,
				error: "VALIDATION_ERROR",
				message: "Informe serviço e custo.",
			})
		}

		try {
			const codigo = await nextServicoCodigo()
			const rows = await sql`
				INSERT INTO orcamento_servicos (user_id, project_id, codigo, servico, custo, aprovacao, feito)
				VALUES (${ownerUserId}, ${projectId}, ${codigo}, ${servicoStr}, ${custoNum}, 'pendente', NULL)
				RETURNING
					codigo AS id,
					servico,
					custo,
					aprovacao,
					aprovado_em AS "aprovadoEm",
					feito,
					feito_em AS "feitoEm"
			`
			return res.status(201).json({ ok: true, servico: rows[0] })
		} catch {
			return res.status(400).json({
				ok: false,
				error: "DB_ERROR",
				message: "Não foi possível cadastrar o serviço.",
			})
		}
	}

	async updateServico(req, res) {
		const userId = getUserId(req)
		const role = getRole(req)
		const isAdmin = isAdminRole(role)
		const { codigo } = req.params

		if (!userId) {
			return res.status(401).json({
				ok: false,
				error: "UNAUTHORIZED",
				message: "Token inválido ou expirado.",
			})
		}

		const codigoStr = (codigo || "").toString().trim()
		if (!codigoStr) {
			return res.status(400).json({
				ok: false,
				error: "VALIDATION_ERROR",
				message: "Código inválido.",
			})
		}

		const { servico, custo, aprovacao, feito } = req.body || {}
		const servicoStr = servico === undefined ? undefined : (servico || "").toString().trim()
		const custoNum = custo === undefined ? undefined : toNumber(custo)
		const aprovacaoStr = aprovacao === undefined ? undefined : (aprovacao || "").toString()
		const feitoProvided = Object.prototype.hasOwnProperty.call(req.body || {}, "feito")
		let feitoParsed
		if (!feitoProvided) {
			feitoParsed = undefined
		} else if (feito === null) {
			feitoParsed = null
		} else if (typeof feito === "boolean") {
			feitoParsed = feito
		} else if (feito === "true" || feito === 1 || feito === "1") {
			feitoParsed = true
		} else if (feito === "false" || feito === 0 || feito === "0") {
			feitoParsed = false
		} else {
			// fallback: mantém compatibilidade com valores truthy/falsy
			feitoParsed = Boolean(feito)
		}
		const feitoValue = feitoParsed === undefined ? null : feitoParsed

		// Cliente não pode editar campos textuais/valor
		if (!isAdmin && (servicoStr !== undefined || custoNum !== undefined)) {
			return res.status(403).json({
				ok: false,
				error: "FORBIDDEN",
				message: "Sem permissão.",
			})
		}

		if (servicoStr !== undefined && servicoStr.length < 2) {
			return res.status(400).json({
				ok: false,
				error: "VALIDATION_ERROR",
				message: "Serviço inválido.",
			})
		}
		if (custoNum !== undefined && custoNum <= 0) {
			return res.status(400).json({
				ok: false,
				error: "VALIDATION_ERROR",
				message: "Custo inválido.",
			})
		}
		if (aprovacaoStr !== undefined && !["aprovado", "negado", "pendente"].includes(aprovacaoStr)) {
			return res.status(400).json({
				ok: false,
				error: "VALIDATION_ERROR",
				message: "Aprovação inválida.",
			})
		}

		// Cliente só pode aprovar (nunca negar/pendente)
		if (!isAdmin && aprovacaoStr !== undefined && aprovacaoStr !== "aprovado") {
			return res.status(403).json({
				ok: false,
				error: "FORBIDDEN",
				message: "Sem permissão.",
			})
		}

		// Feito: somente admin/operador (role >= 2)
		if (role < 2 && feitoProvided) {
			return res.status(403).json({
				ok: false,
				error: "FORBIDDEN",
				message: "Sem permissão.",
			})
		}
		// Reset (NULL) do feito: somente admin
		if (!isAdmin && feitoProvided && feitoParsed === null) {
			return res.status(403).json({
				ok: false,
				error: "FORBIDDEN",
				message: "Sem permissão.",
			})
		}

		const projectId = await resolveProjectId(req, userId)
		const access = await canAccessProjeto({ projectId, userId, role })
		if (!access.ok) {
			return res.status(access.status).json({
				ok: false,
				error: access.status === 404 ? "NOT_FOUND" : "FORBIDDEN",
				message: access.message,
			})
		}

		try {
			const currentRows = await sql`
				SELECT user_id, servico, custo, aprovacao, feito
				FROM orcamento_servicos
				WHERE codigo = ${codigoStr} AND project_id = ${projectId}
				LIMIT 1
			`
			if (!currentRows || currentRows.length === 0) {
				return res.status(404).json({
					ok: false,
					error: "NOT_FOUND",
					message: "Serviço não encontrado.",
				})
			}

			const prevAprovacao = String(currentRows[0].aprovacao)
			const prevFeito = currentRows[0].feito === true
			const ownerUserId = String(currentRows[0].user_id)

			let userEmail = null
			let userName = null
			if (ownerUserId) {
				const userRows = await sql`
					SELECT
						email,
						COALESCE(NULLIF(name, ''), username) AS name
					FROM users
					WHERE id = ${ownerUserId}
					LIMIT 1
				`
				if (userRows && userRows.length > 0) {
					userEmail = String(userRows[0].email || "").trim() || null
					userName = String(userRows[0].name || "").trim() || null
				}
			}
			// Cliente: aprovado uma vez, não volta atrás
			if (!isAdmin && aprovacaoStr === "aprovado" && prevAprovacao === "aprovado") {
				return res.status(403).json({
					ok: false,
					error: "FORBIDDEN",
					message: "Serviço já aprovado. Não é possível voltar atrás.",
				})
			}
			const shouldClearAprovadoEm = prevAprovacao === "aprovado"

			let updated
			// Mantém a lógica simples e robusta (evita casts de data por string)
			if (aprovacaoStr === undefined) {
				const rows = await sql`
					UPDATE orcamento_servicos
					SET
						servico = COALESCE(${isAdmin ? servicoStr ?? null : null}, servico),
						custo = COALESCE(${isAdmin ? custoNum ?? null : null}, custo),
						feito = CASE
							WHEN ${feitoProvided} THEN ${feitoValue}::boolean
							ELSE feito
						END,
						feito_em = CASE
							WHEN NOT ${feitoProvided} THEN feito_em
							WHEN ${feitoValue}::boolean IS TRUE THEN COALESCE(feito_em, now())
							WHEN ${feitoValue}::boolean IS FALSE THEN NULL
							ELSE NULL
						END,
						updated_at = now()
					WHERE codigo = ${codigoStr} AND project_id = ${projectId}
					RETURNING
						codigo AS id,
						servico,
						custo,
						aprovacao,
						aprovado_em AS "aprovadoEm",
						feito,
						feito_em AS "feitoEm"
				`
				updated = rows?.[0]
			} else if (aprovacaoStr === "aprovado") {
				const rows = await sql`
					UPDATE orcamento_servicos
					SET
						servico = COALESCE(${isAdmin ? servicoStr ?? null : null}, servico),
						custo = COALESCE(${isAdmin ? custoNum ?? null : null}, custo),
						aprovacao = ${aprovacaoStr},
						aprovado_em = now(),
						feito = CASE
							WHEN ${feitoProvided} THEN ${feitoValue}::boolean
							ELSE feito
						END,
						feito_em = CASE
							WHEN NOT ${feitoProvided} THEN feito_em
							WHEN ${feitoValue}::boolean IS TRUE THEN COALESCE(feito_em, now())
							WHEN ${feitoValue}::boolean IS FALSE THEN NULL
							ELSE NULL
						END,
						updated_at = now()
					WHERE codigo = ${codigoStr} AND project_id = ${projectId}
					RETURNING
						codigo AS id,
						servico,
						custo,
						aprovacao,
						aprovado_em AS "aprovadoEm",
						feito,
						feito_em AS "feitoEm"
				`
				updated = rows?.[0]
			} else {
				const rows = await sql`
					UPDATE orcamento_servicos
					SET
						servico = COALESCE(${isAdmin ? servicoStr ?? null : null}, servico),
						custo = COALESCE(${isAdmin ? custoNum ?? null : null}, custo),
						aprovacao = ${aprovacaoStr},
						aprovado_em = CASE
							WHEN ${shouldClearAprovadoEm} THEN NULL
							ELSE aprovado_em
						END,
						feito = CASE
							WHEN ${feitoProvided} THEN ${feitoValue}::boolean
							ELSE feito
						END,
						feito_em = CASE
							WHEN NOT ${feitoProvided} THEN feito_em
							WHEN ${feitoValue}::boolean IS TRUE THEN COALESCE(feito_em, now())
							WHEN ${feitoValue}::boolean IS FALSE THEN NULL
							ELSE NULL
						END,
						updated_at = now()
					WHERE codigo = ${codigoStr} AND project_id = ${projectId}
					RETURNING
						codigo AS id,
						servico,
						custo,
						aprovacao,
						aprovado_em AS "aprovadoEm",
						feito,
						feito_em AS "feitoEm"
				`
				updated = rows?.[0]
			}

			if (!updated) {
				return res.status(404).json({
					ok: false,
					error: "NOT_FOUND",
					message: "Serviço não encontrado.",
				})
			}

			const newAprovacao = String(updated.aprovacao)
			const newFeito = updated.feito === true
			const shouldNotifyAprovado = prevAprovacao !== "aprovado" && newAprovacao === "aprovado"
			const shouldNotifyFeito = !prevFeito && newFeito

			if (shouldNotifyAprovado || shouldNotifyFeito) {
				console.log("[orcamentos:updateServico:notify]", {
					codigo: codigoStr,
					prevAprovacao,
					newAprovacao,
					prevFeito,
					newFeito,
					ownerUserId,
					actorUserId: userId,
					userEmail: userEmail ? maskEmail(userEmail) : null,
				})
			}

			if ((shouldNotifyAprovado || shouldNotifyFeito) && userEmail) {
				try {
					if (shouldNotifyAprovado) {
						const r1 = await sendOrcamentoAprovadoEmail({
							toEmail: userEmail,
							toName: userName,
							codigo: codigoStr,
							servico: updated.servico,
							custo: updated.custo,
						})
						console.log("[orcamentos:updateServico:email:aprovado]", {
							ok: r1?.ok === true,
							skipped: Boolean(r1?.skipped),
							reason: r1?.reason,
							to: maskEmail(userEmail),
						})
					}
					if (shouldNotifyFeito) {
						const r2 = await sendServicoProntoEmail({
							toEmail: userEmail,
							toName: userName,
							codigo: codigoStr,
							servico: updated.servico,
						})
						console.log("[orcamentos:updateServico:email:feito]", {
							ok: r2?.ok === true,
							skipped: Boolean(r2?.skipped),
							reason: r2?.reason,
							to: maskEmail(userEmail),
						})
					}
				} catch (notifyErr) {
					console.error("[orcamentos:updateServico:email]", notifyErr)
				}
			}

			return res.json({ ok: true, servico: updated })
		} catch (err) {
			console.error("[orcamentos:updateServico]", err)
			const details =
				process.env.NODE_ENV === "production"
					? undefined
					: String(err?.message || err)
			return res.status(400).json({
				ok: false,
				error: "DB_ERROR",
				message: "Não foi possível atualizar o serviço.",
				...(details ? { details } : {}),
			})
		}
	}

	async deleteServico(req, res) {
		const userId = getUserId(req)
		const role = getRole(req)
		if (!isAdminRole(role)) {
			return res.status(403).json({
				ok: false,
				error: "FORBIDDEN",
				message: "Sem permissão.",
			})
		}
		const { codigo } = req.params
		if (!userId) {
			return res.status(401).json({
				ok: false,
				error: "UNAUTHORIZED",
				message: "Token inválido ou expirado.",
			})
		}
		const codigoStr = (codigo || "").toString().trim()
		if (!codigoStr) {
			return res.status(400).json({
				ok: false,
				error: "VALIDATION_ERROR",
				message: "Código inválido.",
			})
		}

		const projectId = await resolveProjectId(req, userId)

		try {
			const rows = await sql`
				DELETE FROM orcamento_servicos
				WHERE codigo = ${codigoStr} AND project_id = ${projectId}
				RETURNING codigo AS id
			`
			if (!rows || rows.length === 0) {
				return res.status(404).json({
					ok: false,
					error: "NOT_FOUND",
					message: "Serviço não encontrado.",
				})
			}
			return res.json({ ok: true })
		} catch {
			return res.status(400).json({
				ok: false,
				error: "DB_ERROR",
				message: "Não foi possível excluir o serviço.",
			})
		}
	}

	async listPagamentos(req, res) {
		const userId = getUserId(req)
		const role = getRole(req)
		if (!userId) {
			return res.status(401).json({
				ok: false,
				error: "UNAUTHORIZED",
				message: "Token inválido ou expirado.",
			})
		}

		const projectId = await resolveProjectId(req, userId)
		const access = await canAccessProjeto({ projectId, userId, role })
		if (!access.ok) {
			return res.status(access.status).json({
				ok: false,
				error: access.status === 404 ? "NOT_FOUND" : "FORBIDDEN",
				message: access.message,
			})
		}

		try {
			const rows = await sql`
				SELECT
					codigo AS id,
					to_char(data, 'YYYY-MM-DD') AS data,
					valor,
					CASE
						WHEN COALESCE(comprovante_url, comprovante_data_url) IS NULL THEN NULL
						ELSE json_build_object(
							'name', comprovante_nome,
							'type', comprovante_tipo,
							'size', comprovante_tamanho,
							'dataUrl', COALESCE(comprovante_url, comprovante_data_url),
							'pathname', comprovante_pathname
						)
					END AS comprovante
				FROM orcamento_pagamentos
				WHERE project_id = ${projectId}
				ORDER BY data DESC, created_at DESC
			`
			return res.json({ ok: true, pagamentos: rows })
		} catch (err) {
			console.error("[orcamentos:listPagamentos]", err)
			const details =
				process.env.NODE_ENV === "production" ? undefined : String(err?.message || err)
			return res.status(500).json({
				ok: false,
				error: "DB_ERROR",
				message: "Erro ao consultar o banco.",
				...(details ? { details } : {}),
			})
		}
	}

	async createPagamento(req, res) {
		const userId = getUserId(req)
		const role = getRole(req)
		if (!isAdminRole(role)) {
			return res.status(403).json({
				ok: false,
				error: "FORBIDDEN",
				message: "Sem permissão.",
			})
		}
		if (!userId) {
			return res.status(401).json({
				ok: false,
				error: "UNAUTHORIZED",
				message: "Token inválido ou expirado.",
			})
		}

		const projectId = await resolveProjectId(req, userId)
		const projectRows = await sql`
			SELECT owner_user_id AS "ownerUserId"
			FROM projetos
			WHERE id = ${projectId}
			LIMIT 1
		`
		if (!projectRows || projectRows.length === 0) {
			return res.status(404).json({ ok: false, error: "NOT_FOUND", message: "Projeto não encontrado." })
		}
		const ownerUserId = String(projectRows[0].ownerUserId)

		const { data, valor, comprovante } = req.body || {}
		const dataStr = (data || "").toString().trim()
		const valorNum = toNumber(valor)
		if (!dataStr || valorNum <= 0) {
			return res.status(400).json({
				ok: false,
				error: "VALIDATION_ERROR",
				message: "Informe data e valor.",
			})
		}

		const comp = comprovante && typeof comprovante === "object" ? comprovante : null
		const compNome = comp ? (comp.name || "").toString() : null
		const compTipo = comp ? (comp.type || "").toString() : null
		const compTamanho = comp ? Number(comp.size) : null
		const compUrlRaw = comp ? (comp.url ?? comp.dataUrl ?? "").toString() : ""
		const compUrl = compUrlRaw.trim() ? compUrlRaw.trim() : null
		const compPathnameRaw = comp ? (comp.pathname ?? "").toString() : ""
		const compPathname = compPathnameRaw.trim() ? compPathnameRaw.trim() : null

		if (compUrl && isDataUrl(compUrl)) {
			return res.status(400).json({
				ok: false,
				error: "VALIDATION_ERROR",
				message: "Comprovante inválido. Envie uma URL do Blob Storage (não base64).",
			})
		}

		try {
			const codigo = await nextPagamentoCodigo()
			const rows = await sql`
				INSERT INTO orcamento_pagamentos (
					user_id, project_id, codigo, data, valor,
					comprovante_nome, comprovante_tipo, comprovante_tamanho,
					comprovante_url, comprovante_pathname, comprovante_uploaded_at,
					comprovante_data_url
				)
				VALUES (
					${ownerUserId}, ${projectId}, ${codigo}, ${dataStr}::date, ${valorNum},
					${compNome}, ${compTipo}, ${Number.isFinite(compTamanho) ? compTamanho : null},
					${compUrl}, ${compPathname}, CASE WHEN ${compUrl}::text IS NULL THEN NULL ELSE now() END,
					${compUrl}
				)
				RETURNING
					codigo AS id,
					to_char(data, 'YYYY-MM-DD') AS data,
					valor,
					CASE
						WHEN COALESCE(comprovante_url, comprovante_data_url) IS NULL THEN NULL
						ELSE json_build_object(
							'name', comprovante_nome,
							'type', comprovante_tipo,
							'size', comprovante_tamanho,
							'dataUrl', COALESCE(comprovante_url, comprovante_data_url),
							'pathname', comprovante_pathname
						)
					END AS comprovante
			`

			return res.status(201).json({ ok: true, pagamento: rows[0] })
		} catch (err) {
			// Se o upload já aconteceu no frontend e o INSERT falhou,
			// tenta limpar o arquivo para evitar órfãos no Blob Storage.
			if (process.env.BLOB_READ_WRITE_TOKEN) {
				const target = compPathname || compUrl
				if (target) {
					try {
						await del(target, { token: process.env.BLOB_READ_WRITE_TOKEN })
					} catch (cleanupErr) {
						console.error("[orcamentos:createPagamento:blobCleanup]", cleanupErr)
					}
				}
			}
			console.error("[orcamentos:createPagamento]", err)
			const details =
				process.env.NODE_ENV === "production" ? undefined : String(err?.message || err)
			return res.status(400).json({
				ok: false,
				error: "DB_ERROR",
				message: "Não foi possível lançar o pagamento.",
				...(details ? { details } : {}),
			})
		}
	}

	async updatePagamento(req, res) {
		const userId = getUserId(req)
		const role = getRole(req)
		if (!isAdminRole(role)) {
			return res.status(403).json({
				ok: false,
				error: "FORBIDDEN",
				message: "Sem permissão.",
			})
		}
		const { codigo } = req.params
		if (!userId) {
			return res.status(401).json({
				ok: false,
				error: "UNAUTHORIZED",
				message: "Token inválido ou expirado.",
			})
		}
		const codigoStr = (codigo || "").toString().trim()
		if (!codigoStr) {
			return res.status(400).json({
				ok: false,
				error: "VALIDATION_ERROR",
				message: "Código inválido.",
			})
		}

		const { data, valor, comprovante } = req.body || {}
		const dataStr = data === undefined ? undefined : (data || "").toString().trim()
		const valorNum = valor === undefined ? undefined : toNumber(valor)

		if (dataStr !== undefined && !dataStr) {
			return res.status(400).json({
				ok: false,
				error: "VALIDATION_ERROR",
				message: "Data inválida.",
			})
		}
		if (valorNum !== undefined && valorNum <= 0) {
			return res.status(400).json({
				ok: false,
				error: "VALIDATION_ERROR",
				message: "Valor inválido.",
			})
		}

		const comp = comprovante && typeof comprovante === "object" ? comprovante : null
		const compNome = comp ? (comp.name || "").toString() : undefined
		const compTipo = comp ? (comp.type || "").toString() : undefined
		const compTamanho = comp ? Number(comp.size) : undefined
		const compUrl = comp ? (comp.url ?? comp.dataUrl ?? "").toString() : undefined
		const compPathname = comp ? (comp.pathname ?? "").toString() : undefined

		if (compUrl !== undefined && compUrl && isDataUrl(compUrl)) {
			return res.status(400).json({
				ok: false,
				error: "VALIDATION_ERROR",
				message: "Comprovante inválido. Envie uma URL do Blob Storage (não base64).",
			})
		}

		const projectId = await resolveProjectId(req, userId)

		try {
			const rows = await sql`
				UPDATE orcamento_pagamentos
				SET
					data = COALESCE(${dataStr ?? null}::date, data),
					valor = COALESCE(${valorNum ?? null}, valor),
					comprovante_nome = COALESCE(${compNome ?? null}, comprovante_nome),
					comprovante_tipo = COALESCE(${compTipo ?? null}, comprovante_tipo),
					comprovante_tamanho = COALESCE(${Number.isFinite(compTamanho) ? compTamanho : null}, comprovante_tamanho),
					comprovante_url = COALESCE(${compUrl ?? null}, comprovante_url),
					comprovante_pathname = COALESCE(${compPathname ?? null}, comprovante_pathname),
					comprovante_uploaded_at = CASE
						WHEN ${compUrl ?? null} IS NULL THEN comprovante_uploaded_at
						ELSE COALESCE(comprovante_uploaded_at, now())
					END,
					-- compat: mantém o campo antigo preenchido
					comprovante_data_url = COALESCE(${compUrl ?? null}, comprovante_data_url),
					updated_at = now()
				WHERE codigo = ${codigoStr} AND project_id = ${projectId}
				RETURNING
					codigo AS id,
					to_char(data, 'YYYY-MM-DD') AS data,
					valor,
					CASE
						WHEN COALESCE(comprovante_url, comprovante_data_url) IS NULL THEN NULL
						ELSE json_build_object(
							'name', comprovante_nome,
							'type', comprovante_tipo,
							'size', comprovante_tamanho,
							'dataUrl', COALESCE(comprovante_url, comprovante_data_url),
							'pathname', comprovante_pathname
						)
					END AS comprovante
			`

			if (!rows || rows.length === 0) {
				return res.status(404).json({
					ok: false,
					error: "NOT_FOUND",
					message: "Pagamento não encontrado.",
				})
			}

			return res.json({ ok: true, pagamento: rows[0] })
		} catch (err) {
			console.error("[orcamentos:updatePagamento]", err)
			const details =
				process.env.NODE_ENV === "production" ? undefined : String(err?.message || err)
			return res.status(400).json({
				ok: false,
				error: "DB_ERROR",
				message: "Não foi possível atualizar o pagamento.",
				...(details ? { details } : {}),
			})
		}
	}

	async deletePagamento(req, res) {
		const userId = getUserId(req)
		const role = getRole(req)
		if (!isAdminRole(role)) {
			return res.status(403).json({
				ok: false,
				error: "FORBIDDEN",
				message: "Sem permissão.",
			})
		}
		const { codigo } = req.params
		if (!userId) {
			return res.status(401).json({
				ok: false,
				error: "UNAUTHORIZED",
				message: "Token inválido ou expirado.",
			})
		}
		const codigoStr = (codigo || "").toString().trim()
		if (!codigoStr) {
			return res.status(400).json({
				ok: false,
				error: "VALIDATION_ERROR",
				message: "Código inválido.",
			})
		}

		const projectId = await resolveProjectId(req, userId)

		try {
			const rows = await sql`
				DELETE FROM orcamento_pagamentos
				WHERE codigo = ${codigoStr} AND project_id = ${projectId}
				RETURNING
					codigo AS id,
					comprovante_pathname AS pathname,
					comprovante_url AS url,
					comprovante_data_url AS "dataUrl"
			`
			if (!rows || rows.length === 0) {
				return res.status(404).json({
					ok: false,
					error: "NOT_FOUND",
					message: "Pagamento não encontrado.",
				})
			}

			let blobDeleted = false
			if (process.env.BLOB_READ_WRITE_TOKEN) {
				const pathname = (rows[0]?.pathname || "").toString().trim()
				const url = (rows[0]?.url || rows[0]?.dataUrl || "").toString().trim()
				const target = pathname || url
				if (target) {
					try {
						await del(target, { token: process.env.BLOB_READ_WRITE_TOKEN })
						blobDeleted = true
					} catch (blobErr) {
						console.error("[orcamentos:deletePagamento:blobDelete]", blobErr)
					}
				}
			}
			return res.json({ ok: true, blobDeleted })
		} catch (err) {
			console.error("[orcamentos:deletePagamento]", err)
			const details =
				process.env.NODE_ENV === "production" ? undefined : String(err?.message || err)
			return res.status(400).json({
				ok: false,
				error: "DB_ERROR",
				message: "Não foi possível excluir o pagamento.",
				...(details ? { details } : {}),
			})
		}
	}
}
