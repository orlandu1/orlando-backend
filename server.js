import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

import apiRoutes from './src/routes/index.js';

dotenv.config();

const app = express();

app.disable('x-powered-by');

app.use(
	cors({
		origin: process.env.CORS_ORIGIN || '*',
	}),
);
app.use(express.json({ limit: '5mb' }));

app.get('/', (req, res) => {
	res.json({
		name: 'backend',
		ok: true,
		message: 'API online. Use /api/health',
	});
});

app.use('/api', apiRoutes);

app.use((req, res) => {
	res.status(404).json({
		ok: false,
		error: 'NOT_FOUND',
		path: req.originalUrl,
	});
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
	const status = Number(err.status || err.statusCode) || 500;
	res.status(status).json({
		ok: false,
		error: err.code || 'INTERNAL_ERROR',
		message: err.message || 'Unexpected error',
	});
});

const port = Number(process.env.PORT) || 3001;
app.listen(port, () => {
	// eslint-disable-next-line no-console
	console.log(`[backend] API servindo em http://localhost:${port}`);
});

