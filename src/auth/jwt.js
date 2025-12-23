import jwt from "jsonwebtoken"

const getJwtSecret = () => {
	const secret = process.env.JWT_SECRET
	if (!secret) throw Object.assign(new Error("JWT_SECRET não definido"), { code: "JWT_CONFIG" })
	return secret
}

export const signAccessToken = (payload, options = {}) => {
	const expiresIn = options.expiresIn || process.env.JWT_EXPIRES_IN || "7d"
	return jwt.sign(payload, getJwtSecret(), { expiresIn })
}

export const verifyAccessToken = (token) => {
	return jwt.verify(token, getJwtSecret())
}
