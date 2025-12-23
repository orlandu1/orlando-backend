import { Router } from 'express';
import authRoute from './authRoute.js';
import userRoute from './userRoute.js';
import orcamentosRoute from './orcamentosRoute.js';

const router = Router();

router.get('/health', (req, res) => {
  res.json({ ok: true, service: 'backend', time: new Date().toISOString() });
});

router.use('/auth', authRoute);
router.use('/users', userRoute);
router.use('/orcamentos', orcamentosRoute);

export default router;
