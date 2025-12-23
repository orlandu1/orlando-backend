import { verifyAccessToken } from "../auth/jwt.js"

export const authRequired = (req, res, next) => {
	const header = String(req.headers.authorization || "")
	const [type, token] = header.split(" ")

	if (type !== "Bearer" || !token) {
		return res.status(401).json({
			ok: false,
			error: "UNAUTHORIZED",
			message: "Token ausente.",
		})
	}

	try {
		const payload = verifyAccessToken(token)
		req.auth = payload
		return next()
	} catch {
		return res.status(401).json({
			ok: false,
			error: "UNAUTHORIZED",
			message: "Token inválido ou expirado.",
		})
	}
}
