import crypto from "node:crypto"
import { sql } from "../db/db.js"

/**
 * Serviço de auditoria — registra logs e dispara emails de notificação
 * para todas as operações críticas do portal.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const formatBRL = (value) => {
	const num = Number(value)
	if (!Number.isFinite(num)) return "R$ 0,00"
	return num.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
}

const formatDateTimeBR = (date) => {
	const d = date instanceof Date ? date : new Date(date || Date.now())
	if (Number.isNaN(d.getTime())) return new Date().toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "medium" })
	return d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "medium" })
}

const maskEmail = (email) => {
	const s = String(email || "").trim()
	const at = s.indexOf("@")
	if (at <= 1) return s ? "***" : ""
	const local = s.slice(0, at)
	const domain = s.slice(at + 1)
	return `${local[0]}***@${domain}`
}

// ---------------------------------------------------------------------------
// IP Geolocation (best-effort, free API)
// ---------------------------------------------------------------------------

const ipLocationCache = new Map()

export const getIpLocation = async (ip) => {
	if (!ip || ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1") {
		return "Localhost"
	}

	// Strip ::ffff: prefix
	const cleanIp = ip.replace(/^::ffff:/, "")

	if (ipLocationCache.has(cleanIp)) return ipLocationCache.get(cleanIp)

	try {
		const controller = new AbortController()
		const timeout = setTimeout(() => controller.abort(), 3000)
		const res = await fetch(`http://ip-api.com/json/${cleanIp}?fields=status,country,regionName,city,isp&lang=pt-BR`, {
			signal: controller.signal,
		})
		clearTimeout(timeout)

		if (!res.ok) return "Desconhecida"
		const data = await res.json()
		if (data.status !== "success") return "Desconhecida"

		const parts = [data.city, data.regionName, data.country].filter(Boolean)
		const location = parts.join(", ") || "Desconhecida"
		if (data.isp) {
			const full = `${location} (${data.isp})`
			ipLocationCache.set(cleanIp, full)
			return full
		}
		ipLocationCache.set(cleanIp, location)
		return location
	} catch {
		return "Desconhecida"
	}
}

// ---------------------------------------------------------------------------
// Extract request metadata
// ---------------------------------------------------------------------------

export const extractAuditMeta = (req) => {
	const forwarded = String(req?.headers?.["x-forwarded-for"] || "").split(",")[0].trim()
	const ip = forwarded || req?.ip || req?.socket?.remoteAddress || "desconhecido"
	const userAgent = String(req?.headers?.["user-agent"] || "desconhecido")
	return { ip, userAgent }
}

// ---------------------------------------------------------------------------
// Persist audit log
// ---------------------------------------------------------------------------

export const createAuditLog = async ({
	action,
	entityType,
	entityId,
	projectId,
	actorUserId,
	actorName,
	actorEmail,
	actorRole,
	targetUserId,
	targetName,
	targetEmail,
	ip,
	ipLocation,
	userAgent,
	oldValue,
	newValue,
	metadata,
	emailSent = false,
	emailError = null,
	transactionId = null,
}) => {
	const txId = transactionId || crypto.randomUUID()
	try {
		const rows = await sql`
			INSERT INTO audit_log (
				transaction_id, action, entity_type, entity_id, project_id,
				actor_user_id, actor_name, actor_email, actor_role,
				target_user_id, target_name, target_email,
				ip_address, ip_location, user_agent,
				old_value, new_value, metadata,
				email_sent, email_error
			) VALUES (
				${txId}, ${action}, ${entityType}, ${entityId || null}, ${projectId || null},
				${actorUserId}, ${actorName || null}, ${actorEmail || null}, ${actorRole ?? null},
				${targetUserId || null}, ${targetName || null}, ${targetEmail || null},
				${ip || null}, ${ipLocation || null}, ${userAgent || null},
				${oldValue ? JSON.stringify(oldValue) : null}::jsonb,
				${newValue ? JSON.stringify(newValue) : null}::jsonb,
				${metadata ? JSON.stringify(metadata) : null}::jsonb,
				${emailSent}, ${emailError || null}
			)
			RETURNING id, transaction_id AS "transactionId"
		`
		return { ok: true, id: rows?.[0]?.id, transactionId: rows?.[0]?.transactionId || txId }
	} catch (err) {
		console.error("[audit] Erro ao registrar log de auditoria:", err)
		return { ok: false, transactionId: txId, error: err?.message }
	}
}

// ---------------------------------------------------------------------------
// Get actor info from DB
// ---------------------------------------------------------------------------

export const getActorInfo = async (userId) => {
	if (!userId) return { name: null, email: null }
	try {
		const rows = await sql`
			SELECT
				COALESCE(NULLIF(name, ''), username) AS name,
				email,
				role
			FROM users
			WHERE id = ${userId}
			LIMIT 1
		`
		if (!rows || rows.length === 0) return { name: null, email: null, role: null }
		return {
			name: String(rows[0].name || "").trim() || null,
			email: String(rows[0].email || "").trim() || null,
			role: rows[0].role != null ? Number(rows[0].role) : null,
		}
	} catch {
		return { name: null, email: null, role: null }
	}
}

export const getAdminEmails = async () => {
	try {
		const rows = await sql`
			SELECT
				id,
				COALESCE(NULLIF(name, ''), username) AS name,
				email
			FROM users
			WHERE role >= 3 AND email IS NOT NULL AND email != ''
		`
		return (rows || []).map((r) => ({
			id: String(r.id),
			name: String(r.name || "").trim(),
			email: String(r.email || "").trim(),
		}))
	} catch {
		return []
	}
}

export const getProjectInfo = async (projectId) => {
	if (!projectId) return null
	try {
		const rows = await sql`
			SELECT
				p.id,
				p.nome,
				p.owner_user_id AS "ownerUserId",
				COALESCE(NULLIF(u.name, ''), u.username) AS "ownerNome",
				u.email AS "ownerEmail"
			FROM projetos p
			JOIN users u ON u.id = p.owner_user_id
			WHERE p.id = ${projectId}
			LIMIT 1
		`
		return rows?.[0] || null
	} catch {
		return null
	}
}

// ---------------------------------------------------------------------------
// Action labels for emails (Portuguese)
// ---------------------------------------------------------------------------

const actionLabels = {
	"servico.aprovado": "Aprovação de serviço",
	"servico.aprovacao_desfeita": "Desfazimento de aprovação",
	"servico.reprovado": "Reprovação de serviço",
	"servico.valor_alterado": "Alteração de valor do serviço",
	"servico.nome_alterado": "Alteração de nome do serviço",
	"servico.editado": "Edição de serviço",
	"servico.feito": "Serviço marcado como feito",
	"servico.nao_feito": "Serviço marcado como não feito",
	"servico.reset_aprovacao": "Reset de aprovação",
	"servico.reset_feito": "Reset de status feito",
}

const getActionLabel = (action) => actionLabels[action] || action

// ---------------------------------------------------------------------------
// Audit email HTML builder
// ---------------------------------------------------------------------------

const buildAuditEmailHtml = ({
	actionLabel,
	greeting,
	introText,
	details,
	timestamp,
	transactionId,
	actorName,
	ip,
	ipLocation,
	userAgent,
}) => {
	const detailRows = details
		.filter((d) => d.value !== undefined && d.value !== null && d.value !== "")
		.map(
			(d) => `
			<table role="presentation" style="width: 100%; border-collapse: collapse; margin-bottom: 12px;">
				<tr>
					<td style="padding: 0; width: 160px; vertical-align: top;">
						<p style="margin: 0; color: #6b7280; font-size: 13px; font-weight: 500;">${d.label}:</p>
					</td>
					<td style="padding: 0;">
						<p style="margin: 0; color: ${d.color || "#111827"}; font-size: 14px; font-weight: ${d.bold ? "700" : "400"};">${d.value}</p>
					</td>
				</tr>
			</table>`,
		)
		.join("")

	return `
		<!DOCTYPE html>
		<html>
		<head>
			<meta charset="UTF-8">
			<meta name="viewport" content="width=device-width, initial-scale=1.0">
		</head>
		<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f5f5f5;">
			<table role="presentation" style="width: 100%; border-collapse: collapse; background-color: #f5f5f5; padding: 40px 20px;">
				<tr>
					<td align="center">
						<table role="presentation" style="width: 100%; max-width: 640px; border-collapse: collapse; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
							<!-- Header -->
							<tr>
								<td style="background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%); padding: 24px 30px; border-radius: 8px 8px 0 0;">
									<h1 style="margin: 0; color: #ffffff; font-size: 20px; font-weight: 600;">🔒 Registro de Auditoria</h1>
									<p style="margin: 6px 0 0 0; color: #e0e7ff; font-size: 14px;">${actionLabel}</p>
								</td>
							</tr>
							
							<!-- Saudação -->
							<tr>
								<td style="padding: 24px 30px 16px 30px;">
									<p style="margin: 0; color: #374151; font-size: 15px;">${greeting}</p>
									<p style="margin: 10px 0 0 0; color: #6b7280; font-size: 14px; line-height: 1.5;">${introText}</p>
								</td>
							</tr>
							
							<!-- Card de detalhes -->
							<tr>
								<td style="padding: 0 30px 20px 30px;">
									<table role="presentation" style="width: 100%; border-collapse: collapse; background-color: #f9fafb; border-radius: 6px; border: 1px solid #e5e7eb;">
										<tr>
											<td style="padding: 16px 20px;">
												${detailRows}
											</td>
										</tr>
									</table>
								</td>
							</tr>

							<!-- Dados de auditoria -->
							<tr>
								<td style="padding: 0 30px 20px 30px;">
									<p style="margin: 0 0 8px 0; color: #374151; font-size: 13px; font-weight: 600;">Dados de Auditoria</p>
									<table role="presentation" style="width: 100%; border-collapse: collapse; background-color: #fef3c7; border-radius: 6px; border: 1px solid #fde68a;">
										<tr>
											<td style="padding: 14px 16px;">
												<table role="presentation" style="width: 100%; border-collapse: collapse;">
													<tr>
														<td style="padding: 2px 0; width: 140px;"><p style="margin: 0; color: #92400e; font-size: 12px;">ID da transação:</p></td>
														<td style="padding: 2px 0;"><p style="margin: 0; color: #78350f; font-size: 12px; font-family: monospace;">${transactionId}</p></td>
													</tr>
													<tr>
														<td style="padding: 2px 0;"><p style="margin: 0; color: #92400e; font-size: 12px;">Realizado por:</p></td>
														<td style="padding: 2px 0;"><p style="margin: 0; color: #78350f; font-size: 12px;">${actorName || "—"}</p></td>
													</tr>
													<tr>
														<td style="padding: 2px 0;"><p style="margin: 0; color: #92400e; font-size: 12px;">Data/Hora:</p></td>
														<td style="padding: 2px 0;"><p style="margin: 0; color: #78350f; font-size: 12px;">${timestamp}</p></td>
													</tr>
													<tr>
														<td style="padding: 2px 0;"><p style="margin: 0; color: #92400e; font-size: 12px;">IP:</p></td>
														<td style="padding: 2px 0;"><p style="margin: 0; color: #78350f; font-size: 12px;">${ip || "—"}</p></td>
													</tr>
													<tr>
														<td style="padding: 2px 0;"><p style="margin: 0; color: #92400e; font-size: 12px;">Localização:</p></td>
														<td style="padding: 2px 0;"><p style="margin: 0; color: #78350f; font-size: 12px;">${ipLocation || "—"}</p></td>
													</tr>
													<tr>
														<td style="padding: 2px 0; vertical-align: top;"><p style="margin: 0; color: #92400e; font-size: 12px;">Dispositivo:</p></td>
														<td style="padding: 2px 0;"><p style="margin: 0; color: #78350f; font-size: 11px; word-break: break-all;">${userAgent || "—"}</p></td>
													</tr>
												</table>
											</td>
										</tr>
									</table>
								</td>
							</tr>
							
							<!-- Footer -->
							<tr>
								<td style="padding: 16px 30px; background-color: #f9fafb; border-radius: 0 0 8px 8px; border-top: 1px solid #e5e7eb;">
									<p style="margin: 0; color: #6b7280; font-size: 12px; text-align: center; line-height: 1.6;">
										Este registro foi gerado automaticamente para fins de auditoria e transparência.<br>
										<span style="color: #9ca3af;">Guarde este e-mail como comprovante. Em caso de dúvidas, responda a mensagem.</span>
									</p>
								</td>
							</tr>
						</table>
					</td>
				</tr>
			</table>
		</body>
		</html>
	`
}

const buildAuditEmailText = ({
	actionLabel,
	greeting,
	introText,
	details,
	timestamp,
	transactionId,
	actorName,
	ip,
	ipLocation,
	userAgent,
}) => {
	const detailLines = details
		.filter((d) => d.value !== undefined && d.value !== null && d.value !== "")
		.map((d) => `${d.label}: ${d.value}`)
		.join("\n")

	return `${greeting}\n\n${introText}\n\n${detailLines}\n\n--- Dados de Auditoria ---\nID da transação: ${transactionId}\nRealizado por: ${actorName || "—"}\nData/Hora: ${timestamp}\nIP: ${ip || "—"}\nLocalização: ${ipLocation || "—"}\nDispositivo: ${userAgent || "—"}\n\nEste registro foi gerado automaticamente para fins de auditoria e transparência.\nGuarde este e-mail como comprovante.`
}

// ---------------------------------------------------------------------------
// Unified audit + notify
// ---------------------------------------------------------------------------

/**
 * Registra a ação na tabela de auditoria e envia emails para o cliente e admin.
 *
 * @param {object} opts
 * @param {string} opts.action - Ex: 'servico.aprovado'
 * @param {string} opts.entityType
 * @param {string} opts.entityId
 * @param {string} opts.projectId
 * @param {object} opts.actor - { userId, name, email, role }
 * @param {object} opts.target - { userId, name, email } (cliente)
 * @param {string} opts.ip
 * @param {string} opts.userAgent
 * @param {object} opts.oldValue
 * @param {object} opts.newValue
 * @param {object} opts.metadata - { projetoNome, ... }
 * @param {Array} opts.emailDetails - [{ label, value, color?, bold? }]
 * @param {string} [opts.emailSubject]
 */
