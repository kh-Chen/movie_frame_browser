/**
 * Movies Router
 * Movie-related API routes
 */

const express = require('express');
const router = express.Router();
const movieController = require('../controllers/movieController');

// Static paths must be registered before /:id
router.get('/cache/status', movieController.getCacheStatus);
router.delete('/cache', movieController.clearCache);
router.get('/local/browse', movieController.browseLocalDirectory);
router.get('/local/list', movieController.listLocalMovies);
router.post('/local/select', movieController.selectLocalMovie);

router.get('/', movieController.getMovies);

router.get('/:id/cover', movieController.getMovieCover);
router.get('/:id/frames/cached', movieController.listCachedFrames);
router.get('/:id/frames', movieController.getFrameIndex);
router.get('/:id/frames/:timestamp', movieController.getFrame);
router.get('/:id/keyframe', movieController.getKeyframe);
router.get('/:id/keyframes', movieController.listKeyframes);
router.post('/:id/keyframes/extract', movieController.extractAllKeyframes);
router.get('/:id/clips', movieController.listCachedClips);
router.get('/:id/clip', movieController.getClip);
router.get('/:id', movieController.getMovie);
router.delete('/:id', movieController.deleteMovie);

module.exports = router;
