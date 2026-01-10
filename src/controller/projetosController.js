import { sql } from "../db/db.js"

const getUserId = (req) => String(req?.auth?.sub || "").trim()

const getRole = (req) => {
	const r = Number(req?.auth?.role)
	if (Number.isNaN(r)) return 0
	// compat: role antigo 0 => admin
	if (r === 0) return 3
	return r
}

const isOperator = (role) => role >= 2
const isAdmin = (role) => role >= 3

const toNumber = (value) => {
	const n = Number(value)
	return Number.isFinite(n) ? n : 0
}

const isDataUrl = (value) => typeof value === "string" && value.startsWith("data:")

const ensureDefaultProjeto = async (userId) => {
	const existing = await sql`
		SELECT id, owner_user_id AS "ownerUserId", nome, is_default AS "isDefault"
		FROM projetos
		WHERE owner_user_id = ${userId} AND is_default = TRUE
		LIMIT 1
	`
	if (existing?.[0]) return existing[0]

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
		RETURNING id, owner_user_id AS "ownerUserId", nome, is_default AS "isDefault"
	`
	return created?.[0]
}

const canAccessProjeto = async ({ projectId, userId, role }) => {
	if (!projectId || !userId) return { ok: false, status: 401, message: "Token inválido ou expirado." }
	// Operador/Admin pode ver qualquer projeto
	if (isOperator(role)) return { ok: true }

	const rows = await sql`
		SELECT
			p.id,
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

const getProjetoOwner = async (projectId) => {
	const rows = await sql`
		SELECT p.owner_user_id AS "ownerUserId"
		FROM projetos p
		WHERE p.id = ${projectId}
		LIMIT 1
	`
	return rows?.[0] ? String(rows[0].ownerUserId) : null
}

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

export class ProjetosController {
	async stats(req, res) {
		const userId = getUserId(req)
		const role = getRole(req)
		const projectId = String(req.params.id || "").trim()
		if (!userId) {
			return res.status(401).json({ ok: false, error: "UNAUTHORIZED", message: "Token inválido ou expirado." })
		}
		const access = await canAccessProjeto({ projectId, userId, role })
		if (!access.ok) {
			return res.status(access.status).json({
				ok: false,
				error: access.status === 404 ? "NOT_FOUND" : "FORBIDDEN",
				message: access.message,
			})
		}

		try {
			const projectRows = await sql`
				SELECT id, nome
				FROM projetos
				WHERE id = ${projectId}
				LIMIT 1
			`
			if (!projectRows || projectRows.length === 0) {
				return res.status(404).json({ ok: false, error: "NOT_FOUND", message: "Projeto não encontrado." })
			}

			const rows = await sql`
				SELECT
					(SELECT COUNT(*)::int FROM orcamento_servicos s WHERE s.project_id = ${projectId}) AS "servicosCount",
					(SELECT COUNT(*)::int FROM orcamento_pagamentos p WHERE p.project_id = ${projectId}) AS "pagamentosCount"
			`

			const servicosCount = Number(rows?.[0]?.servicosCount ?? 0)
			const pagamentosCount = Number(rows?.[0]?.pagamentosCount ?? 0)
			return res.json({
				ok: true,
				projeto: { id: String(projectRows[0].id), nome: String(projectRows[0].nome) },
				servicosCount: Number.isFinite(servicosCount) ? servicosCount : 0,
				pagamentosCount: Number.isFinite(pagamentosCount) ? pagamentosCount : 0,
			})
		} catch {
			return res.status(500).json({ ok: false, error: "DB_ERROR", message: "Erro ao consultar o banco." })
		}
	}

	async getOne(req, res) {
		const userId = getUserId(req)
		const role = getRole(req)
		const projectId = String(req.params.id || "").trim()
		if (!userId) {
			return res.status(401).json({ ok: false, error: "UNAUTHORIZED", message: "Token inválido ou expirado." })
		}
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
					p.id,
					p.nome,
					p.owner_user_id AS "ownerUserId",
					COALESCE(NULLIF(u.name, ''), u.username) AS "ownerNome",
					u.email AS "ownerEmail",
					p.is_default AS "isDefault",
					p.created_at AS "createdAt",
					p.updated_at AS "updatedAt"
				FROM projetos p
				JOIN users u ON u.id = p.owner_user_id
				WHERE p.id = ${projectId}
				LIMIT 1
			`
			if (!rows || rows.length === 0) {
				return res.status(404).json({ ok: false, error: "NOT_FOUND", message: "Projeto não encontrado." })
			}
			return res.json({ ok: true, projeto: rows[0] })
		} catch {
			return res.status(500).json({ ok: false, error: "DB_ERROR", message: "Erro ao consultar o banco." })
		}
	}

	async create(req, res) {
		const actorUserId = getUserId(req)
		const role = getRole(req)
		if (!isAdmin(role)) {
			return res.status(403).json({ ok: false, error: "FORBIDDEN", message: "Sem permissão." })
		}
		if (!actorUserId) {
			return res.status(401).json({ ok: false, error: "UNAUTHORIZED", message: "Token inválido ou expirado." })
		}

		const { nome, ownerUserId, isDefault } = req.body || {}
		const nomeStr = String(nome || "").trim()
		const ownerId = String(ownerUserId || actorUserId).trim()
		const isDefaultBool = Boolean(isDefault)
		if (nomeStr.length < 2) {
			return res.status(400).json({ ok: false, error: "VALIDATION_ERROR", message: "Nome do projeto inválido." })
		}

		try {
			const userRows = await sql`
				SELECT id
				FROM users
				WHERE id = ${ownerId}
				LIMIT 1
			`
			if (!userRows || userRows.length === 0) {
				return res.status(400).json({ ok: false, error: "VALIDATION_ERROR", message: "Usuário proprietário inválido." })
			}

			if (isDefaultBool) {
				await sql`
					UPDATE projetos
					SET is_default = FALSE, updated_at = now()
					WHERE owner_user_id = ${ownerId} AND is_default = TRUE
				`
			}

			const rows = await sql`
				INSERT INTO projetos (owner_user_id, nome, is_default)
				VALUES (${ownerId}, ${nomeStr}, ${isDefaultBool})
				RETURNING id
			`
			const projectId = String(rows?.[0]?.id || "")
			const result = await sql`
				SELECT
					p.id,
					p.nome,
					p.owner_user_id AS "ownerUserId",
					COALESCE(NULLIF(u.name, ''), u.username) AS "ownerNome",
					u.email AS "ownerEmail",
					p.is_default AS "isDefault",
					p.created_at AS "createdAt"
				FROM projetos p
				JOIN users u ON u.id = p.owner_user_id
				WHERE p.id = ${projectId}
				LIMIT 1
			`
			return res.status(201).json({ ok: true, projeto: result?.[0] })
		} catch {
			return res.status(400).json({ ok: false, error: "DB_ERROR", message: "Não foi possível criar o projeto." })
		}
	}

	async update(req, res) {
		const actorUserId = getUserId(req)
		const role = getRole(req)
		const projectId = String(req.params.id || "").trim()
		if (!isAdmin(role)) {
			return res.status(403).json({ ok: false, error: "FORBIDDEN", message: "Sem permissão." })
		}
		if (!actorUserId) {
			return res.status(401).json({ ok: false, error: "UNAUTHORIZED", message: "Token inválido ou expirado." })
		}
		if (!projectId) {
			return res.status(400).json({ ok: false, error: "VALIDATION_ERROR", message: "Projeto inválido." })
		}

		const { nome, ownerUserId, isDefault } = req.body || {}
		const nomeStr = nome === undefined ? undefined : String(nome || "").trim()
		const ownerId = ownerUserId === undefined ? undefined : String(ownerUserId || "").trim()
		const hasIsDefault = Object.prototype.hasOwnProperty.call(req.body || {}, "isDefault")
		const isDefaultBool = Boolean(isDefault)

		if (nomeStr !== undefined && nomeStr.length < 2) {
			return res.status(400).json({ ok: false, error: "VALIDATION_ERROR", message: "Nome do projeto inválido." })
		}

		try {
			const existingRows = await sql`
				SELECT id, owner_user_id AS "ownerUserId", is_default AS "isDefault"
				FROM projetos
				WHERE id = ${projectId}
				LIMIT 1
			`
			if (!existingRows || existingRows.length === 0) {
				return res.status(404).json({ ok: false, error: "NOT_FOUND", message: "Projeto não encontrado." })
			}
			const prevOwnerId = String(existingRows[0].ownerUserId)
			const nextOwnerId = ownerId !== undefined ? ownerId : prevOwnerId

			if (ownerId !== undefined) {
				const userRows = await sql`
					SELECT id
					FROM users
					WHERE id = ${nextOwnerId}
					LIMIT 1
				`
				if (!userRows || userRows.length === 0) {
					return res.status(400).json({ ok: false, error: "VALIDATION_ERROR", message: "Usuário proprietário inválido." })
				}
			}

			if (hasIsDefault && isDefaultBool) {
				await sql`
					UPDATE projetos
					SET is_default = FALSE, updated_at = now()
					WHERE owner_user_id = ${nextOwnerId} AND is_default = TRUE
						AND id <> ${projectId}
				`
			}

			await sql`
				UPDATE projetos
				SET
					nome = COALESCE(${nomeStr ?? null}, nome),
					owner_user_id = COALESCE(${ownerId ?? null}, owner_user_id),
					is_default = CASE
						WHEN ${hasIsDefault} THEN ${isDefaultBool}
						ELSE is_default
					END,
					updated_at = now()
				WHERE id = ${projectId}
			`

			// Se mudou proprietário, sincroniza os registros dependentes para manter (user_id, project_id) consistente.
			if (nextOwnerId !== prevOwnerId) {
				await sql`
					UPDATE orcamento_servicos
					SET user_id = ${nextOwnerId}, updated_at = now()
					WHERE project_id = ${projectId}
				`
				await sql`
					UPDATE orcamento_pagamentos
					SET user_id = ${nextOwnerId}, updated_at = now()
					WHERE project_id = ${projectId}
				`
			}

			const result = await sql`
				SELECT
					p.id,
					p.nome,
					p.owner_user_id AS "ownerUserId",
					COALESCE(NULLIF(u.name, ''), u.username) AS "ownerNome",
					u.email AS "ownerEmail",
					p.is_default AS "isDefault",
					p.created_at AS "createdAt",
					p.updated_at AS "updatedAt"
				FROM projetos p
				JOIN users u ON u.id = p.owner_user_id
				WHERE p.id = ${projectId}
				LIMIT 1
			`

			return res.json({ ok: true, projeto: result?.[0] })
		} catch {
			return res.status(400).json({ ok: false, error: "DB_ERROR", message: "Não foi possível atualizar o projeto." })
		}
	}

	async remove(req, res) {
		const actorUserId = getUserId(req)
		const role = getRole(req)
		const projectId = String(req.params.id || "").trim()
		if (!isAdmin(role)) {
			return res.status(403).json({ ok: false, error: "FORBIDDEN", message: "Sem permissão." })
		}
		if (!actorUserId) {
			return res.status(401).json({ ok: false, error: "UNAUTHORIZED", message: "Token inválido ou expirado." })
		}
		if (!projectId) {
			return res.status(400).json({ ok: false, error: "VALIDATION_ERROR", message: "Projeto inválido." })
		}

		try {
			const rows = await sql`
				DELETE FROM projetos
				WHERE id = ${projectId}
				RETURNING id
			`
			if (!rows || rows.length === 0) {
				return res.status(404).json({ ok: false, error: "NOT_FOUND", message: "Projeto não encontrado." })
			}
			// Dependentes são removidos por ON DELETE CASCADE (orcamento_* e projeto_usuarios).
			return res.json({ ok: true })
		} catch {
			return res.status(400).json({ ok: false, error: "DB_ERROR", message: "Não foi possível excluir o projeto." })
		}
	}

	async listMembers(req, res) {
		const userId = getUserId(req)
		const role = getRole(req)
		const projectId = String(req.params.id || "").trim()
		if (!userId) {
			return res.status(401).json({ ok: false, error: "UNAUTHORIZED", message: "Token inválido ou expirado." })
		}
		const access = await canAccessProjeto({ projectId, userId, role })
		if (!access.ok) {
			return res.status(access.status).json({ ok: false, error: access.status === 404 ? "NOT_FOUND" : "FORBIDDEN", message: access.message })
		}

		try {
			const rows = await sql`
				SELECT
					pu.user_id AS "userId",
					COALESCE(NULLIF(u.name, ''), u.username) AS "nome",
					u.email,
					u.role AS "roleNum",
					pu.role AS "projectRole",
					pu.created_at AS "createdAt"
				FROM projeto_usuarios pu
				JOIN users u ON u.id = pu.user_id
				WHERE pu.projeto_id = ${projectId}
				ORDER BY pu.created_at DESC
			`
			return res.json({ ok: true, members: rows })
		} catch {
			return res.status(500).json({ ok: false, error: "DB_ERROR", message: "Erro ao consultar o banco." })
		}
	}

	async addMember(req, res) {
		const actorUserId = getUserId(req)
		const role = getRole(req)
		const projectId = String(req.params.id || "").trim()
		if (!isAdmin(role)) {
			return res.status(403).json({ ok: false, error: "FORBIDDEN", message: "Sem permissão." })
		}
		if (!actorUserId) {
			return res.status(401).json({ ok: false, error: "UNAUTHORIZED", message: "Token inválido ou expirado." })
		}

		const { userId, role: projectRole } = req.body || {}
		const memberUserId = String(userId || "").trim()
		const projectRoleStr = String(projectRole || "viewer").trim() || "viewer"
		if (!memberUserId) {
			return res.status(400).json({ ok: false, error: "VALIDATION_ERROR", message: "Usuário inválido." })
		}
		if (!projectId) {
			return res.status(400).json({ ok: false, error: "VALIDATION_ERROR", message: "Projeto inválido." })
		}

		try {
			const projectRows = await sql`SELECT id FROM projetos WHERE id = ${projectId} LIMIT 1`
			if (!projectRows || projectRows.length === 0) {
				return res.status(404).json({ ok: false, error: "NOT_FOUND", message: "Projeto não encontrado." })
			}
			const userRows = await sql`SELECT id FROM users WHERE id = ${memberUserId} LIMIT 1`
			if (!userRows || userRows.length === 0) {
				return res.status(400).json({ ok: false, error: "VALIDATION_ERROR", message: "Usuário inválido." })
			}

			await sql`
				INSERT INTO projeto_usuarios (projeto_id, user_id, role)
				VALUES (${projectId}, ${memberUserId}, ${projectRoleStr})
				ON CONFLICT (projeto_id, user_id)
				DO UPDATE SET role = EXCLUDED.role
			`
			return res.status(201).json({ ok: true })
		} catch {
			return res.status(400).json({ ok: false, error: "DB_ERROR", message: "Não foi possível adicionar o usuário ao projeto." })
		}
	}

	async removeMember(req, res) {
		const actorUserId = getUserId(req)
		const role = getRole(req)
		const projectId = String(req.params.id || "").trim()
		const memberUserId = String(req.params.userId || "").trim()
		if (!isAdmin(role)) {
			return res.status(403).json({ ok: false, error: "FORBIDDEN", message: "Sem permissão." })
		}
		if (!actorUserId) {
			return res.status(401).json({ ok: false, error: "UNAUTHORIZED", message: "Token inválido ou expirado." })
		}
		if (!projectId || !memberUserId) {
			return res.status(400).json({ ok: false, error: "VALIDATION_ERROR", message: "Parâmetros inválidos." })
		}

		try {
			const rows = await sql`
				DELETE FROM projeto_usuarios
				WHERE projeto_id = ${projectId} AND user_id = ${memberUserId}
				RETURNING user_id
			`
			if (!rows || rows.length === 0) {
				return res.status(404).json({ ok: false, error: "NOT_FOUND", message: "Vínculo não encontrado." })
			}
			return res.json({ ok: true })
		} catch {
			return res.status(400).json({ ok: false, error: "DB_ERROR", message: "Não foi possível remover o usuário do projeto." })
		}
	}

	async getDefault(req, res) {
		const userId = getUserId(req)
		if (!userId) {
			return res.status(401).json({ ok: false, error: "UNAUTHORIZED", message: "Token inválido ou expirado." })
		}

		try {
			// Busca projeto do cliente sem criar automaticamente
			const existing = await sql`
				SELECT 
					p.id,
					p.owner_user_id AS "ownerUserId",
					p.nome,
					p.is_default AS "isDefault"
				FROM projetos p
				WHERE p.owner_user_id = ${userId}
				ORDER BY p.is_default DESC, p.created_at ASC
				LIMIT 1
			`
			const projeto = existing?.[0] || null
			return res.json({ ok: true, projeto })
		} catch {
			return res.status(500).json({ ok: false, error: "DB_ERROR", message: "Erro ao consultar o banco." })
		}
	}

	async list(req, res) {
		const userId = getUserId(req)
		const role = getRole(req)
		if (!userId) {
			return res.status(401).json({ ok: false, error: "UNAUTHORIZED", message: "Token inválido ou expirado." })
		}

		try {
			const rows = isOperator(role)
				? await sql`
					SELECT
						p.id,
						p.nome,
						p.owner_user_id AS "ownerUserId",
						COALESCE(NULLIF(u.name, ''), u.username) AS "ownerNome",
						u.email AS "ownerEmail",
						p.created_at AS "createdAt"
					FROM projetos p
					JOIN users u ON u.id = p.owner_user_id
					ORDER BY p.created_at DESC
				`
				: await sql`
					SELECT
						p.id,
						p.nome,
						p.owner_user_id AS "ownerUserId",
						COALESCE(NULLIF(u.name, ''), u.username) AS "ownerNome",
						u.email AS "ownerEmail",
						p.created_at AS "createdAt"
					FROM projetos p
					JOIN users u ON u.id = p.owner_user_id
					WHERE p.owner_user_id = ${userId}
						OR EXISTS (
							SELECT 1 FROM projeto_usuarios pu
							WHERE pu.projeto_id = p.id AND pu.user_id = ${userId}
						)
					ORDER BY p.created_at DESC
				`

			return res.json({ ok: true, projetos: rows })
		} catch {
			return res.status(500).json({ ok: false, error: "DB_ERROR", message: "Erro ao consultar o banco." })
		}
	}

	async listServicos(req, res) {
		const userId = getUserId(req)
		const role = getRole(req)
		const projectId = String(req.params.id || "").trim()
		if (!userId) {
			return res.status(401).json({ ok: false, error: "UNAUTHORIZED", message: "Token inválido ou expirado." })
		}
		const access = await canAccessProjeto({ projectId, userId, role })
		if (!access.ok) {
			return res.status(access.status).json({ ok: false, error: access.status === 404 ? "NOT_FOUND" : "FORBIDDEN", message: access.message })
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
			return res.status(500).json({ ok: false, error: "DB_ERROR", message: "Erro ao consultar o banco." })
		}
	}

	async createServico(req, res) {
		const userId = getUserId(req)
		const role = getRole(req)
		const projectId = String(req.params.id || "").trim()
		if (!isAdmin(role)) {
			return res.status(403).json({ ok: false, error: "FORBIDDEN", message: "Sem permissão." })
		}
		if (!userId) {
			return res.status(401).json({ ok: false, error: "UNAUTHORIZED", message: "Token inválido ou expirado." })
		}

		// Admin pode criar em qualquer projeto, mas o projeto precisa existir
		const ownerUserId = await getProjetoOwner(projectId)
		if (!ownerUserId) {
			return res.status(404).json({ ok: false, error: "NOT_FOUND", message: "Projeto não encontrado." })
		}

		const { servico, custo } = req.body || {}
		const servicoStr = (servico || "").toString().trim()
		const custoNum = toNumber(custo)
		if (servicoStr.length < 2 || custoNum <= 0) {
			return res.status(400).json({ ok: false, error: "VALIDATION_ERROR", message: "Informe serviço e custo." })
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
			const createdServico = rows[0]

			// Enviar notificações por email
			try {
				// Buscar informações do projeto e do cliente (owner)
				const projectInfo = await sql`
					SELECT 
						p.nome AS "projetoNome",
						u.email AS "clienteEmail",
						COALESCE(NULLIF(u.name, ''), u.username) AS "clienteNome"
					FROM projetos p
					JOIN users u ON u.id = p.owner_user_id
					WHERE p.id = ${projectId}
					LIMIT 1
				`

				const projetoNome = projectInfo?.[0]?.projetoNome || "Projeto"
				const clienteEmail = projectInfo?.[0]?.clienteEmail ? String(projectInfo[0].clienteEmail).trim() : ""
				const clienteNome = projectInfo?.[0]?.clienteNome ? String(projectInfo[0].clienteNome).trim() : ""

				const mod = await import("../services/email/brevoEmail.js")

				// Enviar email para o cliente (dono do projeto)
				if (clienteEmail) {
					await mod.sendNovoServicoEmail({
						toEmail: clienteEmail,
						toName: clienteNome,
						codigo,
						servico: servicoStr,
						custo: custoNum,
						projetoNome,
						isAdmin: false,
					})
				}

				// Buscar todos os administradores (role >= 3)
				const admins = await sql`
					SELECT 
						email,
						COALESCE(NULLIF(name, ''), username) AS name
					FROM users
					WHERE role >= 3 AND email IS NOT NULL AND email != ''
				`

				// Enviar email para cada administrador
				for (const admin of admins) {
					const adminEmail = String(admin.email || "").trim()
					const adminNome = String(admin.name || "").trim()
					if (adminEmail) {
						await mod.sendNovoServicoEmail({
							toEmail: adminEmail,
							toName: adminNome,
							codigo,
							servico: servicoStr,
							custo: custoNum,
							projetoNome,
							isAdmin: true,
						})
					}
				}
			} catch (emailError) {
				// Log do erro mas não falha a requisição
				console.error("[createServico] Erro ao enviar emails de notificação:", emailError)
			}

			return res.status(201).json({ ok: true, servico: createdServico })
		} catch {
			return res.status(400).json({ ok: false, error: "DB_ERROR", message: "Não foi possível cadastrar o serviço." })
		}
	}

	async updateServico(req, res) {
		const userId = getUserId(req)
		const role = getRole(req)
		const projectId = String(req.params.id || "").trim()
		const { codigo } = req.params
		if (!userId) {
			return res.status(401).json({ ok: false, error: "UNAUTHORIZED", message: "Token inválido ou expirado." })
		}
		const codigoStr = String(codigo || "").trim()
		if (!codigoStr) {
			return res.status(400).json({ ok: false, error: "VALIDATION_ERROR", message: "Código inválido." })
		}

		const access = await canAccessProjeto({ projectId, userId, role })
		if (!access.ok) {
			return res.status(access.status).json({ ok: false, error: access.status === 404 ? "NOT_FOUND" : "FORBIDDEN", message: access.message })
		}

		const isAdm = isAdmin(role)
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
			feitoParsed = Boolean(feito)
		}
		const feitoValue = feitoParsed === undefined ? null : feitoParsed

		// Cliente não pode editar campos textuais/valor
		if (!isAdm && (servicoStr !== undefined || custoNum !== undefined)) {
			return res.status(403).json({ ok: false, error: "FORBIDDEN", message: "Sem permissão." })
		}
		if (servicoStr !== undefined && servicoStr.length < 2) {
			return res.status(400).json({ ok: false, error: "VALIDATION_ERROR", message: "Serviço inválido." })
		}
		if (custoNum !== undefined && custoNum <= 0) {
			return res.status(400).json({ ok: false, error: "VALIDATION_ERROR", message: "Custo inválido." })
		}
		if (aprovacaoStr !== undefined && !["aprovado", "negado", "pendente"].includes(aprovacaoStr)) {
			return res.status(400).json({ ok: false, error: "VALIDATION_ERROR", message: "Aprovação inválida." })
		}
		// Cliente só pode aprovar
		if (!isAdm && aprovacaoStr !== undefined && aprovacaoStr !== "aprovado") {
			return res.status(403).json({ ok: false, error: "FORBIDDEN", message: "Sem permissão." })
		}
		// Feito: somente admin/operador
		if (role < 2 && feitoProvided) {
			return res.status(403).json({ ok: false, error: "FORBIDDEN", message: "Sem permissão." })
		}
		// Reset (NULL) do feito: somente admin
		if (!isAdm && feitoProvided && feitoParsed === null) {
			return res.status(403).json({ ok: false, error: "FORBIDDEN", message: "Sem permissão." })
		}

		try {
			const currentRows = await sql`
				SELECT user_id, servico, custo, aprovacao, feito
				FROM orcamento_servicos
				WHERE codigo = ${codigoStr} AND project_id = ${projectId}
				LIMIT 1
			`
			if (!currentRows || currentRows.length === 0) {
				return res.status(404).json({ ok: false, error: "NOT_FOUND", message: "Serviço não encontrado." })
			}

			const prevAprovacao = String(currentRows[0].aprovacao)
			const prevFeito = currentRows[0].feito === true
			const ownerUserId = String(currentRows[0].user_id)

			// Cliente: aprovado uma vez, não volta atrás
			if (!isAdm && aprovacaoStr === "aprovado" && prevAprovacao === "aprovado") {
				return res.status(403).json({ ok: false, error: "FORBIDDEN", message: "Serviço já aprovado. Não é possível voltar atrás." })
			}
			const shouldClearAprovadoEm = prevAprovacao === "aprovado"

			let updated
			if (aprovacaoStr === undefined) {
				const rows = await sql`
					UPDATE orcamento_servicos
					SET
						servico = COALESCE(${isAdm ? servicoStr ?? null : null}, servico),
						custo = COALESCE(${isAdm ? custoNum ?? null : null}, custo),
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
						servico = COALESCE(${isAdm ? servicoStr ?? null : null}, servico),
						custo = COALESCE(${isAdm ? custoNum ?? null : null}, custo),
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
						servico = COALESCE(${isAdm ? servicoStr ?? null : null}, servico),
						custo = COALESCE(${isAdm ? custoNum ?? null : null}, custo),
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
				return res.status(404).json({ ok: false, error: "NOT_FOUND", message: "Serviço não encontrado." })
			}

			// Notificações: envia para o dono do registro (cliente) e administradores
			const newAprovacao = String(updated.aprovacao)
			const newFeito = updated.feito === true
			const shouldNotifyAprovado = prevAprovacao !== "aprovado" && newAprovacao === "aprovado"
			const shouldNotifyFeito = !prevFeito && newFeito

			if (shouldNotifyAprovado || shouldNotifyFeito) {
				try {
					// Buscar informações do projeto e do cliente (owner)
					const projectInfo = await sql`
						SELECT 
							p.nome AS "projetoNome",
							u.email AS "clienteEmail",
							COALESCE(NULLIF(u.name, ''), u.username) AS "clienteNome"
						FROM projetos p
						JOIN users u ON u.id = p.owner_user_id
						WHERE p.id = ${projectId}
						LIMIT 1
					`

					const projetoNome = projectInfo?.[0]?.projetoNome || "Projeto"
					const clienteEmail = projectInfo?.[0]?.clienteEmail ? String(projectInfo[0].clienteEmail).trim() : ""
					const clienteNome = projectInfo?.[0]?.clienteNome ? String(projectInfo[0].clienteNome).trim() : ""

					// Import lazy para evitar circular (mantém compat com orcamentosController)
					const mod = await import("../services/email/brevoEmail.js")

					// Enviar email para o cliente (dono do projeto)
					if (clienteEmail) {
						if (shouldNotifyAprovado) {
							await mod.sendOrcamentoAprovadoEmail({
								toEmail: clienteEmail,
								toName: clienteNome,
								codigo: codigoStr,
								servico: updated.servico,
								custo: updated.custo,
								projetoNome,
								isAdmin: false,
							})
						}
						if (shouldNotifyFeito) {
							await mod.sendServicoProntoEmail({
								toEmail: clienteEmail,
								toName: clienteNome,
								codigo: codigoStr,
								servico: updated.servico,
								projetoNome,
								isAdmin: false,
							})
						}
					}

					// Buscar todos os administradores (role >= 3)
					const admins = await sql`
						SELECT 
							email,
							COALESCE(NULLIF(name, ''), username) AS name
						FROM users
						WHERE role >= 3 AND email IS NOT NULL AND email != ''
					`

					// Enviar email para cada administrador
					for (const admin of admins) {
						const adminEmail = String(admin.email || "").trim()
						const adminNome = String(admin.name || "").trim()
						if (adminEmail) {
							if (shouldNotifyAprovado) {
								await mod.sendOrcamentoAprovadoEmail({
									toEmail: adminEmail,
									toName: adminNome,
									codigo: codigoStr,
									servico: updated.servico,
									custo: updated.custo,
									projetoNome,
									isAdmin: true,
								})
							}
							if (shouldNotifyFeito) {
								await mod.sendServicoProntoEmail({
									toEmail: adminEmail,
									toName: adminNome,
									codigo: codigoStr,
									servico: updated.servico,
									projetoNome,
									isAdmin: true,
								})
							}
						}
					}
				} catch (emailError) {
					// Log do erro mas não falha a requisição
					console.error("[updateServico] Erro ao enviar emails de notificação:", emailError)
				}
			}

			return res.json({ ok: true, servico: updated })
		} catch (err) {
			const details = process.env.NODE_ENV === "production" ? undefined : String(err?.message || err)
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
		const projectId = String(req.params.id || "").trim()
		const { codigo } = req.params
		if (!isAdmin(role)) {
			return res.status(403).json({ ok: false, error: "FORBIDDEN", message: "Sem permissão." })
		}
		if (!userId) {
			return res.status(401).json({ ok: false, error: "UNAUTHORIZED", message: "Token inválido ou expirado." })
		}
		const codigoStr = String(codigo || "").trim()
		if (!codigoStr) {
			return res.status(400).json({ ok: false, error: "VALIDATION_ERROR", message: "Código inválido." })
		}

		// Admin pode excluir em qualquer projeto, mas garante existência do registro no projeto
		try {
			const rows = await sql`
				DELETE FROM orcamento_servicos
				WHERE codigo = ${codigoStr} AND project_id = ${projectId}
				RETURNING codigo AS id
			`
			if (!rows || rows.length === 0) {
				return res.status(404).json({ ok: false, error: "NOT_FOUND", message: "Serviço não encontrado." })
			}
			return res.json({ ok: true })
		} catch {
			return res.status(400).json({ ok: false, error: "DB_ERROR", message: "Não foi possível excluir o serviço." })
		}
	}

	async listPagamentos(req, res) {
		const userId = getUserId(req)
		const role = getRole(req)
		const projectId = String(req.params.id || "").trim()
		if (!userId) {
			return res.status(401).json({ ok: false, error: "UNAUTHORIZED", message: "Token inválido ou expirado." })
		}
		const access = await canAccessProjeto({ projectId, userId, role })
		if (!access.ok) {
			return res.status(access.status).json({ ok: false, error: access.status === 404 ? "NOT_FOUND" : "FORBIDDEN", message: access.message })
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
		} catch {
			return res.status(500).json({ ok: false, error: "DB_ERROR", message: "Erro ao consultar o banco." })
		}
	}

	async createPagamento(req, res) {
		const userId = getUserId(req)
		const role = getRole(req)
		const projectId = String(req.params.id || "").trim()
		if (!isAdmin(role)) {
			return res.status(403).json({ ok: false, error: "FORBIDDEN", message: "Sem permissão." })
		}
		if (!userId) {
			return res.status(401).json({ ok: false, error: "UNAUTHORIZED", message: "Token inválido ou expirado." })
		}

		const ownerUserId = await getProjetoOwner(projectId)
		if (!ownerUserId) {
			return res.status(404).json({ ok: false, error: "NOT_FOUND", message: "Projeto não encontrado." })
		}

		const { data, valor, comprovante } = req.body || {}
		const dataStr = (data || "").toString().trim()
		const valorNum = toNumber(valor)
		if (!dataStr || valorNum <= 0) {
			return res.status(400).json({ ok: false, error: "VALIDATION_ERROR", message: "Informe data e valor." })
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
			return res.status(400).json({ ok: false, error: "VALIDATION_ERROR", message: "Comprovante inválido. Envie uma URL do Blob Storage (não base64)." })
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
		} catch {
			return res.status(400).json({ ok: false, error: "DB_ERROR", message: "Não foi possível lançar o pagamento." })
		}
	}

	async updatePagamento(req, res) {
		const userId = getUserId(req)
		const role = getRole(req)
		const projectId = String(req.params.id || "").trim()
		const { codigo } = req.params
		if (!isAdmin(role)) {
			return res.status(403).json({ ok: false, error: "FORBIDDEN", message: "Sem permissão." })
		}
		if (!userId) {
			return res.status(401).json({ ok: false, error: "UNAUTHORIZED", message: "Token inválido ou expirado." })
		}
		const codigoStr = String(codigo || "").trim()
		if (!codigoStr) {
			return res.status(400).json({ ok: false, error: "VALIDATION_ERROR", message: "Código inválido." })
		}

		const { data, valor, comprovante } = req.body || {}
		const dataStr = data === undefined ? undefined : (data || "").toString().trim()
		const valorNum = valor === undefined ? undefined : toNumber(valor)

		if (dataStr !== undefined && !dataStr) {
			return res.status(400).json({ ok: false, error: "VALIDATION_ERROR", message: "Data inválida." })
		}
		if (valorNum !== undefined && valorNum <= 0) {
			return res.status(400).json({ ok: false, error: "VALIDATION_ERROR", message: "Valor inválido." })
		}

		const comp = comprovante && typeof comprovante === "object" ? comprovante : null
		const compNome = comp ? (comp.name || "").toString() : undefined
		const compTipo = comp ? (comp.type || "").toString() : undefined
		const compTamanho = comp ? Number(comp.size) : undefined
		const compUrl = comp ? (comp.url ?? comp.dataUrl ?? "").toString() : undefined
		const compPathname = comp ? (comp.pathname ?? "").toString() : undefined

		if (compUrl !== undefined && compUrl && isDataUrl(compUrl)) {
			return res.status(400).json({ ok: false, error: "VALIDATION_ERROR", message: "Comprovante inválido. Envie uma URL do Blob Storage (não base64)." })
		}

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
				return res.status(404).json({ ok: false, error: "NOT_FOUND", message: "Pagamento não encontrado." })
			}
			return res.json({ ok: true, pagamento: rows[0] })
		} catch {
			return res.status(400).json({ ok: false, error: "DB_ERROR", message: "Não foi possível atualizar o pagamento." })
		}
	}

	async deletePagamento(req, res) {
		const userId = getUserId(req)
		const role = getRole(req)
		const projectId = String(req.params.id || "").trim()
		const { codigo } = req.params
		if (!isAdmin(role)) {
			return res.status(403).json({ ok: false, error: "FORBIDDEN", message: "Sem permissão." })
		}
		if (!userId) {
			return res.status(401).json({ ok: false, error: "UNAUTHORIZED", message: "Token inválido ou expirado." })
		}
		const codigoStr = String(codigo || "").trim()
		if (!codigoStr) {
			return res.status(400).json({ ok: false, error: "VALIDATION_ERROR", message: "Código inválido." })
		}

		try {
			const rows = await sql`
				DELETE FROM orcamento_pagamentos
				WHERE codigo = ${codigoStr} AND project_id = ${projectId}
				RETURNING codigo AS id
			`
			if (!rows || rows.length === 0) {
				return res.status(404).json({ ok: false, error: "NOT_FOUND", message: "Pagamento não encontrado." })
			}
			return res.json({ ok: true })
		} catch {
			return res.status(400).json({ ok: false, error: "DB_ERROR", message: "Não foi possível excluir o pagamento." })
		}
	}
}
