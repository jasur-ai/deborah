/**
 * Edikit — Home Routes
 */

import { Router } from 'express';

const router = Router();

router.get('/', (req, res) => {
  res.render('index', {
    title: 'Edikit — Real-time multiplayer quiz platform',
  });
});

export default router;