export const auditAndNotify = async (opts) => {
	const {
		action,
		entityType,
		entityId,
		projectId,
		actor,
		target,
		ip,
		userAgent,
		oldValue,
		newValue,
		metadata,
		emailDetails = [],
		emailSubject,
	} = opts

	const transactionId = crypto.randomUUID()
	const timestamp = formatDateTimeBR(new Date())
	const actionLabel = getActionLabel(action)

	// IP geolocation (best-effort)
	const ipLocation = await getIpLocation(ip)

	// Persist audit log
	const logResult = await createAuditLog({
		action,
		entityType,
		entityId,
		projectId,
		actorUserId: actor?.userId,
		actorName: actor?.name,
		actorEmail: actor?.email,
		actorRole: actor?.role,
		targetUserId: target?.userId,
		targetName: target?.name,
		targetEmail: target?.email,
		ip,
		ipLocation,
		userAgent,
		oldValue,
		newValue,
		metadata,
		transactionId,
	})

	console.log("[audit]", {
		action,
		entityId,
		transactionId,
		actorName: actor?.name,
		ip,
		ipLocation,
	})

	// Send emails (non-blocking, don't fail the request)
	const emailErrors = []

	try {
		const { sendEmail } = await import("./email/brevoEmail.js")

		const subject = emailSubject || `[Auditoria] ${actionLabel} — ${entityId || entityType}`

		// Build common email parts
		const commonParts = {
			actionLabel,
			timestamp,
			transactionId,
			actorName: actor?.name || "Desconhecido",
			ip,
			ipLocation,
			userAgent,
		}

		// 1) Email to the client (target)
		if (target?.email) {
			const greeting = target.name ? `Olá, ${target.name}!` : "Olá!"
			const introText = `Uma operação foi realizada no seu projeto${metadata?.projetoNome ? ` "${metadata.projetoNome}"` : ""}.`

			const html = buildAuditEmailHtml({
				...commonParts,
				greeting,
				introText,
				details: emailDetails,
			})
			const text = buildAuditEmailText({
				...commonParts,
				greeting,
				introText,
				details: emailDetails,
			})

			const r = await sendEmail({ to: target.name ? `${target.name} <${target.email}>` : target.email, subject, text, html })
			if (!r?.ok && !r?.skipped) {
				emailErrors.push(`cliente(${maskEmail(target.email)}): ${r?.message || "falha"}`)
			}
		}

		// 2) Email to all admins
		const admins = await getAdminEmails()
		for (const admin of admins) {
			// Don't send duplicate if admin IS the target
			if (admin.email === target?.email) continue

			const greeting = admin.name ? `Olá, ${admin.name}!` : "Olá!"
			const introText = `Uma operação foi registrada no sistema${metadata?.projetoNome ? ` (Projeto: ${metadata.projetoNome})` : ""}.`

			const html = buildAuditEmailHtml({
				...commonParts,
				greeting,
				introText,
				details: emailDetails,
			})
			const text = buildAuditEmailText({
				...commonParts,
				greeting,
				introText,
				details: emailDetails,
			})

			const r = await sendEmail({ to: admin.name ? `${admin.name} <${admin.email}>` : admin.email, subject, text, html })
			if (!r?.ok && !r?.skipped) {
				emailErrors.push(`admin(${maskEmail(admin.email)}): ${r?.message || "falha"}`)
			}
		}
	} catch (err) {
		console.error("[audit:email]", err)
		emailErrors.push(String(err?.message || err))
	}

	// Update audit log with email status
	if (logResult?.id) {
		try {
			await sql`
				UPDATE audit_log
				SET
					email_sent = ${emailErrors.length === 0},
					email_error = ${emailErrors.length > 0 ? emailErrors.join("; ") : null},
					ip_location = ${ipLocation}
				WHERE id = ${logResult.id}
			`
		} catch {
			// ignore
		}
	}

	return {
		transactionId,
		ipLocation,
		emailErrors,
	}
}
