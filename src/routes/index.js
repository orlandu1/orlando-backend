import { Router } from 'express';
import authRoute from './authRoute.js';
import userRoute from './userRoute.js';
import orcamentosRoute from './orcamentosRoute.js';
import projetosRoute from './projetosRoute.js';
import settingsRoute from './settingsRoute.js';
import auditRoute from './auditRoute.js';
import chamadosRoute from './chamadosRoute.js';

const router = Router();

router.get('/health', (req, res) => {
  res.json({ ok: true, service: 'backend', time: new Date().toISOString() });
});

router.use('/auth', authRoute);
router.use('/users', userRoute);
router.use('/orcamentos', orcamentosRoute);
router.use('/projetos', projetosRoute);
router.use('/settings', settingsRoute);
router.use('/audit', auditRoute);
router.use('/chamados', chamadosRoute);

export default router;
