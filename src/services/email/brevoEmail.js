import nodemailer from "nodemailer"

let cachedTransporter = null
let warnedMisconfig = false

const truthy = (v) => {
	const s = String(v ?? "").trim().toLowerCase()
	return s === "1" || s === "true" || s === "yes" || s === "y" || s === "on"
}

const isDebugEnabled = () => truthy(process.env.EMAIL_DEBUG)

const logDebug = (...args) => {
	if (!isDebugEnabled()) return
	console.log("[email:debug]", ...args)
}

const isEmailEnabled = () => {
	const raw = process.env.EMAIL_ENABLED
	if (raw === undefined) return true
	return truthy(raw)
}

const getConfig = () => {
	const host = String(process.env.BREVO_SMTP_HOST || "").trim()
	const port = Number(process.env.BREVO_SMTP_PORT || 587)
	const user = String(process.env.BREVO_SMTP_USER || "").trim()
	const pass = String(process.env.BREVO_SMTP_PASS || "").trim()
	const fromEmail = String(process.env.EMAIL_FROM || "").trim()
	const fromName = String(process.env.EMAIL_FROM_NAME || "").trim()

	return { host, port, user, pass, fromEmail, fromName }
}

const getTransporter = () => {
	if (!isEmailEnabled()) return null
	if (cachedTransporter) return cachedTransporter

	const { host, port, user, pass, fromEmail } = getConfig()
	logDebug("config", {
		host: host || null,
		port: Number.isFinite(port) ? port : null,
		user: user ? `${user.slice(0, 2)}***${user.slice(-2)}` : null,
		fromEmail: fromEmail || null,
	})
	const missing = []
	if (!host) missing.push("BREVO_SMTP_HOST")
	if (!port) missing.push("BREVO_SMTP_PORT")
	if (!user) missing.push("BREVO_SMTP_USER")
	if (!pass) missing.push("BREVO_SMTP_PASS")
	if (!fromEmail) missing.push("EMAIL_FROM")
	if (missing.length > 0) {
		if (!warnedMisconfig) {
			warnedMisconfig = true
			console.warn(
				`[email] Email desabilitado: variáveis ausentes (${missing.join(", ")}).`,
			)
		}
		logDebug("skip", { reason: "MISSING_ENV", missing })
		return null
	}

	cachedTransporter = nodemailer.createTransport({
		host,
		port,
		secure: false,
		requireTLS: true,
		auth: { user, pass },
	})

	logDebug("transporter_created")

	return cachedTransporter
}

const buildFrom = () => {
	const { fromEmail, fromName } = getConfig()
	return fromName ? `${fromName} <${fromEmail}>` : fromEmail
}

export const sendEmail = async ({ to, subject, text, html }) => {
	const transporter = getTransporter()
	if (!isEmailEnabled()) {
		logDebug("skip", { reason: "EMAIL_DISABLED" })
		return { ok: false, skipped: true, reason: "EMAIL_DISABLED" }
	}
	if (!transporter) {
		logDebug("skip", { reason: "NO_TRANSPORTER" })
		return { ok: false, skipped: true, reason: "NO_TRANSPORTER" }
	}

	logDebug("send_attempt", {
		to: String(to || ""),
		subject: String(subject || ""),
		hasHtml: Boolean(html),
		hasText: Boolean(text),
	})

	try {
		const info = await transporter.sendMail({
			from: buildFrom(),
			to,
			subject,
			text,
			html,
		})
		logDebug("send_success", {
			messageId: info?.messageId || null,
			accepted: info?.accepted || null,
			rejected: info?.rejected || null,
			response: info?.response || null,
		})
		return { ok: true, info }
	} catch (err) {
		console.error("[email] Falha ao enviar email", {
			message: err?.message || String(err),
			code: err?.code,
			response: err?.response,
			responseCode: err?.responseCode,
			command: err?.command,
		})
		logDebug("send_failure_raw", err)
		return { ok: false, error: err, message: err?.message }
	}
}

