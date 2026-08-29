/**
 * Deborah — Dev Preview Routes (STYLE STEP 12)
 * ---------------------------------------------
 * Component library preview sahifalari — faqat NODE_ENV !== 'production'
 * da mavjud (ishlab chiqish/visual test uchun).
 */
import { Router } from 'express';

const router = Router();

router.get('/components', (req, res) => {
  res.render('dev/components', {
    title: 'Components — Deborah Design System',
    description: 'Base component library preview (button, icon-button, badge)',
  });
});

export default router;