export const sendOrcamentoAprovadoEmail = async ({ toEmail, toName, codigo, servico, custo, projetoNome, isAdmin = false }) => {
	const subject = isAdmin
		? `Orçamento aprovado pelo cliente - Projeto: ${projetoNome || codigo}`
		: `Orçamento aprovado: ${codigo}`
	const nome = String(toName || "").trim()
	const greeting = nome ? `Olá, ${nome}!` : "Olá!"
	const custoFmt =
		custo === undefined || custo === null
			? ""
			: `\nValor: R$ ${Number(custo).toFixed(2).replace(".", ",")}`

	const introText = isAdmin
		? "O cliente aprovou o orçamento do serviço"
		: "Recebemos a aprovação do orçamento do serviço"

	const projetoInfo = projetoNome && isAdmin ? `\n- Projeto: ${projetoNome}` : ""
	const projetoHtml = projetoNome && isAdmin ? `<li><strong>Projeto:</strong> ${projetoNome}</li>` : ""

	const text = `${greeting}\n\n${introText}:${projetoInfo}\n- Código: ${codigo}\n- Serviço: ${servico || "(não informado)"}${custoFmt}\n\nEm caso de dúvidas, responda este email.`
	const html = `<p>${greeting}</p><p>${introText}:</p><ul>${projetoHtml}<li><strong>Código:</strong> ${codigo}</li><li><strong>Serviço:</strong> ${servico || "(não informado)"}</li>${
		custo === undefined || custo === null
			? ""
			: `<li><strong>Valor:</strong> R$ ${Number(custo).toFixed(2).replace(".", ",")}</li>`
	}</ul><p>Em caso de dúvidas, responda este email.</p>`

	return sendEmail({
		to: nome ? `${nome} <${toEmail}>` : toEmail,
		subject,
		text,
		html,
	})
}

export const sendServicoProntoEmail = async ({ toEmail, toName, codigo, servico, projetoNome, isAdmin = false }) => {
	const subject = isAdmin
		? `Serviço concluído - Projeto: ${projetoNome || codigo}`
		: `Serviço pronto: ${codigo}`
	const nome = String(toName || "").trim()
	const greeting = nome ? `Olá, ${nome}!` : "Olá!"

	const introText = isAdmin
		? "Um serviço foi marcado como pronto"
		: "Seu serviço foi marcado como pronto"

	const projetoInfo = projetoNome && isAdmin ? `\n- Projeto: ${projetoNome}` : ""
	const projetoHtml = projetoNome && isAdmin ? `<li><strong>Projeto:</strong> ${projetoNome}</li>` : ""

	const text = `${greeting}\n\n${introText}:${projetoInfo}\n- Código: ${codigo}\n- Serviço: ${servico || "(não informado)"}\n\nEm caso de dúvidas, responda este email.`
	const html = `<p>${greeting}</p><p>${introText}:</p><ul>${projetoHtml}<li><strong>Código:</strong> ${codigo}</li><li><strong>Serviço:</strong> ${servico || "(não informado)"}</li></ul><p>Em caso de dúvidas, responda este email.</p>`

	return sendEmail({
		to: nome ? `${nome} <${toEmail}>` : toEmail,
		subject,
		text,
		html,
	})
}

export const sendNovoServicoEmail = async ({ toEmail, toName, codigo, servico, custo, projetoNome, isAdmin = false }) => {
	const subject = isAdmin 
		? `Novo serviço cadastrado no projeto: ${projetoNome}` 
		: `Novo serviço cadastrado no seu projeto: ${projetoNome}`
	const nome = String(toName || "").trim()
	const greeting = nome ? `Olá, ${nome}!` : "Olá!"
	const custoFmt =
		custo === undefined || custo === null
			? ""
			: `\nValor: R$ ${Number(custo).toFixed(2).replace(".", ",")}`

	const introText = isAdmin 
		? "Um novo serviço foi cadastrado no sistema"
		: "Um novo serviço foi cadastrado no seu projeto"

	const text = `${greeting}\n\n${introText}:\n- Projeto: ${projetoNome}\n- Código: ${codigo}\n- Serviço: ${servico || "(não informado)"}${custoFmt}\n\nAguardando aprovação do cliente.\n\nEm caso de dúvidas, responda este email.`
	const html = `<p>${greeting}</p><p>${introText}:</p><ul><li><strong>Projeto:</strong> ${projetoNome}</li><li><strong>Código:</strong> ${codigo}</li><li><strong>Serviço:</strong> ${servico || "(não informado)"}</li>${
		custo === undefined || custo === null
			? ""
			: `<li><strong>Valor:</strong> R$ ${Number(custo).toFixed(2).replace(".", ",")}</li>`
	}</ul><p>Aguardando aprovação do cliente.</p><p>Em caso de dúvidas, responda este email.</p>`

	return sendEmail({
		to: nome ? `${nome} <${toEmail}>` : toEmail,
		subject,
		text,
		html,
	})
}
